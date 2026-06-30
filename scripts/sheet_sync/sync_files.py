#!/usr/bin/env python3
"""Sync the MASTER tab's OFM / DST / PNG link columns to the canonical Drive
folders, matching files to cells by their "<Icon Name> <SIZE>" filename.

Per file type:
  * OFM -> RECONCILE: re-point every OFM cell to its canonical file in the OFM
    folder. Fixes wrong-design links (and size-label slips). Only changes a cell
    when the canonical file is found; never blanks a cell; reports what it can't
    match. This is what corrects the known bad cells (Adderall, Dice, etc.).
  * DST -> FILL EMPTY: only fills DST cells that are currently blank; existing
    links are left untouched.
  * PNG -> FILL EMPTY: same, for the single PNG column.

Scope rules (as required):
  * Each folder is scanned RECURSIVELY, including subfolders.
  * OFM and DST: only files whose name ends "<Icon> SMALL|MEDIUM|LARGE.<ext>"
    are considered. Anything without a size word is ignored.
  * PNG: files named "<Icon>.png" (no size).

Safe workflow (always dry-run first):
  python sync_files.py --ofm-folder <ID> --dst-folder <ID> --png-folder <ID> --dry-run
  python sync_files.py --ofm-folder <ID> --dst-folder <ID> --png-folder <ID>

You can run one type at a time by passing only that folder, e.g.
  python sync_files.py --ofm-folder <ID> --dry-run      # OFM reconcile only
  python sync_files.py --dst-folder <ID> --dry-run      # DST fill only

Needs:
  GOOGLE_SHEET_ID          env var (or --sheet-id)
  google-credentials.json  service account at the repo root, with:
                             - at least Viewer on each folder you pass
                             - Editor on the sheet
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
FOLDER_MIME = "application/vnd.google-apps.folder"

# Per-type configuration. headers map the size -> the column's row-2 header text.
TYPES = {
    "OFM": {
        "ext": "ofm", "sized": True, "mode": "reconcile",
        "headers": {"SMALL": "small ofm", "MEDIUM": "medium ofm", "LARGE": "large ofm"},
    },
    "DST": {
        "ext": "dst", "sized": True, "mode": "fill",
        "headers": {"SMALL": "small dst", "MEDIUM": "medium dst", "LARGE": "large dst"},
    },
    "PNG": {
        "ext": "png", "sized": False, "mode": "fill",
        "headers": {None: "png"},
    },
}


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


def drive_id_from_url(url):
    if not url:
        return None
    m = re.search(r"/d/([a-zA-Z0-9_-]{20,})", url) or re.search(r"[?&]id=([a-zA-Z0-9_-]{20,})", url)
    return m.group(1) if m else None


def load_creds(path):
    if not path.exists():
        sys.exit(f"ERROR: service account creds not found at {path}")
    return service_account.Credentials.from_service_account_file(str(path), scopes=SCOPES)


def list_files_recursive(drive, folder_id):
    """Walk folder + all subfolders. Returns (by_name, dupes).

    by_name: {filename: file_id} for names that appear exactly once.
    dupes:   set of filenames that appear in more than one place (skipped, since
             we can't know which is canonical).
    """
    name_to_ids = defaultdict(set)
    stack, seen = [folder_id], set()
    while stack:
        fid = stack.pop()
        if fid in seen:
            continue
        seen.add(fid)
        token = None
        while True:
            resp = drive.files().list(
                q=f"'{fid}' in parents and trashed = false",
                fields="nextPageToken, files(id, name, mimeType)",
                pageSize=1000, pageToken=token,
                supportsAllDrives=True, includeItemsFromAllDrives=True,
            ).execute()
            for f in resp.get("files", []):
                if f["mimeType"] == FOLDER_MIME:
                    stack.append(f["id"])
                else:
                    name_to_ids[f["name"]].add(f["id"])
            token = resp.get("nextPageToken")
            if not token:
                break
    by_name = {n: next(iter(ids)) for n, ids in name_to_ids.items() if len(ids) == 1}
    dupes = {n for n, ids in name_to_ids.items() if len(ids) > 1}
    return by_name, dupes


def cell_file_id(cell):
    """Current Drive id linked in a grid cell (inserted link or =HYPERLINK)."""
    if not cell:
        return None
    link = cell.get("hyperlink")
    if not link:
        formula = (cell.get("userEnteredValue") or {}).get("formulaValue")
        if formula and formula.upper().startswith("=HYPERLINK"):
            m = re.match(r'=HYPERLINK\s*\(\s*"([^"]+)"', formula, re.IGNORECASE)
            link = m.group(1) if m else None
    return drive_id_from_url(link)


def fetch_grid(sheets, sheet_id, tab):
    resp = sheets.get(
        spreadsheetId=sheet_id, ranges=[tab], includeGridData=True,
        fields="sheets(data(rowData(values(formattedValue,hyperlink,userEnteredValue(formulaValue)))))",
    ).execute()
    rows = resp["sheets"][0]["data"][0].get("rowData", [])
    return [r.get("values", []) for r in rows]


def get(cellrow, idx):
    return cellrow[idx] if idx < len(cellrow) else None


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--ofm-folder", help="Drive folder ID for canonical OFM files")
    p.add_argument("--dst-folder", help="Drive folder ID for canonical DST files")
    p.add_argument("--png-folder", help="Drive folder ID for canonical PNG files")
    p.add_argument("--sheet-id", default=os.environ.get("GOOGLE_SHEET_ID"))
    p.add_argument("--tab", default=os.environ.get("GOOGLE_SHEET_TAB", "MASTER"))
    p.add_argument("--creds", default=str(DEFAULT_CREDS))
    p.add_argument("--dry-run", action="store_true", help="preview only; write nothing")
    args = p.parse_args()
    if not args.sheet_id:
        sys.exit("ERROR: set GOOGLE_SHEET_ID (or pass --sheet-id)")

    folders = {"OFM": args.ofm_folder, "DST": args.dst_folder, "PNG": args.png_folder}
    active = {t: fid for t, fid in folders.items() if fid}
    if not active:
        sys.exit("ERROR: pass at least one of --ofm-folder / --dst-folder / --png-folder")

    creds = load_creds(Path(args.creds))
    sheets = build("sheets", "v4", credentials=creds, cache_discovery=False).spreadsheets()
    drive = build("drive", "v3", credentials=creds, cache_discovery=False)

    grid = fetch_grid(sheets, args.sheet_id, args.tab)
    if len(grid) < 2:
        sys.exit(f"ERROR: tab '{args.tab}' has no header rows")
    header = [(c.get("formattedValue") or "").strip().lower() for c in grid[1]]

    def find_col(name):
        return next((i for i, h in enumerate(header) if h == name), -1)

    icon_col = find_col("icon")
    if icon_col < 0:
        sys.exit("ERROR: couldn't find the 'Icon' column header in row 2")

    # row number (1-based) by normalized icon name; data starts at sheet row 3
    row_by_norm = {}
    for r in range(2, len(grid)):
        nm = (get(grid[r], icon_col) or {}).get("formattedValue", "")
        nm = (nm or "").strip()
        if nm:
            row_by_norm.setdefault(norm(nm), r + 1)

    all_writes = []   # {range, values}
    for t, folder_id in active.items():
        cfg = TYPES[t]
        cols = {sz: find_col(h) for sz, h in cfg["headers"].items()}
        missing_hdr = [cfg["headers"][sz] for sz, idx in cols.items() if idx < 0]
        if missing_hdr:
            print(f"[{t}] SKIPPED — missing column header(s): {', '.join(missing_hdr)}")
            continue

        if cfg["sized"]:
            fname_re = re.compile(
                r"^(?P<name>.+?)\s+(?P<size>SMALL|MEDIUM|LARGE)\." + cfg["ext"] + r"$",
                re.IGNORECASE)
        else:
            fname_re = re.compile(r"^(?P<name>.+?)\." + cfg["ext"] + r"$", re.IGNORECASE)

        print(f"\n[{t}] scanning folder {folder_id} (recursive)...")
        by_name, dupes = list_files_recursive(drive, folder_id)
        cand = {n: i for n, i in by_name.items() if n.lower().endswith("." + cfg["ext"])}
        print(f"[{t}] {len(cand)} candidate .{cfg['ext']} file(s) found"
              + (f"; {len(dupes)} duplicate-name file(s) skipped" if dupes else ""))

        changes, filled, skipped_same, skipped_filled = [], [], 0, 0
        unmatched_row, bad_pattern = [], []
        for fname, fid in sorted(cand.items()):
            m = fname_re.match(fname)
            if not m:
                bad_pattern.append(fname)
                continue
            base = m.group("name").strip()
            size = m.group("size").upper() if cfg["sized"] else None
            rownum = row_by_norm.get(norm(base))
            if not rownum:
                unmatched_row.append(fname)
                continue
            col_idx = cols[size]
            cur_id = cell_file_id(get(grid[rownum - 1], col_idx))
            rng = f"{args.tab}!{col_letter(col_idx)}{rownum}"
            formula = ('=HYPERLINK("https://drive.google.com/open?id='
                       + fid + '", "' + fname.replace('"', '""') + '")')

            if cfg["mode"] == "reconcile":
                if cur_id == fid:
                    skipped_same += 1
                else:
                    changes.append((rownum, size, fname, cur_id, rng))
                    all_writes.append({"range": rng, "values": [[formula]]})
            else:  # fill empty only
                if cur_id:
                    skipped_filled += 1
                else:
                    filled.append((rownum, size, fname, rng))
                    all_writes.append({"range": rng, "values": [[formula]]})

        # ---- report for this type ----
        if cfg["mode"] == "reconcile":
            print(f"[{t}] {len(changes)} cell(s) to re-point "
                  f"({skipped_same} already correct):")
            for rownum, size, fname, cur_id, rng in changes[:80]:
                where = rng.split("!")[1]
                prev = f"id {cur_id}" if cur_id else "(empty)"
                print(f"    {where:<6} {fname:<34} was {prev}")
            if len(changes) > 80:
                print(f"    ... and {len(changes) - 80} more")
        else:
            print(f"[{t}] {len(filled)} empty cell(s) to fill "
                  f"({skipped_filled} already linked):")
            for rownum, size, fname, rng in filled[:80]:
                print(f"    {rng.split('!')[1]:<6} <- {fname}")
            if len(filled) > 80:
                print(f"    ... and {len(filled) - 80} more")
        if dupes:
            print(f"[{t}] duplicate filenames (skipped — can't pick): "
                  + ", ".join(sorted(dupes)[:10]) + (" ..." if len(dupes) > 10 else ""))
        if unmatched_row:
            print(f"[{t}] no matching icon row ({len(unmatched_row)}): "
                  + ", ".join(unmatched_row[:10]) + (" ..." if len(unmatched_row) > 10 else ""))
        if bad_pattern:
            label = ("not '<Icon> SMALL|MEDIUM|LARGE.%s'" % cfg["ext"]) if cfg["sized"] \
                else ("not '<Icon>.%s'" % cfg["ext"])
            print(f"[{t}] {label} ({len(bad_pattern)}): "
                  + ", ".join(bad_pattern[:10]) + (" ..." if len(bad_pattern) > 10 else ""))

    print(f"\n=== total cells to write: {len(all_writes)} ===")
    if not all_writes:
        print("Nothing to write.")
        return
    if args.dry_run:
        print("DRY RUN — nothing written.")
        return
    resp = input(f"Write {len(all_writes)} cell(s) to '{args.tab}'? Type 'yes' to proceed: ")
    if resp.strip().lower() != "yes":
        print("Aborted — nothing written.")
        return
    # Sheets API caps batch size; chunk to be safe.
    for i in range(0, len(all_writes), 500):
        sheets.values().batchUpdate(
            spreadsheetId=args.sheet_id,
            body={"valueInputOption": "USER_ENTERED", "data": all_writes[i:i + 500]},
        ).execute()
    print(f"Done — {len(all_writes)} cell(s) written. The app reflects them within ~60s.")


if __name__ == "__main__":
    main()
