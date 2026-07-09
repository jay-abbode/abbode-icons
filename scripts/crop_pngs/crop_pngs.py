"""
Abbode Icon Library — Auto-Crop PNGs in Drive (in-place)
=========================================================

Trims empty space around every PNG in the catalog. Backs up originals to a
timestamped folder in Drive BEFORE any file is overwritten.

This script is DESTRUCTIVE. By default it runs in dry-run mode and reports
what it WOULD do without uploading anything. To actually modify Drive files,
pass --apply explicitly.

Usage:
    cd scripts/crop_pngs
    pip install -r requirements.txt

    # 1. Dry run — shows what would change, no uploads
    python crop_pngs.py

    # 2. Process just a few icons to verify, still no uploads
    python crop_pngs.py --limit 5

    # 3. Once you're happy, actually apply
    python crop_pngs.py --apply

Prerequisites are documented in README.md — read those first.
"""

from __future__ import annotations

import argparse
import datetime as _dt
import json
import os
import re
import sys
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image, ImageOps

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload, MediaIoBaseUpload
from googleapiclient.errors import HttpError

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
DEFAULT_BACKUP_ROOT = SCRIPT_DIR / "backups"

SHEET_TAB = os.environ.get("GOOGLE_SHEET_TAB", "MASTER")

# Crop algorithm tunables
DEFAULT_PADDING_PX = 5     # pixels of padding kept around the design after crop
BG_THRESHOLD = 25          # how different a pixel must be from background to count as foreground
SKIP_IF_FOREGROUND_RATIO_ABOVE = 0.95  # if already this tight, skip — nothing to crop

# Drive scopes — write access required for this script.
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive",
]


# --------------------------------------------------------------------------
# Data classes
# --------------------------------------------------------------------------

@dataclass
class IconRow:
    slug: str
    name: str
    category: str
    png_file_id: Optional[str]


@dataclass
class CropResult:
    icon: IconRow
    status: str           # "cropped", "already_tight", "no_png", "no_foreground", "error"
    original_size: Optional[tuple[int, int]] = None
    new_size: Optional[tuple[int, int]] = None
    saved_bytes: Optional[int] = None
    error: Optional[str] = None


# --------------------------------------------------------------------------
# Sheet reading
# --------------------------------------------------------------------------

def load_credentials(path: Path):
    if not path.exists():
        sys.exit(f"\nERROR: Credentials not found at {path}\n")
    return service_account.Credentials.from_service_account_file(
        str(path), scopes=SCOPES
    )


def read_icon_catalog(sheet_id: str, creds) -> list[IconRow]:
    sheets = build("sheets", "v4", credentials=creds)
    resp = (
        sheets.spreadsheets()
        .get(
            spreadsheetId=sheet_id,
            ranges=[f"{SHEET_TAB}!A1:Q5000"],
            fields="sheets.data.rowData.values(formattedValue,hyperlink,userEnteredValue)",
        )
        .execute()
    )
    row_data = resp["sheets"][0]["data"][0].get("rowData", [])
    if len(row_data) < 3:
        sys.exit(f"ERROR: Tab '{SHEET_TAB}' has fewer than 3 rows.")

    header_cells = row_data[1].get("values", [])
    headers = [(c.get("formattedValue") or "").strip() for c in header_cells]

    def find_col(*names: str) -> int:
        for n in names:
            for i, h in enumerate(headers):
                if h.lower() == n.lower():
                    return i
        return -1

    col_icon = find_col("Icon")
    col_cat = find_col("Category")
    col_png = find_col("PNG")
    if min(col_icon, col_cat, col_png) < 0:
        sys.exit(f"ERROR: Missing required columns. Headers: {headers}")

    seen: set[str] = set()
    icons: list[IconRow] = []
    for row in row_data[2:]:
        values = row.get("values", [])
        name = _cell_text(values, col_icon)
        category = _cell_text(values, col_cat)
        if not name or not category:
            continue
        file_id = _extract_drive_id(_cell_hyperlink(values, col_png))
        slug = _make_slug(name, seen)
        seen.add(slug)
        icons.append(IconRow(slug=slug, name=name, category=category, png_file_id=file_id))

    return icons


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


def _extract_drive_id(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    m = re.search(r"/d/([a-zA-Z0-9_-]{20,})", url)
    if m:
        return m.group(1)
    m = re.search(r"[?&]id=([a-zA-Z0-9_-]{20,})", url)
    if m:
        return m.group(1)
    return None


def _norm_name(name: str) -> str:
    """Match icon names the same way backfill does: lowercase, non-alnum -> space,
    collapse whitespace. Lets --only names line up with sheet names regardless of
    punctuation or spacing."""
    s = (name or "").lower().strip()
    s = re.sub(r"[^a-z0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _load_only_names(only: Optional[str], only_file: Optional[str]) -> Optional[set]:
    """Build the set of normalized names to keep, or None if no filter given."""
    names: list[str] = []
    if only:
        names += [n for n in only.split(",")]
    if only_file:
        p = Path(only_file)
        if not p.exists():
            sys.exit(f"ERROR: --only-file not found at {p}")
        raw = p.read_text(encoding="utf-8").strip()
        parsed = None
        if raw:
            try:
                parsed = json.loads(raw)
            except json.JSONDecodeError:
                parsed = None
        if isinstance(parsed, dict):
            parsed = parsed.get("png_icons") or parsed.get("icons") or parsed.get("names") or []
        if isinstance(parsed, list):
            names += [str(x) for x in parsed]
        elif parsed is None and raw:
            names += [ln for ln in raw.splitlines()]
    if only is None and only_file is None:
        return None
    return {_norm_name(n) for n in names if n and n.strip()}


def _make_slug(name: str, seen: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower().replace("&", "and")).strip("-") or "icon"
    if base not in seen:
        return base
    n = 2
    while f"{base}-{n}" in seen:
        n += 1
    return f"{base}-{n}"


# --------------------------------------------------------------------------
# Drive operations
# --------------------------------------------------------------------------

def download_png(drive, file_id: str) -> bytes:
    request = drive.files().get_media(fileId=file_id, supportsAllDrives=True)
    buffer = BytesIO()
    downloader = MediaIoBaseDownload(buffer, request)
    done = False
    while not done:
        _, done = downloader.next_chunk()
    return buffer.getvalue()


def overwrite_png(drive, file_id: str, new_bytes: bytes) -> None:
    """Replace the file's content with new_bytes, preserving file ID and name."""
    media = MediaIoBaseUpload(BytesIO(new_bytes), mimetype="image/png", resumable=False)
    drive.files().update(
        fileId=file_id, media_body=media, supportsAllDrives=True
    ).execute()


# --------------------------------------------------------------------------
# Cropping
# --------------------------------------------------------------------------

def compute_crop_bbox(img: Image.Image) -> Optional[tuple[int, int, int, int]]:
    """
    Return (left, top, right, bottom) for the tight bounding box of foreground
    content, or None if no foreground was detected.

    Handles two cases automatically:
      - Image has a real alpha channel: bbox of opaque pixels.
      - Image is solid-background: estimates background from corners, then
        bboxes pixels that differ from it by more than BG_THRESHOLD.
    """
    rgba = img.convert("RGBA")
    arr = np.array(rgba)
    h, w = arr.shape[:2]
    alpha = arr[..., 3]

    if alpha.min() < 250:
        # True alpha. Use opaque-ish pixels.
        mask = alpha > 200
    else:
        # No transparency. Sniff background from corners.
        rgb = arr[..., :3].astype(int)
        corners = np.stack([rgb[0, 0], rgb[0, w - 1], rgb[h - 1, 0], rgb[h - 1, w - 1]])
        bg = corners.mean(axis=0)
        diff = rgb - bg
        dist = np.sqrt((diff ** 2).sum(axis=-1))
        mask = dist > BG_THRESHOLD

    if not mask.any():
        return None

    rows = np.where(mask.any(axis=1))[0]
    cols = np.where(mask.any(axis=0))[0]
    top, bottom = int(rows[0]), int(rows[-1]) + 1
    left, right = int(cols[0]), int(cols[-1]) + 1
    return (left, top, right, bottom)


def expand_bbox(bbox, padding: int, img_size) -> tuple[int, int, int, int]:
    l, t, r, b = bbox
    w, h = img_size
    return (
        max(0, l - padding),
        max(0, t - padding),
        min(w, r + padding),
        min(h, b + padding),
    )


def foreground_ratio(bbox, img_size) -> float:
    l, t, r, b = bbox
    w, h = img_size
    return ((r - l) * (b - t)) / float(w * h)


def crop_png_bytes(
    png_bytes: bytes, padding: int
) -> tuple[Optional[bytes], dict]:
    """
    Returns (new_png_bytes_or_None, info_dict).
    info_dict always contains: original_size, status, [new_size, foreground_ratio]
    new_png_bytes_or_None is None if no crop is needed or no foreground detected.
    """
    img = Image.open(BytesIO(png_bytes))
    img.load()
    original_size = img.size

    bbox = compute_crop_bbox(img)
    if bbox is None:
        return None, {
            "status": "no_foreground",
            "original_size": original_size,
        }

    ratio = foreground_ratio(bbox, original_size)
    if ratio >= SKIP_IF_FOREGROUND_RATIO_ABOVE:
        return None, {
            "status": "already_tight",
            "original_size": original_size,
            "foreground_ratio": ratio,
        }

    padded = expand_bbox(bbox, padding, original_size)
    cropped = img.crop(padded)

    out = BytesIO()
    # Preserve PNG format. Use optimize for slightly smaller files.
    cropped.save(out, format="PNG", optimize=True)
    return out.getvalue(), {
        "status": "cropped",
        "original_size": original_size,
        "new_size": cropped.size,
        "foreground_ratio": ratio,
    }


# --------------------------------------------------------------------------
# Main pipeline
# --------------------------------------------------------------------------

def process_one(
    icon: IconRow,
    drive,
    *,
    apply: bool,
    backup_dir: Optional[Path],
    padding: int,
) -> CropResult:
    if not icon.png_file_id:
        return CropResult(icon=icon, status="no_png")

    try:
        png_bytes = download_png(drive, icon.png_file_id)
    except Exception as e:
        return CropResult(icon=icon, status="error", error=f"download: {e}")

    try:
        new_bytes, info = crop_png_bytes(png_bytes, padding)
    except Exception as e:
        return CropResult(icon=icon, status="error", error=f"crop: {e}")

    if info["status"] != "cropped":
        return CropResult(
            icon=icon,
            status=info["status"],
            original_size=info.get("original_size"),
        )

    if apply:
        try:
            if backup_dir is not None:
                # Local backup of the ORIGINAL bytes we already downloaded above.
                # We deliberately do NOT copy the file within Drive: a Drive-side
                # copy creates a new file owned by the service account, and
                # service accounts have no Drive storage quota of their own, so
                # that copy fails. Writing the original to disk sidesteps the
                # quota issue entirely and is just as safe for restoring later.
                (backup_dir / f"{icon.slug}.png").write_bytes(png_bytes)
            # Overwriting an existing file's content (vs. creating a new one)
            # is charged to the file owner's quota, not the service account's,
            # so this succeeds without any service-account storage.
            overwrite_png(drive, icon.png_file_id, new_bytes)
        except Exception as e:
            return CropResult(
                icon=icon, status="error",
                error=f"upload: {e}",
                original_size=info["original_size"],
                new_size=info["new_size"],
            )

    return CropResult(
        icon=icon,
        status="cropped",
        original_size=info["original_size"],
        new_size=info["new_size"],
        saved_bytes=len(png_bytes) - len(new_bytes),
    )


def write_report(results: list[CropResult], report_dir: Path, apply: bool) -> Path:
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = _dt.datetime.now().strftime("%Y-%m-%d_%H%M%S")
    suffix = "applied" if apply else "dryrun"
    path = report_dir / f"crop_report_{stamp}_{suffix}.json"

    payload = [
        {
            "slug": r.icon.slug,
            "name": r.icon.name,
            "category": r.icon.category,
            "file_id": r.icon.png_file_id,
            "status": r.status,
            "original_size": list(r.original_size) if r.original_size else None,
            "new_size": list(r.new_size) if r.new_size else None,
            "saved_bytes": r.saved_bytes,
            "error": r.error,
        }
        for r in results
    ]
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path


def main():
    parser = argparse.ArgumentParser(description="Auto-crop catalog PNGs in Drive.")
    parser.add_argument("--sheet-id", default=os.environ.get("GOOGLE_SHEET_ID"))
    parser.add_argument("--creds", type=Path, default=DEFAULT_CREDS)
    parser.add_argument(
        "--apply", action="store_true",
        help="Actually modify Drive files. Without this flag, runs as a dry-run.",
    )
    parser.add_argument(
        "--no-backup", action="store_true",
        help="Skip saving local backups of originals. Not recommended.",
    )
    parser.add_argument(
        "--backup-root", type=Path, default=DEFAULT_BACKUP_ROOT,
        help=f"Local folder to store original backups in (default {DEFAULT_BACKUP_ROOT}).",
    )
    parser.add_argument(
        "--padding", type=int, default=DEFAULT_PADDING_PX,
        help=f"Pixels of margin to keep around the cropped design (default {DEFAULT_PADDING_PX}).",
    )
    parser.add_argument(
        "--limit", type=int, default=None,
        help="Process at most N icons (use during testing).",
    )
    parser.add_argument(
        "--only", default=None,
        help="Comma-separated icon names — crop only these (matched by name, "
             "case/spacing-insensitive).",
    )
    parser.add_argument(
        "--only-file", default=None,
        help="Path to a JSON list (or newline list) of icon names to crop. Used "
             "by the add_icons runner to crop just the newly-linked icons.",
    )
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

    print()
    if args.apply:
        print("=" * 60)
        print("  APPLY MODE — Drive files WILL be modified.")
        if args.no_backup:
            print("  WARNING: --no-backup is set. Originals will NOT be saved.")
        print("=" * 60)
        confirm = input("Type 'yes' to continue, anything else to abort: ").strip().lower()
        if confirm != "yes":
            sys.exit("Aborted.")
    else:
        print("Running in DRY-RUN mode. No Drive files will be modified.")
        print("Pass --apply to actually crop and overwrite.")
    print()

    creds = load_credentials(args.creds)
    print(f"Reading sheet {args.sheet_id} (tab: {SHEET_TAB})")
    icons = read_icon_catalog(args.sheet_id, creds)
    print(f"  Found {len(icons)} icons")

    only_names = _load_only_names(args.only, args.only_file)
    if only_names is not None:
        before = len(icons)
        icons = [i for i in icons if _norm_name(i.name) in only_names]
        print(f"  --only filter: {len(icons)} of {before} icon(s) match "
              f"({len(only_names)} name(s) requested)")

    if args.limit:
        icons = icons[: args.limit]
        print(f"  Limiting to first {len(icons)}")

    icons_with_png = [i for i in icons if i.png_file_id]
    print(f"  Of those, {len(icons_with_png)} have a PNG file ID")
    print()

    drive = build("drive", "v3", credentials=creds)

    # Create a LOCAL backup folder once, if applying with backups enabled.
    # Each original is saved to disk here right before its Drive file is
    # overwritten, so nothing is created inside Drive (no service-account quota).
    backup_dir: Optional[Path] = None
    if args.apply and not args.no_backup and icons_with_png:
        stamp = _dt.datetime.now().strftime("%Y-%m-%d_%H%M%S")
        backup_dir = args.backup_root / stamp
        backup_dir.mkdir(parents=True, exist_ok=True)
        print(f"  Backing up originals locally to: {backup_dir}")
        print()

    results: list[CropResult] = []
    for icon in tqdm(icons, desc="Processing"):
        results.append(
            process_one(
                icon, drive,
                apply=args.apply,
                backup_dir=backup_dir,
                padding=args.padding,
            )
        )

    # Summary
    by_status: dict[str, int] = {}
    total_saved = 0
    for r in results:
        by_status[r.status] = by_status.get(r.status, 0) + 1
        if r.saved_bytes:
            total_saved += r.saved_bytes

    print()
    print("Summary:")
    for status, count in sorted(by_status.items(), key=lambda kv: -kv[1]):
        print(f"  {status:18s} {count}")
    if total_saved:
        kb = total_saved / 1024
        print(f"  bytes_saved        {kb:.1f} KB ({total_saved} bytes)")

    report_path = write_report(results, DEFAULT_REPORT_DIR, args.apply)
    print(f"\n  Wrote report: {report_path}")

    if not args.apply:
        print()
        print("This was a dry run. To actually crop the files, re-run with --apply")


if __name__ == "__main__":
    main()
