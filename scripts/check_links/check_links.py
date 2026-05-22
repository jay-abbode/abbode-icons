"""
Abbode Icon Library — Check Links
==================================

Scans every file hyperlink in the MASTER sheet (PNG, OFM variants, DST variants)
and verifies the linked file's actual Drive filename matches the icon name on
that row. Reports mismatches and broken links.

This is READ-ONLY. It does not modify the sheet or any Drive files.

Usage:
    cd scripts/check_links
    pip install -r requirements.txt
    python check_links.py             # report only problems
    python check_links.py --all       # report every link, problems and OKs
    python check_links.py --limit 50  # check only first 50 rows
"""

from __future__ import annotations

import argparse
import csv
import datetime as _dt
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import BatchHttpRequest

try:
    from tqdm import tqdm
except ImportError:
    def tqdm(it, **kwargs):
        return it


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent
DEFAULT_CREDS = PROJECT_ROOT / "google-credentials.json"
DEFAULT_REPORT_DIR = SCRIPT_DIR / "reports"

SHEET_TAB = os.environ.get("GOOGLE_SHEET_TAB", "MASTER")
BATCH_SIZE = 100   # Drive batch API supports up to 100 sub-requests per batch

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
]

# File-column detection: a header is a "file column" if it contains one of these
# tokens (case-insensitive). Captures PNG, SMALL OFM, MEDIUM OFM, LARGE OFM,
# SMALL DST, MEDIUM DST, LARGE DST.
FILE_COL_KEYWORDS = ("PNG", "OFM", "DST")

# Tokens to drop from comparison (extensions, format hints, size markers).
NOISE_TOKENS = {
    "", "png", "ofm", "dst", "jpg", "jpeg",
    "small", "medium", "large",
    "sm", "med", "lg", "s", "m", "l", "xl",
    "v1", "v2", "v3", "final", "copy",
}


# --------------------------------------------------------------------------
# Data classes
# --------------------------------------------------------------------------

@dataclass
class LinkCheck:
    icon_name: str
    category: str
    sheet_row: int            # 1-based, as seen in the Sheets UI
    file_column: str          # "PNG", "MEDIUM OFM", etc.
    file_id: Optional[str]
    file_name_in_drive: Optional[str]
    status: str               # "OK" | "MISMATCH" | "BROKEN_LINK" | "NOT_DRIVE_LINK"
    note: str = ""


# --------------------------------------------------------------------------
# Token-based filename comparison
# --------------------------------------------------------------------------

_CAMEL_RE = re.compile(r"([a-z0-9])([A-Z])")
_EXT_RE = re.compile(r"\.(png|ofm|dst|jpe?g)$", re.IGNORECASE)


def tokenize(s: str) -> list[str]:
    """Lowercase, strip extension, split camelCase, split on non-alphanum, drop noise."""
    s = _EXT_RE.sub("", s)
    s = _CAMEL_RE.sub(r"\1 \2", s)        # WeddingCake -> Wedding Cake
    s = s.replace("'", "")                  # St. Patrick's -> St. Patricks
    s = s.lower()
    raw = re.split(r"[^a-z0-9]+", s)
    return [t for t in raw if t and t not in NOISE_TOKENS]


def _token_match(needle: str, haystack_tokens: list[str], haystack_set: set[str]) -> bool:
    """Exact match, or prefix relationship between 4+-char tokens (handles plurals/variants)."""
    if len(needle) <= 2:
        return True       # ignore very short tokens like 'st', 'mr', '&'
    if needle in haystack_set:
        return True
    if len(needle) >= 4:
        for ft in haystack_tokens:
            if len(ft) >= 4 and (ft.startswith(needle) or needle.startswith(ft)):
                return True
    return False


def filenames_match(icon_name: str, file_name: str) -> bool:
    """Return True if file_name plausibly belongs to icon_name."""
    icon_toks = tokenize(icon_name)
    file_toks = tokenize(file_name)
    if not icon_toks:
        return True   # nothing to compare against; assume OK
    file_set = set(file_toks)
    return all(_token_match(t, file_toks, file_set) for t in icon_toks)


# --------------------------------------------------------------------------
# Sheet & Drive helpers
# --------------------------------------------------------------------------

def load_credentials(path: Path):
    if not path.exists():
        sys.exit(f"\nERROR: Credentials not found at {path}\n")
    return service_account.Credentials.from_service_account_file(str(path), scopes=SCOPES)


def read_sheet(sheet_id: str, creds) -> tuple[list[str], list[list[dict]]]:
    """Return (headers, data_rows). Each data row is a list of cell dicts as
    returned by the Sheets API."""
    sheets = build("sheets", "v4", credentials=creds)
    resp = (
        sheets.spreadsheets()
        .get(
            spreadsheetId=sheet_id,
            ranges=[f"{SHEET_TAB}!A1:Z5000"],
            fields="sheets.data.rowData.values(formattedValue,hyperlink,userEnteredValue)",
        )
        .execute()
    )
    row_data = resp["sheets"][0]["data"][0].get("rowData", [])
    if len(row_data) < 3:
        sys.exit(f"ERROR: Tab '{SHEET_TAB}' has fewer than 3 rows.")
    header_cells = row_data[1].get("values", [])
    headers = [(c.get("formattedValue") or "").strip() for c in header_cells]
    data_rows = [r.get("values", []) for r in row_data[2:]]
    return headers, data_rows


def _cell_text(values, col: int) -> str:
    if col < 0 or col >= len(values):
        return ""
    return (values[col].get("formattedValue") or "").strip()


def _cell_hyperlink(values, col: int) -> Optional[str]:
    if col < 0 or col >= len(values):
        return None
    cell = values[col]
    if cell.get("hyperlink"):
        return cell["hyperlink"]
    formula = (cell.get("userEnteredValue") or {}).get("formulaValue") or ""
    if formula.upper().startswith("=HYPERLINK"):
        m = re.match(r'=HYPERLINK\s*\(\s*"([^"]+)"', formula, re.IGNORECASE)
        if m:
            return m.group(1)
    return None


def extract_drive_id(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    m = re.search(r"/d/([a-zA-Z0-9_-]{20,})", url)
    if m:
        return m.group(1)
    m = re.search(r"[?&]id=([a-zA-Z0-9_-]{20,})", url)
    if m:
        return m.group(1)
    return None


def find_file_columns(headers: list[str]) -> list[tuple[int, str]]:
    cols: list[tuple[int, str]] = []
    for i, h in enumerate(headers):
        upper = h.upper()
        if any(k in upper for k in FILE_COL_KEYWORDS):
            cols.append((i, h))
    return cols


def find_col(headers: list[str], *names: str) -> int:
    for n in names:
        for i, h in enumerate(headers):
            if h.lower() == n.lower():
                return i
    return -1


def fetch_file_names(drive, file_ids: list[str]) -> dict[str, Optional[str]]:
    """Batch-fetch filename for each file ID. Missing/inaccessible files map to None."""
    result: dict[str, Optional[str]] = {}
    unique_ids = list(set(fid for fid in file_ids if fid))

    def make_callback(fid: str):
        def cb(request_id, response, exception):
            if exception:
                result[fid] = None
            else:
                result[fid] = response.get("name")
        return cb

    for start in tqdm(range(0, len(unique_ids), BATCH_SIZE), desc="Fetching filenames"):
        chunk = unique_ids[start: start + BATCH_SIZE]
        batch = drive.new_batch_http_request()
        for fid in chunk:
            batch.add(
                drive.files().get(fileId=fid, fields="id,name"),
                callback=make_callback(fid),
            )
        batch.execute()

    return result


# --------------------------------------------------------------------------
# Main pipeline
# --------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Check Drive link integrity in the icon sheet.")
    parser.add_argument("--sheet-id", default=os.environ.get("GOOGLE_SHEET_ID"))
    parser.add_argument("--creds", type=Path, default=DEFAULT_CREDS)
    parser.add_argument("--all", action="store_true",
                        help="Include OK rows in the report (default: problems only).")
    parser.add_argument("--limit", type=int, default=None,
                        help="Process at most N data rows (for quick testing).")
    args = parser.parse_args()

    if not args.sheet_id:
        env_file = PROJECT_ROOT / ".env.local"
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                if line.startswith("GOOGLE_SHEET_ID="):
                    args.sheet_id = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not args.sheet_id:
        sys.exit("ERROR: GOOGLE_SHEET_ID not set. Pass --sheet-id or set the env var.")

    creds = load_credentials(args.creds)
    print(f"Reading sheet {args.sheet_id} (tab: {SHEET_TAB})")
    headers, data_rows = read_sheet(args.sheet_id, creds)

    col_icon = find_col(headers, "Icon")
    col_cat = find_col(headers, "Category")
    if min(col_icon, col_cat) < 0:
        sys.exit(f"ERROR: Missing 'Icon' or 'Category' column. Headers: {headers}")

    file_cols = find_file_columns(headers)
    if not file_cols:
        sys.exit("ERROR: No file columns (PNG/OFM/DST) detected in headers.")
    print(f"  Detected {len(file_cols)} file columns: {[h for _, h in file_cols]}")

    if args.limit:
        data_rows = data_rows[: args.limit]
        print(f"  Limiting to first {len(data_rows)} rows")

    # Pass 1: collect all (icon, column, file_id) tuples
    raw_checks: list[LinkCheck] = []
    for row_idx, row in enumerate(data_rows):
        icon_name = _cell_text(row, col_icon)
        category = _cell_text(row, col_cat)
        if not icon_name:
            continue
        sheet_row_num = row_idx + 3   # +1 for 1-indexing, +2 for the two header rows

        for col_idx, col_name in file_cols:
            link = _cell_hyperlink(row, col_idx)
            if not link:
                continue   # empty cell or text without hyperlink — skip silently
            file_id = extract_drive_id(link)
            if not file_id:
                raw_checks.append(LinkCheck(
                    icon_name=icon_name, category=category,
                    sheet_row=sheet_row_num, file_column=col_name,
                    file_id=None, file_name_in_drive=None,
                    status="NOT_DRIVE_LINK", note=f"Hyperlink isn't a Drive URL: {link[:80]}",
                ))
                continue
            raw_checks.append(LinkCheck(
                icon_name=icon_name, category=category,
                sheet_row=sheet_row_num, file_column=col_name,
                file_id=file_id, file_name_in_drive=None,
                status="",  # filled in pass 3
            ))

    print(f"  Collected {len(raw_checks)} file links across {len(data_rows)} rows")

    # Pass 2: batch-fetch filenames from Drive
    drive = build("drive", "v3", credentials=creds)
    file_ids = [c.file_id for c in raw_checks if c.file_id]
    print(f"  Looking up {len(set(file_ids))} unique Drive files...")
    names = fetch_file_names(drive, file_ids)

    # Pass 3: classify
    for check in raw_checks:
        if check.status:
            continue
        name = names.get(check.file_id)
        if name is None:
            check.status = "BROKEN_LINK"
            check.note = "File not found or not accessible by service account"
            continue
        check.file_name_in_drive = name
        if filenames_match(check.icon_name, name):
            check.status = "OK"
        else:
            check.status = "MISMATCH"
            check.note = f"Icon name '{check.icon_name}' doesn't appear in file name '{name}'"

    # Summary
    by_status: dict[str, int] = {}
    for c in raw_checks:
        by_status[c.status] = by_status.get(c.status, 0) + 1

    print("\nSummary:")
    for status in ("OK", "MISMATCH", "BROKEN_LINK", "NOT_DRIVE_LINK"):
        count = by_status.get(status, 0)
        print(f"  {status:18s} {count}")

    # Write report
    DEFAULT_REPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = _dt.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    report_path = DEFAULT_REPORT_DIR / f"links_check_{stamp}.csv"
    with report_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow([
            "sheet_row", "icon_name", "category", "file_column",
            "status", "file_name_in_drive", "file_id", "note",
        ])
        for c in raw_checks:
            if c.status == "OK" and not args.all:
                continue
            w.writerow([
                c.sheet_row, c.icon_name, c.category, c.file_column,
                c.status, c.file_name_in_drive or "", c.file_id or "", c.note,
            ])

    print(f"\nWrote: {report_path}")
    if not args.all and by_status.get("OK", 0):
        print(f"  (Suppressed {by_status['OK']} OK rows. Pass --all to include them.)")


if __name__ == "__main__":
    main()
