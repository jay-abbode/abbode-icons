#!/usr/bin/env python3
"""Move selected icons from the Hobby category to a new "Sports" category by
rewriting their Category cell (column A) on the MASTER tab.

Only the icons listed in SPORTS below are touched. Everything else is left
exactly as-is. Matching is by icon name (case/spacing-insensitive), so the
exact column the Category lives in is found by its header, not hard-coded.

Safe workflow:
  python move_to_sports.py --dry-run     # preview every change, writes nothing
  python move_to_sports.py               # apply (asks you to type "yes")

Needs:
  GOOGLE_SHEET_ID          env var (or --sheet-id)
  google-credentials.json  service account with EDIT access, at the repo root
                           (the same file the other scripts use)
"""
import argparse
import os
import re
import sys
from pathlib import Path

from google.oauth2 import service_account
from googleapiclient.discovery import build

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
DEFAULT_CREDS = PROJECT_ROOT / "google-credentials.json"
SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]
TARGET_CATEGORY = "Sports"

# --- Icons to move from Hobby -> Sports (exact MASTER spellings) -------------
# The actual sport: balls, racquets/paddles, clubs, and the skiing/boarding
# action + boards. Names match the sheet (incl. its "Raquets" spelling).
SPORTS = [
    "Baseball",
    "Basketball",
    "Football",
    "Soccer Ball",
    "Volleyball",
    "Tennis",
    "Tennis Raquets",
    "Pink Tennis",
    "Pink Tennis Raquets",
    "Pickleball Paddle",
    "Pickleball Paddles",
    "Light Blue Pickleball Paddles",
    "Golf Clubs",
    "Skis",
    "USA Skis",
    "Snowboard",
    "Skier",
]

# Borderline icons left in Hobby on purpose. To move any of them too, just cut
# the line and paste it into the SPORTS list above:
#   "Bicycle"              # cycling, but reads as leisure/transport
#   "8 Ball"               # billiards is a cue sport, but reads bar/games
#   "Horseshoe"            # equestrian/lucky — better fit for Horses
#   "English Saddle"       # equestrian — better fit for Horses
#   "Western Saddle"       # equestrian — better fit for Horses
#   "Running Horse"        # equestrian — better fit for Horses
#   "Standing Horse"       # equestrian — better fit for Horses
# And the sports-adjacent gear that stays in Hobby by design:
#   Ski Lift, Ski Pass, Ski Boot, Ski Goggles, Golf Cart, Golf Bag, Ugg Boots


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

    want = {norm(n): n for n in SPORTS}
    sheets = build("sheets", "v4", credentials=load_creds(Path(args.creds)),
                   cache_discovery=False).spreadsheets()

    # Headers live in row 2 (row 1 is section headers).
    head = sheets.values().get(spreadsheetId=args.sheet_id,
                               range=f"{args.tab}!1:2").execute().get("values", [])
    if len(head) < 2:
        sys.exit(f"ERROR: tab '{args.tab}' is missing the expected two header rows")
    headers = [h.strip() for h in head[1]]
    low = [h.lower() for h in headers]
    cat_col = next((i for i, h in enumerate(low) if h == "category"), -1)
    icon_col = next((i for i, h in enumerate(low) if h == "icon"), -1)
    if cat_col < 0 or icon_col < 0:
        sys.exit("ERROR: couldn't find both 'Category' and 'Icon' headers in row 2")
    CL, IL = col_letter(cat_col), col_letter(icon_col)
    note = "" if CL == "A" else f"  (note: Category is column {CL}, not A)"
    print(f"Category column: {CL}{note} | Icon column: {IL}")

    # Pull the icon and category columns explicitly (data starts row 3).
    icon_vals = sheets.values().get(spreadsheetId=args.sheet_id,
                                    range=f"{args.tab}!{IL}3:{IL}").execute().get("values", [])
    cat_vals = sheets.values().get(spreadsheetId=args.sheet_id,
                                   range=f"{args.tab}!{CL}3:{CL}").execute().get("values", [])
    n = max(len(icon_vals), len(cat_vals))

    changes, already, matched_keys = [], [], set()
    for i in range(n):
        name = (icon_vals[i][0].strip() if i < len(icon_vals) and icon_vals[i] else "")
        cat = (cat_vals[i][0].strip() if i < len(cat_vals) and cat_vals[i] else "")
        if not name:
            continue
        key = norm(name)
        if key not in want:
            continue
        matched_keys.add(key)
        rownum = i + 3
        if cat == TARGET_CATEGORY:
            already.append((name, rownum))
        else:
            changes.append((name, cat, rownum))

    missing = [want[k] for k in want if k not in matched_keys]

    print(f"\n{len(changes)} icon(s) will change to '{TARGET_CATEGORY}':")
    for name, cat, rownum in changes:
        print(f"  {CL}{rownum:<4} {name:<32} {cat or '(blank)'} -> {TARGET_CATEGORY}")
    if already:
        print(f"\nAlready '{TARGET_CATEGORY}' ({len(already)}): "
              + ", ".join(n for n, _ in already))
    if missing:
        print(f"\nNot found in the sheet ({len(missing)}): " + ", ".join(missing))

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

    data = [{"range": f"{args.tab}!{CL}{rownum}", "values": [[TARGET_CATEGORY]]}
            for _, _, rownum in changes]
    sheets.values().batchUpdate(
        spreadsheetId=args.sheet_id,
        body={"valueInputOption": "RAW", "data": data},
    ).execute()
    print(f"\nDone — {len(changes)} icon(s) moved to '{TARGET_CATEGORY}'. "
          "The app reflects the new category within ~60 seconds.")


if __name__ == "__main__":
    main()
