"""
Abbode Icon Library — Color Extraction Script
==============================================

Pulls every PNG referenced in the catalog sheet, extracts up to 8 dominant
thread colors per icon using k-means on background-stripped pixels, matches
each color to the nearest Madeira Polyneon color (if in the local database),
and writes the results to CSV and JSON.

Usage:
    cd scripts/extract_colors
    pip install -r requirements.txt
    python extract_colors.py

By default it reads google-credentials.json and a .env file from the parent
project root. Override paths with environment variables or CLI flags.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Optional

import numpy as np
from PIL import Image
from sklearn.cluster import KMeans

from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaIoBaseDownload

try:
    from tqdm import tqdm
except ImportError:  # tqdm is optional but nice; degrade gracefully
    def tqdm(it, **kwargs):
        return it


# --------------------------------------------------------------------------
# Configuration
# --------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent.parent  # abbode-icons/
DEFAULT_CREDS = PROJECT_ROOT / "google-credentials.json"
DEFAULT_MADEIRA_DB = SCRIPT_DIR / "madeira_polyneon.json"
DEFAULT_CACHE_DIR = SCRIPT_DIR / ".png_cache"
DEFAULT_OUTPUT_DIR = SCRIPT_DIR / "output"

SHEET_TAB = os.environ.get("GOOGLE_SHEET_TAB", "MASTER")

# Tunables for the color extraction algorithm
RESIZE_TO = 200          # px on the longer side; smaller = faster, less accurate
INITIAL_CLUSTERS = 12    # k-means cluster count before filtering/merging
MIN_SHARE = 0.02         # drop clusters representing < 2% of foreground
MERGE_DISTANCE = 25      # RGB Euclidean distance below which to merge colors
MAX_COLORS_OUT = 8       # cap final colors per icon
MADEIRA_MAX_DISTANCE = 60  # if no Madeira within this RGB distance, leave unmatched

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets.readonly",
    "https://www.googleapis.com/auth/drive.readonly",
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
class MadeiraColor:
    code: str
    name: str
    rgb: tuple[int, int, int]


@dataclass
class ExtractedColor:
    hex: str
    rgb: tuple[int, int, int]
    share: float            # proportion of foreground pixels in this cluster
    madeira_code: Optional[str]
    madeira_name: Optional[str]
    madeira_distance: Optional[float]

    def label(self) -> str:
        """Human-readable label: '1764 Tiger (#E88A26)' or just '#E88A26'."""
        if self.madeira_code:
            return f"{self.madeira_code} {self.madeira_name} ({self.hex})"
        return self.hex


# --------------------------------------------------------------------------
# Sheet reading
# --------------------------------------------------------------------------

def load_sheet_credentials(path: Path):
    if not path.exists():
        sys.exit(
            f"\nERROR: Service account credentials not found at {path}\n"
            f"Place your google-credentials.json file there, or pass --creds.\n"
        )
    return service_account.Credentials.from_service_account_file(
        str(path), scopes=SCOPES
    )


def read_icon_catalog(sheet_id: str, creds) -> list[IconRow]:
    """Read the MASTER tab, returning one IconRow per data row that has a PNG."""
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
        sys.exit(f"ERROR: Sheet tab '{SHEET_TAB}' has fewer than 3 rows of data.")

    # Row 1 (index 1) = headers we care about
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
        sys.exit(
            f"ERROR: Could not find required columns. Got headers: {headers}"
        )

    seen_slugs: set[str] = set()
    icons: list[IconRow] = []

    for row in row_data[2:]:
        values = row.get("values", [])
        name = _cell_text(values, col_icon)
        category = _cell_text(values, col_cat)
        if not name or not category:
            continue

        file_id = _extract_drive_id(_cell_hyperlink(values, col_png))
        slug = _make_slug(name, seen_slugs)
        seen_slugs.add(slug)

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


def _make_slug(name: str, seen: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower().replace("&", "and")).strip("-") or "icon"
    if base not in seen:
        return base
    n = 2
    while f"{base}-{n}" in seen:
        n += 1
    return f"{base}-{n}"


# --------------------------------------------------------------------------
# Drive download with caching
# --------------------------------------------------------------------------

def download_png(drive, file_id: str, cache_dir: Path) -> Optional[bytes]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = cache_dir / f"{file_id}.png"
    if cache_path.exists():
        return cache_path.read_bytes()

    try:
        request = drive.files().get_media(fileId=file_id)
        buffer = BytesIO()
        downloader = MediaIoBaseDownload(buffer, request)
        done = False
        while not done:
            _, done = downloader.next_chunk()
        data = buffer.getvalue()
        cache_path.write_bytes(data)
        return data
    except Exception as e:
        print(f"  ! Failed to download {file_id}: {e}", file=sys.stderr)
        return None


# --------------------------------------------------------------------------
# Color extraction
# --------------------------------------------------------------------------

def extract_foreground_pixels(img: Image.Image) -> np.ndarray:
    """
    Returns an (N, 3) array of RGB pixels that are *not* background.
    Handles two cases:
      - Image has alpha: pixels with alpha < 200 are background.
      - Image has no alpha: corner pixels are sampled to estimate background.
    """
    img = img.convert("RGBA")
    # Resize for speed
    img.thumbnail((RESIZE_TO, RESIZE_TO), Image.LANCZOS)
    arr = np.array(img)
    h, w = arr.shape[:2]
    rgb = arr[..., :3]
    alpha = arr[..., 3]

    has_transparency = alpha.min() < 250
    if has_transparency:
        mask = alpha > 200
    else:
        # Background-from-corners heuristic
        corners = np.stack([
            rgb[0, 0],
            rgb[0, w - 1],
            rgb[h - 1, 0],
            rgb[h - 1, w - 1],
        ]).astype(int)
        bg = corners.mean(axis=0)
        diff = rgb.astype(int) - bg
        dist = np.sqrt((diff ** 2).sum(axis=-1))
        mask = dist > 25  # keep pixels clearly different from background

    pixels = rgb[mask]
    return pixels.astype(np.uint8)


def cluster_colors(pixels: np.ndarray) -> list[tuple[np.ndarray, float]]:
    """
    k-means cluster the pixels; return list of (rgb_center, share) sorted by share.
    """
    if len(pixels) < 50:
        # Very few foreground pixels — image is probably blank or tiny.
        return []

    # Subsample for speed on large images
    if len(pixels) > 8000:
        idx = np.random.RandomState(42).choice(len(pixels), 8000, replace=False)
        pixels = pixels[idx]

    k = min(INITIAL_CLUSTERS, len(pixels))
    km = KMeans(n_clusters=k, n_init=5, random_state=42).fit(pixels)
    labels = km.labels_
    centers = km.cluster_centers_

    counts = np.bincount(labels, minlength=k)
    shares = counts / counts.sum()
    pairs = sorted(zip(centers, shares), key=lambda p: p[1], reverse=True)
    return [(c.astype(int), float(s)) for c, s in pairs]


def filter_and_merge(clusters: list[tuple[np.ndarray, float]]) -> list[tuple[np.ndarray, float]]:
    """Drop low-share clusters; merge clusters within MERGE_DISTANCE."""
    kept: list[tuple[np.ndarray, float]] = []
    for center, share in clusters:
        if share < MIN_SHARE:
            continue
        # Try to merge into an existing cluster
        merged = False
        for i, (kc, ks) in enumerate(kept):
            dist = np.linalg.norm(center.astype(int) - kc.astype(int))
            if dist < MERGE_DISTANCE:
                # Weighted average
                total = ks + share
                new_center = (kc * ks + center * share) / total
                kept[i] = (new_center.astype(int), total)
                merged = True
                break
        if not merged:
            kept.append((center, share))
    kept.sort(key=lambda p: p[1], reverse=True)
    return kept[:MAX_COLORS_OUT]


def rgb_to_hex(rgb) -> str:
    r, g, b = (int(max(0, min(255, v))) for v in rgb)
    return f"#{r:02X}{g:02X}{b:02X}"


# --------------------------------------------------------------------------
# Madeira matching
# --------------------------------------------------------------------------

def load_madeira_db(path: Path) -> list[MadeiraColor]:
    if not path.exists():
        return []
    raw = json.loads(path.read_text(encoding="utf-8"))
    return [
        MadeiraColor(code=str(e["code"]), name=e["name"], rgb=tuple(e["rgb"]))
        for e in raw
    ]


def match_madeira(rgb, db: list[MadeiraColor]) -> tuple[Optional[MadeiraColor], Optional[float]]:
    if not db:
        return None, None
    target = np.array(rgb, dtype=int)
    best = None
    best_dist = float("inf")
    for color in db:
        dist = np.linalg.norm(target - np.array(color.rgb, dtype=int))
        if dist < best_dist:
            best_dist = dist
            best = color
    if best_dist > MADEIRA_MAX_DISTANCE:
        return None, best_dist
    return best, best_dist


# --------------------------------------------------------------------------
# Main pipeline
# --------------------------------------------------------------------------

def process_icon(
    icon: IconRow,
    drive,
    madeira_db: list[MadeiraColor],
    cache_dir: Path,
) -> list[ExtractedColor]:
    if not icon.png_file_id:
        return []

    png_bytes = download_png(drive, icon.png_file_id, cache_dir)
    if not png_bytes:
        return []

    try:
        img = Image.open(BytesIO(png_bytes))
    except Exception as e:
        print(f"  ! Could not open PNG for {icon.name}: {e}", file=sys.stderr)
        return []

    pixels = extract_foreground_pixels(img)
    if len(pixels) == 0:
        return []

    clusters = cluster_colors(pixels)
    final = filter_and_merge(clusters)

    result: list[ExtractedColor] = []
    for center, share in final:
        rgb = tuple(int(c) for c in center)
        match, dist = match_madeira(rgb, madeira_db)
        result.append(ExtractedColor(
            hex=rgb_to_hex(rgb),
            rgb=rgb,
            share=share,
            madeira_code=match.code if match else None,
            madeira_name=match.name if match else None,
            madeira_distance=dist,
        ))
    return result


def write_outputs(results: list[tuple[IconRow, list[ExtractedColor]]], out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "thread_colors.csv"
    json_path = out_dir / "thread_colors.json"

    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["slug", "name", "category", "color_count", "colors", "hex_codes"])
        for icon, colors in results:
            labels = "; ".join(c.label() for c in colors)
            hex_only = "; ".join(c.hex for c in colors)
            w.writerow([icon.slug, icon.name, icon.category, len(colors), labels, hex_only])

    payload = [
        {
            "slug": icon.slug,
            "name": icon.name,
            "category": icon.category,
            "colors": [
                {
                    "hex": c.hex,
                    "rgb": list(c.rgb),
                    "share": round(c.share, 4),
                    "madeira_code": c.madeira_code,
                    "madeira_name": c.madeira_name,
                }
                for c in colors
            ],
        }
        for icon, colors in results
    ]
    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    print(f"\n  Wrote {csv_path}")
    print(f"  Wrote {json_path}")


def main():
    parser = argparse.ArgumentParser(description="Extract thread colors from icon PNGs.")
    parser.add_argument("--sheet-id", default=os.environ.get("GOOGLE_SHEET_ID"))
    parser.add_argument("--creds", type=Path, default=DEFAULT_CREDS)
    parser.add_argument("--madeira", type=Path, default=DEFAULT_MADEIRA_DB)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE_DIR)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT_DIR)
    parser.add_argument("--limit", type=int, default=None, help="Process at most N icons (for testing)")
    args = parser.parse_args()

    if not args.sheet_id:
        # Try reading from .env.local in the project root
        env_file = PROJECT_ROOT / ".env.local"
        if env_file.exists():
            for line in env_file.read_text(encoding="utf-8").splitlines():
                if line.startswith("GOOGLE_SHEET_ID="):
                    args.sheet_id = line.split("=", 1)[1].strip().strip('"').strip("'")
                    break
    if not args.sheet_id:
        sys.exit("ERROR: GOOGLE_SHEET_ID not set. Pass --sheet-id or set the env var.")

    print(f"Loading credentials from {args.creds}")
    creds = load_sheet_credentials(args.creds)

    print(f"Reading sheet {args.sheet_id} (tab: {SHEET_TAB})")
    icons = read_icon_catalog(args.sheet_id, creds)
    print(f"  Found {len(icons)} icons")

    if args.limit:
        icons = icons[: args.limit]
        print(f"  Limiting to first {len(icons)} for this run")

    madeira_db = load_madeira_db(args.madeira)
    print(f"Loaded {len(madeira_db)} Madeira colors")

    drive = build("drive", "v3", credentials=creds)

    results: list[tuple[IconRow, list[ExtractedColor]]] = []
    skipped_no_png = 0
    skipped_empty = 0

    for icon in tqdm(icons, desc="Extracting colors"):
        if not icon.png_file_id:
            skipped_no_png += 1
            results.append((icon, []))
            continue
        colors = process_icon(icon, drive, madeira_db, args.cache)
        if not colors:
            skipped_empty += 1
        results.append((icon, colors))

    print(f"\nDone.")
    print(f"  Processed: {len(results)}")
    print(f"  Skipped (no PNG): {skipped_no_png}")
    print(f"  Skipped (extraction failed or blank): {skipped_empty}")

    write_outputs(results, args.out)


if __name__ == "__main__":
    main()
