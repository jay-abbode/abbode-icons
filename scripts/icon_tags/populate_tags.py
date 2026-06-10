#!/usr/bin/env python3
"""Fill the MASTER sheet's "Tags" column from tags.csv (one-time setup for
thematic search, re-runnable any time).

What it does
  1. Finds the "Icon" column and the "Tags" column on the MASTER tab
     (creates the Tags header in row 2, after the last used column, if absent).
  2. Matches every sheet row to tags.csv by icon name (case/spacing-insensitive).
  3. Writes the comma-separated tags for each matched row.

By default existing non-empty Tags cells are PRESERVED (so your manual edits
survive re-runs); pass --overwrite to replace them with the CSV values.

Needs
  GOOGLE_SHEET_ID            env var (or --sheet-id)
  google-credentials.json    service account with EDIT access, at the repo root
                             (same file the order-stats populator uses)

Run from this folder:
  python populate_tags.py --dry-run     # preview, writes nothing
  python populate_tags.py               # write
"""
import argparse
import csv
import os
import re
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_CREDS = PROJECT_ROOT / "google-credentials.json"
DEFAULT_CSV = SCRIPT_DIR / "tags.csv"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

TAGS_HEADERS = ("tags", "search tags", "theme tags")


def norm(s):
    s = (s or "").lower().strip()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def col_letter(idx):
    """0-based column index -> A1 letter(s): 0->A, 25->Z, 26->AA."""
    letters = ""
    idx += 1
    while idx > 0:
        idx, rem = divmod(idx - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def load_creds(path):
    if not path.exists():
        sys.exit(f"ERROR: service account creds not found at {path}")
    return service_account.Credentials.from_service_account_file(str(path), scopes=SCOPES)


def load_csv(path):
    if not path.exists():
        sys.exit(f"ERROR: tags csv not found at {path}")
    out = {}
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        header = next(reader, None)
        for row in reader:
            if len(row) < 2 or not row[0].strip():
                continue
            out[norm(row[0])] = (row[0].strip(), row[1].strip())
    return out


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--sheet-id", default=os.environ.get("GOOGLE_SHEET_ID"))
    p.add_argument("--tab", default=os.environ.get("GOOGLE_SHEET_TAB", "MASTER"))
    p.add_argument("--csv", default=str(DEFAULT_CSV))
    p.add_argument("--creds", default=str(DEFAULT_CREDS))
    p.add_argument("--overwrite", action="store_true",
                   help="replace existing non-empty Tags cells (default: preserve them)")
    p.add_argument("--dry-run", action="store_true", help="preview only; write nothing")
    args = p.parse_args()

    if not args.sheet_id:
        sys.exit("ERROR: set GOOGLE_SHEET_ID (or pass --sheet-id)")

    csv_map = load_csv(Path(args.csv))
    print(f"Loaded {len(csv_map)} tagged icons from {args.csv}")

    sheets = build("sheets", "v4", credentials=load_creds(Path(args.creds)),
                   cache_discovery=False).spreadsheets()

    # --- headers (row 1 = section headers, row 2 = column headers) ---
    head = sheets.values().get(spreadsheetId=args.sheet_id,
                               range=f"{args.tab}!1:2").execute().get("values", [])
    if len(head) < 2:
        sys.exit(f"ERROR: tab '{args.tab}' doesn't have the expected two header rows")
    row1, row2 = head[0], head[1]
    headers = [h.strip() for h in row2]

    name_col = next((i for i, h in enumerate(headers) if h.lower() == "icon"), -1)
    if name_col < 0:
        sys.exit("ERROR: couldn't find the 'Icon' column in row 2 of the tab")

    tags_col = next((i for i, h in enumerate(headers) if h.lower() in TAGS_HEADERS), -1)
    new_column = tags_col < 0
    if new_column:
        tags_col = max(len(row1), len(row2))  # first column after everything in use
    NL, TL = col_letter(name_col), col_letter(tags_col)
    print(f"Icon column: {NL} | Tags column: {TL}"
          f"{' (new — header will be added)' if new_column else ''}")

    # --- data ---
    names_rows = sheets.values().get(spreadsheetId=args.sheet_id,
                                     range=f"{args.tab}!{NL}3:{NL}").execute().get("values", [])
    names = [(r[0].strip() if r else "") for r in names_rows]
    n_rows = len(names)
    print(f"{n_rows} data rows in the sheet")

    existing = []
    if not new_column and n_rows:
        ex_rows = sheets.values().get(spreadsheetId=args.sheet_id,
                                      range=f"{args.tab}!{TL}3:{TL}{2 + n_rows}").execute().get("values", [])
        existing = [(r[0] if r else "") for r in ex_rows]
    existing += [""] * (n_rows - len(existing))

    # --- compose ---
    values, matched, preserved, unmatched = [], 0, 0, []
    used_csv = set()
    for i, name in enumerate(names):
        if not name:
            values.append([existing[i]])
            continue
        key = norm(name)
        hit = csv_map.get(key)
        if hit:
            used_csv.add(key)
        if existing[i].strip() and not args.overwrite:
            values.append([existing[i]])
            preserved += 1
        elif hit:
            values.append([hit[1]])
            matched += 1
        else:
            values.append([existing[i]])
            unmatched.append(name)

    leftover = [csv_map[k][0] for k in csv_map if k not in used_csv]

    print(f"\nWill write tags for {matched} rows"
          f"{f', preserve {preserved} existing cells' if preserved else ''}.")
    if unmatched:
        print(f"Sheet rows with no tags in the CSV ({len(unmatched)}): "
              + ", ".join(unmatched[:20]) + (" ..." if len(unmatched) > 20 else ""))
    if leftover:
        print(f"CSV icons not found in the sheet ({len(leftover)}): "
              + ", ".join(leftover[:20]) + (" ..." if len(leftover) > 20 else ""))

    if args.dry_run:
        sample = [(names[i], values[i][0]) for i in range(n_rows) if names[i] and values[i][0]][:5]
        print("\nSample of what would be written:")
        for n, t in sample:
            print(f"  {n}: {t}")
        print("\nDRY RUN — nothing written.")
        return

    if new_column:
        sheets.values().update(spreadsheetId=args.sheet_id,
                               range=f"{args.tab}!{TL}2",
                               valueInputOption="RAW",
                               body={"values": [["Tags"]]}).execute()
    if n_rows:
        sheets.values().update(spreadsheetId=args.sheet_id,
                               range=f"{args.tab}!{TL}3:{TL}{2 + n_rows}",
                               valueInputOption="RAW",
                               body={"values": values}).execute()
    print(f"\nDone — Tags written to column {TL} on {args.tab}. "
          "The app picks them up within ~60 seconds.")


if __name__ == "__main__":
    main()
