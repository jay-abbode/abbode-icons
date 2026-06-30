#!/usr/bin/env python3
"""Reorganize the Summer 26 + Beach categories into a single "Summer" category,
moving the non-summer icons out to existing categories. Rewrites the Category
cell (column A) on the MASTER tab. Only Summer 26 + Beach rows are touched.

Logic:
  * Every "Beach" icon  -> "Summer".
  * Every "Summer 26" icon -> "Summer", EXCEPT the ones listed in MOVE_OUT,
    which go to the category named there.
Nothing else in the sheet is touched.

Safe workflow:
  python reshuffle_summer.py --dry-run     # preview every change, writes nothing
  python reshuffle_summer.py               # apply (asks you to type "yes")

Needs:
  GOOGLE_SHEET_ID          env var (or --sheet-id)
  google-credentials.json  service account with EDIT access at the repo root
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
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]

SUMMER = "Summer"            # the new combined category name
SOURCE_TO_SUMMER = ("Summer 26", "Beach")  # categories folded into Summer

# Summer 26 icons that are NOT summer -> move to these existing categories.
# (Everything else in Summer 26, and ALL of Beach, becomes "Summer".)
MOVE_OUT = {
    "Cosmopolitan":    "Drinks",
    "Lemonade":        "Drinks",
    "Red Wine":        "Drinks",
    "White Wine":      "Drinks",
    "Watermelon Slice": "Food",
    "WSP Arch":        "NYC",      # Washington Square Park arch
    "Rainbow Trout":   "Nature",   # borderline — delete this line to keep it in Summer
}
# The 26 Yacht Flags (A-Z) get their own dedicated category, so Summer stays
# under Shopify's 50-per-category cap.
for _letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ":
    MOVE_OUT[f"Yacht Flag {_letter}"] = "Yacht Flags"
# Borderline kept IN Summer (no obvious existing home): "Button Down Shirt".


def norm(s):
    s = (s or "").lower().strip()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


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


def main():
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sheet-id", default=os.environ.get("GOOGLE_SHEET_ID"))
    p.add_argument("--tab", default=os.environ.get("GOOGLE_SHEET_TAB", "MASTER"))
    p.add_argument("--creds", default=str(DEFAULT_CREDS))
    p.add_argument("--dry-run", action="store_true", help="preview only; write nothing")
    args = p.parse_args()
    if not args.sheet_id:
        sys.exit("ERROR: set GOOGLE_SHEET_ID (or pass --sheet-id)")

    move_out = {norm(k): v for k, v in MOVE_OUT.items()}
    sheets = build("sheets", "v4", credentials=load_creds(Path(args.creds)),
                   cache_discovery=False).spreadsheets()

    head = sheets.values().get(spreadsheetId=args.sheet_id,
                               range=f"{args.tab}!1:2").execute().get("values", [])
    low = [h.strip().lower() for h in head[1]]
    cat_col = next((i for i, h in enumerate(low) if h == "category"), -1)
    icon_col = next((i for i, h in enumerate(low) if h == "icon"), -1)
    if cat_col < 0 or icon_col < 0:
        sys.exit("ERROR: couldn't find 'Category' and 'Icon' headers in row 2")
    CL, IL = col_letter(cat_col), col_letter(icon_col)
    print(f"Category column: {CL} | Icon column: {IL}")

    icon_vals = sheets.values().get(spreadsheetId=args.sheet_id,
                                    range=f"{args.tab}!{IL}3:{IL}").execute().get("values", [])
    cat_vals = sheets.values().get(spreadsheetId=args.sheet_id,
                                   range=f"{args.tab}!{CL}3:{CL}").execute().get("values", [])
    n = max(len(icon_vals), len(cat_vals))

    changes = []  # (name, old_cat, new_cat, rownum)
    seen_move = set()
    for i in range(n):
        name = (icon_vals[i][0].strip() if i < len(icon_vals) and icon_vals[i] else "")
        cat = (cat_vals[i][0].strip() if i < len(cat_vals) and cat_vals[i] else "")
        if not name or cat not in SOURCE_TO_SUMMER:
            continue
        key = norm(name)
        if cat == "Summer 26" and key in move_out:
            new = move_out[key]; seen_move.add(key)
        else:
            new = SUMMER
        if new != cat:
            changes.append((name, cat, new, i + 3))

    # group for display
    by_dest = defaultdict(list)
    for name, old, new, _ in changes:
        by_dest[new].append((name, old))
    print(f"\n{len(changes)} row(s) will change:\n")
    for dest in sorted(by_dest):
        rows = sorted(by_dest[dest])
        print(f"  -> {dest} ({len(rows)})")
        for name, old in rows:
            print(f"       {name:<30} (was {old})")
        print()

    summer_total = len(by_dest.get(SUMMER, []))
    print(f"Resulting '{SUMMER}' category size: {summer_total}")
    missing = [MOVE_OUT[k] and k for k in move_out if k not in seen_move]
    missing = [k for k in MOVE_OUT if norm(k) not in seen_move]
    if missing:
        print(f"MOVE_OUT names not found in Summer 26: {', '.join(missing)}")

    if not changes:
        print("\nNothing to change.")
        return
    if args.dry_run:
        print("\nDRY RUN — nothing written.")
        return
    resp = input(f"\nWrite {len(changes)} change(s) to '{args.tab}'? Type 'yes' to proceed: ")
    if resp.strip().lower() != "yes":
        print("Aborted — nothing written.")
        return
    data = [{"range": f"{args.tab}!{CL}{row}", "values": [[new]]}
            for _, _, new, row in changes]
    sheets.values().batchUpdate(spreadsheetId=args.sheet_id,
                                body={"valueInputOption": "RAW", "data": data}).execute()
    print(f"\nDone — {len(changes)} row(s) updated. App reflects it within ~60s.")


if __name__ == "__main__":
    main()
