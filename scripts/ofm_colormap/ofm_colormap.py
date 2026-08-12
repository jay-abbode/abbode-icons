#!/usr/bin/env python3
"""Bulk-colormap the icon catalog straight from the OFM files.

For every row on the MASTER tab that has an OFM link, this script downloads the
OFM from Drive, reads the machine color sequence out of the file itself (no
stitch decoding — just the Design Status block and the palette records), maps
each Madeira Polyneon number to our internal color menu, and writes back:

  "Color Stops"     the exact as-sewn sequence, repeats preserved
                    e.g.  7; 28; 37; 34; 37; 17; 36; 35; 29
  "Thread Colors"   the same sequence deduped (first appearance order) —
                    refreshes the old k-means estimates with exact data, so
                    every existing consumer (chips, THREAD_STATS, allocation)
                    upgrades with zero code changes.

Which OFM: MEDIUM, falling back to LARGE then SMALL (fallback is reported).

Safe workflow (same as scripts/dst_backfill):
  python ofm_colormap.py --dry-run          # parse + report, writes nothing
  python ofm_colormap.py                    # apply (asks you to type "yes")
  python ofm_colormap.py --limit 10         # test slice
  python ofm_colormap.py --only-missing     # skip rows that already have stops
  python ofm_colormap.py --only-names-file f.json
                                            # only these icons (JSON list of
                                            # filenames or bare names); always
                                            # recomputes, even if stops exist —
                                            # this is how add_icons scopes the
                                            # portal push to the OFMs just sent
  python ofm_colormap.py --csv-out output/color_stops.csv
                                            # also export the whole catalog's
                                            # Icon / Color Stops / Thread Colors
                                            # to a CSV after the sheet write —
                                            # add_icons passes this on every push

Needs:
  GOOGLE_SHEET_ID          env var (or --sheet-id)
  google-credentials.json  service account at the repo root, with:
                             - Editor on the MASTER sheet
                             - at least Viewer on the OFM files/folder
                             - (optional) Viewer on the Icon Color Master List;
                               without it the local palette JSON is used, which
                               carries the same 24 Madeira codes.
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
import struct
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import olefile
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parents[1]
ENV_LOCAL = PROJECT_ROOT / ".env.local"

# Filename -> icon name (strips the SMALL/MEDIUM/LARGE suffix + extension).
# Imported from ensure-rows so the derivation lives in exactly one place.
sys.path.insert(0, str(PROJECT_ROOT / "scripts" / "ensure_rows"))
from ensure_rows import name_from_filename  # noqa: E402


def load_env_local(path: Path) -> dict:
    """Parse simple KEY=VALUE lines from .env.local (quotes stripped)."""
    out: dict = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def resolve(name, cli_value, env_local, default=None):
    """CLI flag > real env var > .env.local > default."""
    if cli_value:
        return cli_value
    if os.environ.get(name):
        return os.environ[name]
    if env_local.get(name):
        return env_local[name]
    return default
DEFAULT_CREDS = PROJECT_ROOT / "google-credentials.json"
LOCAL_PALETTE = PROJECT_ROOT / "scripts" / "extract_colors" / "madeira_polyneon.json"
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive.readonly",
]

# The internal color menu ("[NEW] Icon Color Master List"). Read live when the
# service account can see it; otherwise the local JSON fallback is used.
DEFAULT_MENU_SHEET_ID = "1LNO_urFWxNQUPUGI0vM6mHnD5TlQYXtDaoRZip2Fgqo"

DRIVE_ID_RE = re.compile(r"(?:open\?id=|/d/|[?&]id=)([A-Za-z0-9_-]{20,})")

# ---------------------------------------------------------------------------
# OFM parsing (verified against DesignShop exports: Design Status carries the
# stop count + per-stop stitch counts; the EdsIV palette records carry the
# thread numbers, and the first N records ARE the as-sewn sequence — repeats
# included, which is why this is not a deduped palette).
# ---------------------------------------------------------------------------

PALETTE_RE = re.compile(rb"(.{3})\x00\x03\x00\x00\x80(.{4})\xff\xfe\xff(.)", re.DOTALL)
COLOR_CHANGE_UTF16 = "Color Change".encode("utf-16-le")
MADEIRA_UTF16 = "Madeira".encode("utf-16-le")


@dataclass
class OfmColormap:
    total_stitches: int
    block_stitches: tuple
    stops: list  # list of (madeira_code:str, name:str, rgb:(r,g,b))
    warnings: list = field(default_factory=list)


def parse_ofm(data: bytes) -> OfmColormap:
    ole = olefile.OleFileIO(io.BytesIO(data))
    try:
        status = ole.openstream("Design Status").read()
        eds = ole.openstream("EdsIV Object").read()
    finally:
        ole.close()

    total = struct.unpack_from("<I", status, 4)[0]
    ncol = struct.unpack_from("<I", status, 0x2C)[0]
    if not (1 <= ncol <= 64):
        raise ValueError(f"implausible stop count {ncol}")
    blocks = struct.unpack_from(f"<{ncol}I", status, 0x32)

    warnings = []
    if sum(blocks) != total:
        warnings.append(
            f"block stitch counts {sum(blocks)} != total {total} — header layout may differ"
        )

    # Consistency check: N stops should mean N-1 color-change records.
    changes = eds.count(COLOR_CHANGE_UTF16)
    if changes != ncol - 1:
        warnings.append(f"{changes} color-change records for {ncol} stops")

    if MADEIRA_UTF16 not in eds:
        warnings.append("thread catalog is not Madeira — numbers may not map")

    # Named palette records live before the CDesign object.
    end = eds.find(b"CDesign")
    region = eds[:end] if end > 0 else eds
    entries = []
    for m in PALETTE_RE.finditer(region):
        r, g, b = m.group(1)
        num = struct.unpack("<I", m.group(2))[0]
        n = m.group(3)[0]
        raw = eds[m.end() : m.end() + n * 2]
        try:
            name = raw.decode("utf-16-le")
        except UnicodeDecodeError:
            continue
        if not name or not all(32 <= ord(c) < 127 for c in name):
            continue
        entries.append((str(num), name, (r, g, b)))

    if len(entries) < ncol:
        raise ValueError(f"only {len(entries)} named palette entries for {ncol} stops")

    return OfmColormap(total, blocks, entries[:ncol], warnings)


# ---------------------------------------------------------------------------
# Internal color menu: Madeira code -> slot number
# ---------------------------------------------------------------------------

def load_menu_live(sheets, menu_sheet_id):
    resp = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=menu_sheet_id, range="A1:M200")
        .execute()
    )
    rows = resp.get("values", [])
    header_idx = None
    for i, row in enumerate(rows):
        lowered = [str(c).strip().lower() for c in row]
        if "madeira no." in lowered and "color no." in lowered:
            header_idx = i
            madeira_col = lowered.index("madeira no.")
            slot_col = lowered.index("color no.")
            name_col = lowered.index("name") if "name" in lowered else None
            break
    if header_idx is None:
        raise ValueError("menu sheet: couldn't find 'Madeira No.' / 'Color No.' headers")

    mapping = {}
    for row in rows[header_idx + 1 :]:
        if len(row) <= max(madeira_col, slot_col):
            continue
        code = str(row[madeira_col]).strip()
        slot_raw = str(row[slot_col]).strip()
        if not code or not slot_raw:
            continue
        try:
            slot = int(float(slot_raw))
        except ValueError:
            continue
        name = str(row[name_col]).strip() if name_col is not None and len(row) > name_col else ""
        mapping[code] = (slot, name)
    if not mapping:
        raise ValueError("menu sheet: no mappable rows")
    return mapping


def load_menu_local():
    with open(LOCAL_PALETTE, encoding="utf-8") as f:
        data = json.load(f)
    return {str(t["code"]): (int(t["slot"]), t.get("name", "")) for t in data}


# ---------------------------------------------------------------------------
# Sheet helpers
# ---------------------------------------------------------------------------

def col_letter(idx: int) -> str:
    out = ""
    idx += 1
    while idx > 0:
        idx, rem = divmod(idx - 1, 26)
        out = chr(65 + rem) + out
    return out


def find_header(headers, candidates):
    lowered = [h.strip().lower() for h in headers]
    for cand in candidates:
        if cand.lower() in lowered:
            return lowered.index(cand.lower())
    return -1


def cell_file_id(value) -> str | None:
    if not value:
        return None
    m = DRIVE_ID_RE.search(str(value))
    return m.group(1) if m else None


def load_only_names(path: str) -> set:
    """--only-names-file: JSON list of filenames or bare icon names ->
    casefolded icon-name set (filenames get size suffix + extension stripped)."""
    items = json.loads(Path(path).read_text(encoding="utf-8"))
    return {name_from_filename(str(n)).casefold() for n in items if str(n).strip()}


def write_catalog_csv(path: str, csv_rows: dict) -> None:
    """Full-catalog export: one row per named MASTER row, in sheet order.
    utf-8-sig so Excel opens it cleanly on Windows."""
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    with open(p, "w", newline="", encoding="utf-8-sig") as fh:
        w = csv.writer(fh)
        w.writerow(["Icon", "Color Stops", "Thread Colors"])
        for r in sorted(csv_rows):
            w.writerow(csv_rows[r])
    print(f"CSV: wrote {len(csv_rows)} icon(s) -> {p}")


def download_drive_file(drive, file_id: str) -> bytes:
    buf = io.BytesIO()
    request = drive.files().get_media(fileId=file_id, supportsAllDrives=True)
    downloader = MediaIoBaseDownload(buf, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buf.getvalue()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--sheet-id", default=None)
    p.add_argument("--tab", default=None)
    p.add_argument("--creds", default=str(DEFAULT_CREDS))
    p.add_argument("--menu-sheet-id", default=None)
    p.add_argument("--dry-run", action="store_true", help="parse + report, write nothing")
    p.add_argument("--only-missing", action="store_true",
                   help="skip rows that already have a Color Stops value")
    p.add_argument("--only-names-file", default=None,
                   help="JSON list of filenames or icon names — process only those "
                        "Icon rows, recomputing even if stops already exist "
                        "(how add_icons scopes the portal push)")
    p.add_argument("--csv-out", default=None,
                   help="after the sheet write, export the whole catalog's Icon / "
                        "Color Stops / Thread Colors to this CSV (skipped in "
                        "--dry-run and on abort, so the file always matches the sheet)")
    p.add_argument("--limit", type=int, default=0, help="process at most N rows (testing)")
    args = p.parse_args()

    env_local = load_env_local(ENV_LOCAL)
    args.sheet_id = resolve("GOOGLE_SHEET_ID", args.sheet_id, env_local)
    args.tab = resolve("GOOGLE_SHEET_TAB", args.tab, env_local, "MASTER")
    args.menu_sheet_id = resolve("MENU_SHEET_ID", args.menu_sheet_id, env_local, DEFAULT_MENU_SHEET_ID)
    if not args.sheet_id:
        sys.exit("ERROR: GOOGLE_SHEET_ID not set (checked --sheet-id, env, .env.local)")

    only_names = None
    if args.only_names_file:
        try:
            only_names = load_only_names(args.only_names_file)
        except Exception as e:  # noqa: BLE001
            sys.exit(f"ERROR: couldn't read --only-names-file {args.only_names_file}: {e}")
        if not only_names:
            sys.exit(f"ERROR: --only-names-file {args.only_names_file} has no usable names")
        print(f"Scope: {len(only_names)} icon(s) from {Path(args.only_names_file).name} "
              "(recomputes even if stops already exist)")

    creds_path = Path(args.creds)
    if not creds_path.exists():
        sys.exit(f"ERROR: service account creds not found at {creds_path}")
    creds = service_account.Credentials.from_service_account_file(str(creds_path), scopes=SCOPES)
    sheets = build("sheets", "v4", credentials=creds)
    drive = build("drive", "v3", credentials=creds)

    # --- color menu -------------------------------------------------------
    try:
        menu = load_menu_live(sheets, args.menu_sheet_id)
        print(f"Color menu: live sheet ({len(menu)} colors)")
    except Exception as e:  # noqa: BLE001 — any failure falls back to local
        menu = load_menu_local()
        print(f"Color menu: LOCAL fallback {LOCAL_PALETTE.name} ({len(menu)} colors)")
        print(f"  (live sheet unavailable: {e})")

    # --- headers ----------------------------------------------------------
    hdr_resp = (
        sheets.spreadsheets()
        .values()
        .get(spreadsheetId=args.sheet_id, range=f"{args.tab}!2:2")
        .execute()
    )
    headers = [str(h) for h in (hdr_resp.get("values") or [[]])[0]]

    i_icon = find_header(headers, ["Icon"])
    i_med = find_header(headers, ["MEDIUM OFM", "Medium OFM"])
    i_lrg = find_header(headers, ["LARGE OFM", "Large OFM"])
    i_sml = find_header(headers, ["SMALL OFM", "Small OFM"])
    i_thr = find_header(headers, ["Thread Colors", "THREAD COLORS", "Thread Color", "Threads"])
    i_stp = find_header(headers, ["Color Stops", "COLOR STOPS", "Color Sequence", "Stops"])
    if i_icon < 0 or i_med < 0:
        sys.exit("ERROR: couldn't find 'Icon' / 'MEDIUM OFM' headers in row 2")
    if i_thr < 0:
        sys.exit("ERROR: couldn't find the 'Thread Colors' header in row 2")

    create_stops_header = False
    if i_stp < 0:
        i_stp = len(headers)  # first column past the current headers
        create_stops_header = True
    stops_l, thread_l = col_letter(i_stp), col_letter(i_thr)
    print(f"Columns: Color Stops -> {stops_l}"
          f"{' (new — header will be created)' if create_stops_header else ''}, "
          f"Thread Colors -> {thread_l}")

    # --- rows -------------------------------------------------------------
    # spreadsheets.get with the `hyperlink` field — the same read the app's
    # lib/sheets.ts does — so OFM links resolve whether the cell holds an
    # =HYPERLINK() formula, a rich-text link, or a bare URL.
    data_resp = (
        sheets.spreadsheets()
        .get(
            spreadsheetId=args.sheet_id,
            ranges=[f"{args.tab}!A3:BZ5000"],
            fields="sheets.data.rowData.values(formattedValue,hyperlink,userEnteredValue)",
        )
        .execute()
    )
    rows = (data_resp.get("sheets") or [{}])[0].get("data", [{}])[0].get("rowData", [])

    def cell(row, idx):
        vals = row.get("values") or []
        c = vals[idx] if idx < len(vals) else None
        return (c or {}).get("formattedValue") or ""

    def cell_link(row, idx):
        vals = row.get("values") or []
        c = vals[idx] if idx < len(vals) else None
        if not c:
            return None
        if c.get("hyperlink"):
            return c["hyperlink"]
        ue = c.get("userEnteredValue") or {}
        return ue.get("formulaValue") or ue.get("stringValue")

    updates = []          # (range, value)
    report = {"ok": 0, "no_ofm": [], "fallback": [], "errors": [], "unmapped": [],
              "inconsistent": [], "not_on_sheet": [], "skipped_existing": 0}
    processed = 0
    matched = set()       # casefolded scoped names actually found on the sheet
    csv_rows = {}         # sheet_row -> [name, stops, threads] (whole catalog)

    for r, row in enumerate(rows):
        sheet_row = r + 3
        if not row:
            continue
        name = str(cell(row, i_icon)).strip()
        if not name:
            continue

        # Snapshot the current sheet values first — every named row lands in the
        # CSV; rows we colormap below get their fresh values overlaid.
        csv_rows[sheet_row] = [name, str(cell(row, i_stp)).strip(),
                               str(cell(row, i_thr)).strip()]

        if only_names is not None:
            if name.casefold() not in only_names:
                continue
            matched.add(name.casefold())

        if args.only_missing and str(cell(row, i_stp)).strip():
            report["skipped_existing"] += 1
            continue

        file_id, size_used = None, None
        for idx, label in ((i_med, "MEDIUM"), (i_lrg, "LARGE"), (i_sml, "SMALL")):
            if idx < 0:
                continue
            fid = cell_file_id(cell_link(row, idx))
            if fid:
                file_id, size_used = fid, label
                break
        if not file_id:
            report["no_ofm"].append(name)
            continue
        if size_used != "MEDIUM":
            report["fallback"].append(f"{name} ({size_used})")

        if args.limit and processed >= args.limit:
            break
        processed += 1

        try:
            blob = download_drive_file(drive, file_id)
            cm = parse_ofm(blob)
        except Exception as e:  # noqa: BLE001 — collect and continue
            report["errors"].append(f"{name}: {type(e).__name__}: {e}")
            continue

        hard_warn = [w for w in cm.warnings if "color-change" in w or "!=" in w]
        if hard_warn:
            report["inconsistent"].append(f"{name}: {'; '.join(hard_warn)}")
            continue

        slots, missing = [], []
        for code, cname, _rgb in cm.stops:
            hit = menu.get(code)
            if hit is None:
                missing.append(f"{code} ({cname})")
            else:
                slots.append(hit[0])
        if missing:
            report["unmapped"].append(f"{name}: {', '.join(missing)}")
            continue

        stops_str = "; ".join(str(s) for s in slots)
        deduped = []
        for s in slots:
            if s not in deduped:
                deduped.append(s)
        thread_str = "; ".join(str(s) for s in deduped)

        print(f"  row {sheet_row:>4}  {name:<32} {stops_str}")
        updates.append((f"{args.tab}!{stops_l}{sheet_row}", stops_str))
        updates.append((f"{args.tab}!{thread_l}{sheet_row}", thread_str))
        csv_rows[sheet_row] = [name, stops_str, thread_str]
        report["ok"] += 1
        time.sleep(0.05)  # stay well under Drive per-second quotas

    # --- report -----------------------------------------------------------
    if only_names is not None:
        report["not_on_sheet"] = sorted(only_names - matched)

    print("\n================ REPORT ================")
    print(f"colormapped: {report['ok']}")
    if report["skipped_existing"]:
        print(f"skipped (already had stops): {report['skipped_existing']}")
    for key, label in (
        ("no_ofm", "no OFM link"),
        ("fallback", "used non-MEDIUM fallback"),
        ("errors", "download/parse errors"),
        ("unmapped", "Madeira number not in menu"),
        ("inconsistent", "internal consistency check failed"),
        ("not_on_sheet", "scoped icon not found on the sheet"),
    ):
        items = report[key]
        if items:
            print(f"\n{label} ({len(items)}):")
            for it in items:
                print(f"  - {it}")

    if args.dry_run:
        print("\nDRY RUN — nothing written.")
        if args.csv_out:
            print("(--csv-out skipped in dry-run — the CSV always mirrors the sheet.)")
        return
    if not updates:
        print("\nNothing to write.")
        if args.csv_out:
            write_catalog_csv(args.csv_out, csv_rows)
        return

    answer = input(f"\nWrite {len(updates)} cells to '{args.tab}'? Type yes to apply: ")
    if answer.strip().lower() != "yes":
        print("Aborted — nothing written.")
        if args.csv_out:
            print("(--csv-out skipped on abort — the CSV always mirrors the sheet.)")
        return

    if create_stops_header:
        sheets.spreadsheets().values().update(
            spreadsheetId=args.sheet_id,
            range=f"{args.tab}!{stops_l}2",
            valueInputOption="USER_ENTERED",
            body={"values": [["Color Stops"]]},
        ).execute()

    CHUNK = 400
    for i in range(0, len(updates), CHUNK):
        chunk = updates[i : i + CHUNK]
        sheets.spreadsheets().values().batchUpdate(
            spreadsheetId=args.sheet_id,
            body={
                "valueInputOption": "USER_ENTERED",
                "data": [{"range": rng, "values": [[val]]} for rng, val in chunk],
            },
        ).execute()
        print(f"  wrote {min(i + CHUNK, len(updates))}/{len(updates)} cells")

    if args.csv_out:
        write_catalog_csv(args.csv_out, csv_rows)

    print("Done.")
    print("Refresh MASTER to see the new 'Color Stops' column, then")
    print("hard-refresh the app (Ctrl+Shift+R) — no redeploy needed for data.")


if __name__ == "__main__":
    main()
