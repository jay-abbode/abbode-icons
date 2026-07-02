#!/usr/bin/env python3
"""Add any MASTER icons that are missing from tags.csv, with auto-generated
thematic tags — so every icon has search tags without you writing them.

What it does
  1. Reads the MASTER tab's Icon + Category columns.
  2. Finds icons that have no row in tags.csv (matched by name, case/spacing-
     insensitive).
  3. Generates thematic tags for each (see tag_gen.py) and APPENDS them as new
     rows to tags.csv, in the same format as the existing rows.

It never touches existing rows, so your hand-written tags are safe. Run the
populate step (populate_tags.py) afterwards to push the new tags into the sheet
— the add_icons runner does both in order.

Needs
  GOOGLE_SHEET_ID            env var (or --sheet-id)
  google-credentials.json    service account (read access to the sheet is enough)

Run from this folder:
  python autotag_new.py --dry-run    # preview the icons + tags it would add
  python autotag_new.py              # append them to tags.csv
"""
import argparse
import csv
import os
import re
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

from tag_gen import generate_tags, norm  # same folder

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_CREDS = PROJECT_ROOT / "google-credentials.json"
DEFAULT_CSV = SCRIPT_DIR / "tags.csv"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets.readonly"]


def col_letter(idx):
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


def load_existing(csv_path):
    """Return (set of normalized names already in the CSV, header_present)."""
    have = set()
    header = True
    if not csv_path.exists():
        return have, False
    with open(csv_path, newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        first = next(reader, None)
        header = bool(first) and first[0].strip().lower() in ("icon", "name")
        if first and not header and first[0].strip():
            have.add(norm(first[0]))  # first line was data, not a header
        for row in reader:
            if row and row[0].strip():
                have.add(norm(row[0]))
    return have, header


def ends_with_newline(path):
    try:
        with open(path, "rb") as f:
            if f.seek(0, 2) == 0:
                return True  # empty file
            f.seek(-1, 2)
            return f.read(1) in (b"\n", b"\r")
    except OSError:
        return True


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sheet-id", default=os.environ.get("GOOGLE_SHEET_ID"))
    p.add_argument("--tab", default=os.environ.get("GOOGLE_SHEET_TAB", "MASTER"))
    p.add_argument("--csv", default=str(DEFAULT_CSV))
    p.add_argument("--creds", default=str(DEFAULT_CREDS))
    p.add_argument("--max-tags", type=int, default=18, help="cap tags per icon (default 18)")
    p.add_argument("--dry-run", action="store_true", help="preview only; write nothing")
    args = p.parse_args()

    if not args.sheet_id:
        sys.exit("ERROR: set GOOGLE_SHEET_ID (or pass --sheet-id)")

    csv_path = Path(args.csv)
    have, header_present = load_existing(csv_path)
    print(f"tags.csv: {len(have)} icons already tagged"
          f"{'' if csv_path.exists() else ' (file will be created)'}")

    sheets = build("sheets", "v4", credentials=load_creds(Path(args.creds)),
                   cache_discovery=False).spreadsheets()

    head = sheets.values().get(spreadsheetId=args.sheet_id,
                               range=f"{args.tab}!1:2").execute().get("values", [])
    if len(head) < 2:
        sys.exit(f"ERROR: tab '{args.tab}' doesn't have the expected two header rows")
    headers = [h.strip() for h in head[1]]
    icon_col = next((i for i, h in enumerate(headers) if h.lower() == "icon"), -1)
    cat_col = next((i for i, h in enumerate(headers) if h.lower() == "category"), -1)
    if icon_col < 0:
        sys.exit("ERROR: couldn't find the 'Icon' column in row 2")
    if cat_col < 0:
        print("WARNING: no 'Category' column found — tags will be built from names only")

    NL = col_letter(icon_col)
    names_rows = sheets.values().get(spreadsheetId=args.sheet_id,
                                     range=f"{args.tab}!{NL}3:{NL}").execute().get("values", [])
    names = [(r[0].strip() if r else "") for r in names_rows]
    n = len(names)

    cats = [""] * n
    if cat_col >= 0 and n:
        CL = col_letter(cat_col)
        cat_rows = sheets.values().get(spreadsheetId=args.sheet_id,
                                       range=f"{args.tab}!{CL}3:{CL}{2 + n}").execute().get("values", [])
        for i, r in enumerate(cat_rows):
            if i < n:
                cats[i] = (r[0].strip() if r else "")

    # Icons on the sheet with no CSV row yet (skip blanks; de-dupe within-run).
    seen = set()
    new_rows = []
    for name, cat in zip(names, cats):
        if not name:
            continue
        key = norm(name)
        if key in have or key in seen:
            continue
        seen.add(key)
        new_rows.append((name, generate_tags(name, cat, max_tags=args.max_tags)))

    if not new_rows:
        print("Every icon on the sheet already has a row in tags.csv — nothing to add.")
        return

    print(f"\n{len(new_rows)} icon(s) missing from tags.csv:")
    for name, tags in new_rows:
        print(f"  + {name}\n      {tags}")

    if args.dry_run:
        print("\nDRY RUN — tags.csv not modified. Re-run without --dry-run to add these.")
        return

    # Append (create with header if the file is new). Match the existing format:
    # Icon unquoted, Tags quoted when needed, CRLF line endings.
    new_file = not csv_path.exists()
    if not new_file and not ends_with_newline(csv_path):
        with open(csv_path, "a", encoding="utf-8") as f:
            f.write("\r\n")
    with open(csv_path, "a", newline="", encoding="utf-8") as f:
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL, lineterminator="\r\n")
        if new_file or not header_present:
            w.writerow(["Icon", "Tags"])
        for name, tags in new_rows:
            w.writerow([name, tags])

    print(f"\nAdded {len(new_rows)} row(s) to {csv_path}.")


if __name__ == "__main__":
    main()
