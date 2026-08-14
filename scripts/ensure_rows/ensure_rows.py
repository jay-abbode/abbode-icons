#!/usr/bin/env python3
"""Create a MASTER row for each NEW icon being added.

For every icon name passed in (--names-file JSON list, or --name, repeatable, or
--from-files), check MASTER for a row whose Icon cell matches (normalized). If
none exists, append a new row containing:

    * the icon name              -> Icon column
    * a STATUS dropdown value     -> STATUS column   (default: DRAFT)
    * a Col. Var. dropdown value  -> Col. Var. column (default: NO)
    * today's date                -> Date Added column, if that column exists

The Date Added stamp is what the app's "New Icons" page reads. It is optional:
if MASTER has no such column nothing is written and the app falls back to the
Drive creation time of each icon's PNG. Pass --no-date to skip the stamp, or
--date YYYY-MM-DD to backdate a batch.

Category and every other column are left blank for you to fill in later. The
file-link columns (OFM / DST / PNG) get filled afterwards by the backfill step.

If a row with the same (normalized) name already exists, NOTHING is written for
that icon — its row is kept as-is and its files are overwritten in place by the
upload step upstream. So: new icon -> new row; edited icon -> existing row kept.

New rows are given the same dropdown data-validation (and formatting) as the
existing rows, copied from the first data row — the sheet's validation ranges
stop at a fixed row and wouldn't otherwise cover an appended row.

Safe by default: pass --dry-run to preview without writing.

Needs:
  GOOGLE_SHEET_ID env var (or --sheet-id)
  google-credentials.json  service account with Edit access to the sheet.
"""
import argparse
import datetime
import json
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

# File extensions we know how to derive an icon name from.
NAME_EXTS = {".png", ".ofm", ".dst"}
SIZE_RE = re.compile(r"^(.*?)[ _]+(SMALL|MEDIUM|LARGE)$", re.IGNORECASE)

# Column header lookups (row 2). First match wins — mirrors the app + backfill.
HEADER_CANDS = {
    "icon": ["icon"],
    "status": ["status"],
    "colorvar": ["col. var.", "col var", "color variation"],
    # Must stay in step with buildColumnIndex() in lib/sheets.ts — same
    # candidates, same order, so the script and the app agree on which column
    # holds the date.
    "dateadded": ["date added", "added", "added on", "date created", "created",
                  "created on"],
}


def norm(s):
    """Same normalization the backfill uses, so matching is identical."""
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


def name_from_filename(fname):
    """'Heart SMALL.ofm' -> 'Heart', 'Heart.png' -> 'Heart'."""
    stem, _ext = os.path.splitext(fname)
    m = SIZE_RE.match(stem)
    return (m.group(1) if m else stem).strip()


def to_name(item):
    """Accept either a bare icon name or a filename; derive a name only for
    known file extensions (so dotted icon names aren't mangled)."""
    _stem, ext = os.path.splitext(item)
    if ext.lower() in NAME_EXTS:
        return name_from_filename(item)
    return item.strip()


def load_creds(path):
    if not path.exists():
        sys.exit(f"ERROR: service account creds not found at {path}")
    return service_account.Credentials.from_service_account_file(str(path), scopes=SCOPES)


def main():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--names-file",
                   help="JSON file with a list of icon names OR filenames to ensure rows for")
    p.add_argument("--name", action="append", default=[],
                   help="an icon name to ensure a row for (repeatable)")
    p.add_argument("--from-files", action="append", default=[],
                   help="a filename to derive an icon name from (repeatable)")
    p.add_argument("--sheet-id", default=os.environ.get("GOOGLE_SHEET_ID"))
    p.add_argument("--tab", default=os.environ.get("GOOGLE_SHEET_TAB", "MASTER"))
    p.add_argument("--creds", default=str(DEFAULT_CREDS))
    p.add_argument("--status", default="DRAFT",
                   help="STATUS value written to new rows (default: DRAFT)")
    p.add_argument("--colorvar", default="NO",
                   help="Col. Var. value written to new rows (default: NO)")
    p.add_argument("--date", default=None,
                   help="Date Added value for new rows as YYYY-MM-DD (default: today)")
    p.add_argument("--no-date", action="store_true",
                   help="don't write a Date Added value even if the column exists")
    p.add_argument("--dry-run", action="store_true", help="preview only; write nothing")
    args = p.parse_args()
    if not args.sheet_id:
        sys.exit("ERROR: set GOOGLE_SHEET_ID (or pass --sheet-id)")

    # ---- gather requested icon names (deduped by normalized name) ----
    raw_names = list(args.name)
    raw_names += [name_from_filename(os.path.basename(f)) for f in args.from_files]
    if args.names_file:
        try:
            items = json.loads(Path(args.names_file).read_text(encoding="utf-8"))
        except Exception as e:  # noqa: BLE001
            sys.exit(f"ERROR: couldn't read --names-file: {e}")
        raw_names += [to_name(str(it)) for it in items]

    want = {}  # norm -> display name (first seen wins)
    for nm in raw_names:
        nm = (nm or "").strip()
        if nm and norm(nm) not in want:
            want[norm(nm)] = nm
    if not want:
        print("No icon names provided — nothing to do.")
        return

    creds = load_creds(Path(args.creds))
    svc = build("sheets", "v4", credentials=creds, cache_discovery=False).spreadsheets()

    # grid id for the tab (needed for the validation/format copy)
    meta = svc.get(spreadsheetId=args.sheet_id,
                   fields="sheets(properties(sheetId,title))").execute()
    gid = next((s["properties"]["sheetId"] for s in meta.get("sheets", [])
                if s["properties"]["title"] == args.tab), None)
    if gid is None:
        sys.exit(f"ERROR: tab '{args.tab}' not found")

    grid = svc.values().get(spreadsheetId=args.sheet_id, range=args.tab,
                            valueRenderOption="FORMATTED_VALUE").execute().get("values", [])
    if len(grid) < 2:
        sys.exit(f"ERROR: tab '{args.tab}' has no header rows")

    header = [str(h).strip().lower() for h in grid[1]]

    def find_col(key):
        for cand in HEADER_CANDS[key]:
            if cand in header:
                return header.index(cand)
        return -1

    icon_col = find_col("icon")
    status_col = find_col("status")
    cv_col = find_col("colorvar")
    date_col = -1 if args.no_date else find_col("dateadded")
    if icon_col < 0:
        sys.exit("ERROR: couldn't find the 'Icon' column header in row 2")

    # Resolve the stamp once so every row in a batch gets the same date.
    date_value = ""
    if date_col >= 0:
        if args.date:
            try:
                date_value = datetime.date.fromisoformat(args.date).isoformat()
            except ValueError:
                sys.exit("ERROR: --date must be YYYY-MM-DD")
        else:
            date_value = datetime.date.today().isoformat()
    elif not args.no_date:
        print("NOTE: no 'Date Added' column found in row 2 — new rows won't be "
              "date-stamped, and the app will fall back to Drive creation times.")

    # existing names + last populated Icon row (rows are 1-based; header on row 2)
    existing = set()
    last_row = 2
    for r in range(2, len(grid)):
        row = grid[r]
        val = row[icon_col].strip() if icon_col < len(row) and row[icon_col] else ""
        if val:
            existing.add(norm(val))
            last_row = r + 1

    new = [(k, d) for k, d in want.items() if k not in existing]
    have = [(k, d) for k, d in want.items() if k in existing]

    print(f"Icons requested : {len(want)}")
    if have:
        shown = ", ".join(d for _, d in have[:12]) + (" ..." if len(have) > 12 else "")
        print(f"Already in sheet: {len(have)}  (kept as-is; files overwrite in place) -> {shown}")
    print(f"New rows to add : {len(new)}"
          + (("  -> " + ", ".join(d for _, d in new[:12]) + (" ..." if len(new) > 12 else "")) if new else ""))
    if not new:
        print("Nothing to add — every icon already has a row.")
        return

    # ---- build the new rows ----
    width = max(icon_col,
                status_col if status_col >= 0 else 0,
                cv_col if cv_col >= 0 else 0,
                date_col if date_col >= 0 else 0) + 1
    start = last_row + 1
    end = start + len(new) - 1
    rows_values = []
    for _k, disp in new:
        row = [""] * width
        row[icon_col] = disp
        if status_col >= 0:
            row[status_col] = args.status
        if cv_col >= 0:
            row[cv_col] = args.colorvar
        if date_col >= 0 and date_value:
            row[date_col] = date_value
        rows_values.append(row)

    rng = f"{args.tab}!A{start}:{col_letter(width - 1)}{end}"
    date_note = f", Date Added='{date_value}'" if date_value else ""
    print(f"\nWould write rows {start}..{end}  (STATUS='{args.status}', Col. Var.='{args.colorvar}'"
          f"{date_note}, Category left blank):")
    for i, ((_k, disp), rv) in enumerate(list(zip(new, rows_values))[:12]):
        cells = {col_letter(j): v for j, v in enumerate(rv) if v}
        print(f"    row {start + i}: {cells}")
    if len(new) > 12:
        print(f"    ... and {len(new) - 12} more")

    if args.dry_run:
        print("\nDRY RUN — no rows written.")
        return

    resp = input(f"\nAppend {len(new)} new row(s) to '{args.tab}'? Type 'yes' to proceed: ")
    if resp.strip().lower() != "yes":
        print("Aborted — nothing written.")
        return

    # 1) write the values
    svc.values().update(
        spreadsheetId=args.sheet_id, range=rng,
        valueInputOption="USER_ENTERED", body={"values": rows_values},
    ).execute()

    # 2) copy formatting + dropdown data-validation from the first data row (row 3)
    #    onto the new rows. PASTE_FORMAT / PASTE_DATA_VALIDATION do NOT touch cell
    #    values, so the names/dropdown values written above are preserved.
    src = {"sheetId": gid, "startRowIndex": 2, "endRowIndex": 3,
           "startColumnIndex": 0, "endColumnIndex": width}
    dst = {"sheetId": gid, "startRowIndex": start - 1, "endRowIndex": end,
           "startColumnIndex": 0, "endColumnIndex": width}
    try:
        svc.batchUpdate(
            spreadsheetId=args.sheet_id,
            body={"requests": [
                {"copyPaste": {"source": src, "destination": dst, "pasteType": "PASTE_FORMAT"}},
                {"copyPaste": {"source": src, "destination": dst, "pasteType": "PASTE_DATA_VALIDATION"}},
            ]},
        ).execute()
        extras = "with dropdowns + formatting"
    except Exception as e:  # noqa: BLE001
        # Values are already written; only the cosmetic copy failed.
        extras = f"(values written, but couldn't copy dropdowns/formatting: {e})"

    print(f"Done — added {len(new)} row(s) at rows {start}..{end} {extras}. "
          f"Each shows in the app once you add a Category.")


if __name__ == "__main__":
    main()
