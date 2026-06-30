#!/usr/bin/env python3
"""Backfill the MASTER tab's OFM / DST / PNG link columns for BLANK cells only,
matching files to rows by their "<Icon Name>" filename.

What it does
  * OFM  -> fills blank SMALL/MEDIUM/LARGE OFM cells from "<Icon> <SIZE>.ofm"
  * DST  -> fills blank SMALL/MEDIUM/LARGE DST cells from "<Icon> <SIZE>.dst"
  * PNG  -> fills the blank PNG cell from "<Icon>.png"
  Only blank cells are touched. Any cell that already has a link is left alone.

Folders are scanned RECURSIVELY (subfolders included). Pass whichever folders
you want with --ofm-folder / --dst-folder / --png-folder — nothing is hardcoded,
so it reads exactly where you point it.

Typo flagging
  If a file matches no row, it's reported under "matched no icon row", together
  with the closest icon name in the sheet — that's how you catch a typo in the
  Icon column (e.g. file "Bengal Cat SMALL.ofm" vs a row typed "Bengal Catt").

Safe workflow (dry-run first):
  python backfill_blanks.py --ofm-folder <ID> --dst-folder <ID> --png-folder <ID> --dry-run
  python backfill_blanks.py --ofm-folder <ID> --dst-folder <ID> --png-folder <ID>

Needs:
  GOOGLE_SHEET_ID          env var (or --sheet-id)
  google-credentials.json  service account at the repo root, with:
                             - at least Viewer on each folder you pass
                             - Editor on the sheet
"""
import argparse
import difflib
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

# Per-type config. headers map size -> the row-2 column header text.
TYPES = {
    "OFM": {"ext": "ofm", "sized": True,
            "headers": {"SMALL": "small ofm", "MEDIUM": "medium ofm", "LARGE": "large ofm"}},
    "DST": {"ext": "dst", "sized": True,
            "headers": {"SMALL": "small dst", "MEDIUM": "medium dst", "LARGE": "large dst"}},
    "PNG": {"ext": "png", "sized": False, "headers": {None: "png"}},
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
    """Walk folder + subfolders. Returns (by_name, dupes)."""
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


def cell_is_blank(cell):
    """A grid cell counts as blank when it has no link and no text."""
    if not cell:
        return True
    if cell.get("hyperlink"):
        return False
    v = cell.get("formattedValue")
    fv = (cell.get("userEnteredValue") or {}).get("formulaValue")
    return not (v or fv)


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
    p.add_argument("--ofm-folder", help="Drive folder ID with the OFM files")
    p.add_argument("--dst-folder", help="Drive folder ID with the DST files")
    p.add_argument("--png-folder", help="Drive folder ID with the PNG files")
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
    find_col = lambda name: next((i for i, h in enumerate(header) if h == name), -1)
    icon_col = find_col("icon")
    if icon_col < 0:
        sys.exit("ERROR: couldn't find the 'Icon' column header in row 2")

    # rows: norm name -> rownum; and the reverse, and all names for typo matching
    row_by_norm, name_by_norm = {}, {}
    for r in range(2, len(grid)):
        nm = ((get(grid[r], icon_col) or {}).get("formattedValue") or "").strip()
        if nm:
            row_by_norm.setdefault(norm(nm), r + 1)
            name_by_norm.setdefault(norm(nm), nm)
    all_norms = list(row_by_norm.keys())

    all_writes = []
    for t, folder_id in active.items():
        cfg = TYPES[t]
        cols = {sz: find_col(h) for sz, h in cfg["headers"].items()}
        miss = [cfg["headers"][sz] for sz, idx in cols.items() if idx < 0]
        if miss:
            print(f"[{t}] SKIPPED — missing column header(s): {', '.join(miss)}")
            continue
        if cfg["sized"]:
            fre = re.compile(r"^(?P<name>.+?)\s+(?P<size>SMALL|MEDIUM|LARGE)\." + cfg["ext"] + r"$",
                             re.IGNORECASE)
        else:
            fre = re.compile(r"^(?P<name>.+?)\." + cfg["ext"] + r"$", re.IGNORECASE)

        print(f"\n[{t}] scanning folder {folder_id} (recursive)...")
        by_name, dupes = list_files_recursive(drive, folder_id)
        cand = {n: i for n, i in by_name.items() if n.lower().endswith("." + cfg["ext"])}
        print(f"[{t}] {len(cand)} .{cfg['ext']} file(s) found"
              + (f"; {len(dupes)} duplicate-name file(s) skipped" if dupes else ""))

        fills, skipped_filled = [], 0
        unmatched, bad_pattern = [], []
        for fname, fid in sorted(cand.items()):
            m = fre.match(fname)
            if not m:
                bad_pattern.append(fname)
                continue
            base = m.group("name").strip()
            size = m.group("size").upper() if cfg["sized"] else None
            rownum = row_by_norm.get(norm(base))
            if not rownum:
                unmatched.append((fname, base))
                continue
            col_idx = cols[size]
            if not cell_is_blank(get(grid[rownum - 1], col_idx)):
                skipped_filled += 1
                continue
            formula = ('=HYPERLINK("https://drive.google.com/open?id=' + fid
                       + '", "' + fname.replace('"', '""') + '")')
            rng = f"{args.tab}!{col_letter(col_idx)}{rownum}"
            fills.append((rng.split('!')[1], fname))
            all_writes.append({"range": rng, "values": [[formula]]})

        # ---- report ----
        print(f"[{t}] {len(fills)} blank cell(s) to fill ({skipped_filled} already linked):")
        for where, fname in fills[:100]:
            print(f"    {where:<6} <- {fname}")
        if len(fills) > 100:
            print(f"    ... and {len(fills) - 100} more")
        if unmatched:
            print(f"[{t}] *** {len(unmatched)} file(s) matched NO icon row — check the Icon column for typos:")
            for fname, base in unmatched:
                near = difflib.get_close_matches(norm(base), all_norms, n=1, cutoff=0.6)
                if near:
                    rn = row_by_norm[near[0]]
                    blank = "" if any(not cell_is_blank(get(grid[rn - 1], cols[s])) for s in cols) else " [row is blank]"
                    print(f"    {fname:<36} closest row: \"{name_by_norm[near[0]]}\" (row {rn}){blank}")
                else:
                    print(f"    {fname:<36} (no similar row name found)")
        if dupes:
            print(f"[{t}] duplicate filenames (skipped): "
                  + ", ".join(sorted(dupes)[:10]) + (" ..." if len(dupes) > 10 else ""))
        if bad_pattern:
            patt = ("not '<Icon> SMALL|MEDIUM|LARGE.%s'" % cfg["ext"]) if cfg["sized"] \
                else ("not '<Icon>.%s'" % cfg["ext"])
            print(f"[{t}] {patt} ({len(bad_pattern)}): "
                  + ", ".join(bad_pattern[:10]) + (" ..." if len(bad_pattern) > 10 else ""))

    print(f"\n=== total blank cells to fill: {len(all_writes)} ===")
    if not all_writes:
        print("Nothing to fill.")
        return
    if args.dry_run:
        print("DRY RUN — nothing written.")
        return
    resp = input(f"Write {len(all_writes)} cell(s) to '{args.tab}'? Type 'yes' to proceed: ")
    if resp.strip().lower() != "yes":
        print("Aborted — nothing written.")
        return
    for i in range(0, len(all_writes), 500):
        sheets.values().batchUpdate(
            spreadsheetId=args.sheet_id,
            body={"valueInputOption": "USER_ENTERED", "data": all_writes[i:i + 500]},
        ).execute()
    print(f"Done — {len(all_writes)} cell(s) filled. The app reflects them within ~60s.")


if __name__ == "__main__":
    main()
