#!/usr/bin/env python3
"""Auto-populate the DST columns on the MASTER tab from a Google Drive folder of
exported .dst files.

How it works
  1. Lists every .dst in the given Drive folder (name + file id).
  2. Parses each filename as "<Icon Name> <SIZE>.dst"  (SIZE = SMALL|MEDIUM|LARGE),
     matching the OFM/PNG naming already used in the sheet.
  3. Writes  =HYPERLINK("https://drive.google.com/open?id=<id>", "<filename>")
     into the matching row's SMALL/MEDIUM/LARGE DST cell.

Empty cells only: a DST cell that already has a link is left untouched (so your
manual entries and earlier runs survive). Re-runnable — run it again after each
export and it fills whatever is newly present.

Safe workflow:
  python backfill_dsts.py --folder-id <DRIVE_FOLDER_ID> --dry-run   # preview, writes nothing
  python backfill_dsts.py --folder-id <DRIVE_FOLDER_ID>             # apply (asks to type "yes")

Needs:
  GOOGLE_SHEET_ID          env var (or --sheet-id)
  google-credentials.json  service account at the repo root, with:
                             - at least Viewer on the DST folder
                             - Editor on the sheet
  DST_FOLDER_ID            optional env var instead of --folder-id
"""
import argparse
import os
import re
import sys
from pathlib import Path
from collections import defaultdict

from google.oauth2 import service_account
from googleapiclient.discovery import build

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_CREDS = PROJECT_ROOT / "google-credentials.json"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
]
SIZES = ("SMALL", "MEDIUM", "LARGE")
DST_HEADERS = {"SMALL": "small dst", "MEDIUM": "medium dst", "LARGE": "large dst"}
FNAME_RE = re.compile(r"^(?P<name>.+?)\s+(?P<size>SMALL|MEDIUM|LARGE)\.dst$", re.IGNORECASE)


def norm(s):
    s = (s or "").lower().strip()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def col_letter(idx):
    out = ""
    idx += 1
    while idx > 0:
        idx, rem = divmod(idx - 1, 26)
        out = chr(65 + rem) + out
    return out


def load_creds(path):
    if not path.exists():
        sys.exit(f"ERROR: service account creds not found at {path}")
    return service_account.Credentials.from_service_account_file(str(path), scopes=SCOPES)


def list_dst_files(drive, folder_id):
    """All non-trashed .dst files directly inside the folder -> {filename: id}."""
    files, token = {}, None
    q = (f"'{folder_id}' in parents and trashed = false "
         f"and (mimeType != 'application/vnd.google-apps.folder')")
    while True:
        resp = drive.files().list(
            q=q, fields="nextPageToken, files(id, name)",
            pageSize=1000, pageToken=token,
            supportsAllDrives=True, includeItemsFromAllDrives=True,
        ).execute()
        for f in resp.get("files", []):
            if f["name"].lower().endswith(".dst"):
                if f["name"] in files:
                    print(f"  WARNING duplicate filename in folder: {f['name']} "
                          f"(using the first one)")
                else:
                    files[f["name"]] = f["id"]
        token = resp.get("nextPageToken")
        if not token:
            break
    return files


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--folder-id", default=os.environ.get("DST_FOLDER_ID"),
                   help="Drive folder ID containing the exported .dst files")
    p.add_argument("--sheet-id", default=os.environ.get("GOOGLE_SHEET_ID"))
    p.add_argument("--tab", default=os.environ.get("GOOGLE_SHEET_TAB", "MASTER"))
    p.add_argument("--creds", default=str(DEFAULT_CREDS))
    p.add_argument("--overwrite", action="store_true",
                   help="replace DST cells that already have a link (default: skip them)")
    p.add_argument("--dry-run", action="store_true", help="preview only; write nothing")
    args = p.parse_args()
    if not args.sheet_id:
        sys.exit("ERROR: set GOOGLE_SHEET_ID (or pass --sheet-id)")
    if not args.folder_id:
        sys.exit("ERROR: pass --folder-id (or set DST_FOLDER_ID) for the DST Drive folder")

    creds = load_creds(Path(args.creds))
    sheets = build("sheets", "v4", credentials=creds, cache_discovery=False).spreadsheets()
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)

    # 1) read DST files from Drive
    dst_files = list_dst_files(drive, args.folder_id)
    print(f"Found {len(dst_files)} .dst file(s) in the folder.")
    if not dst_files:
        sys.exit("Nothing to do — no .dst files in that folder.")

    # 2) locate columns by header (row 2)
    head = sheets.values().get(spreadsheetId=args.sheet_id,
                               range=f"{args.tab}!1:2").execute().get("values", [])
    low = [h.strip().lower() for h in head[1]]
    icon_col = next((i for i, h in enumerate(low) if h == "icon"), -1)
    dst_col = {sz: next((i for i, h in enumerate(low) if h == DST_HEADERS[sz]), -1) for sz in SIZES}
    if icon_col < 0 or any(v < 0 for v in dst_col.values()):
        sys.exit("ERROR: couldn't find 'Icon' and all three DST columns in row 2")
    IL = col_letter(icon_col)

    # 3) read icon names + existing DST cells (values only; blank => empty cell)
    names = sheets.values().get(spreadsheetId=args.sheet_id,
                                range=f"{args.tab}!{IL}3:{IL}").execute().get("values", [])
    name_by_row = {i + 3: (r[0].strip() if r else "") for i, r in enumerate(names)}
    row_by_norm = {}
    for rownum, nm in name_by_row.items():
        if nm:
            row_by_norm.setdefault(norm(nm), rownum)

    existing = {}
    for sz in SIZES:
        CL = col_letter(dst_col[sz])
        vals = sheets.values().get(spreadsheetId=args.sheet_id,
                                   range=f"{args.tab}!{CL}3:{CL}").execute().get("values", [])
        existing[sz] = {i + 3: (r[0] if r else "") for i, r in enumerate(vals)}

    # 4) match files -> target cells
    writes = []          # (rownum, size, filename, file_id, col_idx)
    skipped_filled = []  # filename (cell already had a link)
    unmatched_name = []  # filename (no row)
    bad_pattern = []     # filename (didn't parse)
    for fname, fid in sorted(dst_files.items()):
        m = FNAME_RE.match(fname)
        if not m:
            bad_pattern.append(fname)
            continue
        base, size = m.group("name").strip(), m.group("size").upper()
        rownum = row_by_norm.get(norm(base))
        if not rownum:
            unmatched_name.append(fname)
            continue
        cur = existing[size].get(rownum, "")
        if str(cur).strip() and not args.overwrite:
            skipped_filled.append(fname)
            continue
        writes.append((rownum, size, fname, fid, dst_col[size]))

    # 5) report
    by_size = defaultdict(int)
    for _, size, *_ in writes:
        by_size[size] += 1
    print(f"\n{len(writes)} DST cell(s) to fill  "
          f"(SMALL {by_size['SMALL']}, MEDIUM {by_size['MEDIUM']}, LARGE {by_size['LARGE']}):")
    for rownum, size, fname, fid, _ in writes[:60]:
        print(f"  row {rownum:<4} {size:<6} <- {fname}")
    if len(writes) > 60:
        print(f"  ... and {len(writes) - 60} more")
    if skipped_filled:
        print(f"\nSkipped (cell already linked) — {len(skipped_filled)}: "
              + ", ".join(skipped_filled[:10]) + (" ..." if len(skipped_filled) > 10 else ""))
    if unmatched_name:
        print(f"\nNo matching icon row — {len(unmatched_name)}: "
              + ", ".join(unmatched_name[:15]) + (" ..." if len(unmatched_name) > 15 else ""))
    if bad_pattern:
        print(f"\nFilename not '<Icon> <SIZE>.dst' — {len(bad_pattern)}: "
              + ", ".join(bad_pattern[:15]) + (" ..." if len(bad_pattern) > 15 else ""))

    if not writes:
        print("\nNothing to write.")
        return
    if args.dry_run:
        print("\nDRY RUN — nothing written.")
        return
    resp = input(f"\nWrite {len(writes)} DST link(s) to '{args.tab}'? Type 'yes' to proceed: ")
    if resp.strip().lower() != "yes":
        print("Aborted — nothing written.")
        return

    data = []
    for rownum, size, fname, fid, col_idx in writes:
        url = f"https://drive.google.com/open?id={fid}"
        safe = fname.replace('"', '""')
        formula = f'=HYPERLINK("{url}", "{safe}")'
        data.append({"range": f"{args.tab}!{col_letter(col_idx)}{rownum}",
                     "values": [[formula]]})
    sheets.values().batchUpdate(
        spreadsheetId=args.sheet_id,
        body={"valueInputOption": "USER_ENTERED", "data": data},
    ).execute()
    print(f"\nDone — {len(writes)} DST cell(s) linked. The app reflects them within ~60s.")


if __name__ == "__main__":
    main()
