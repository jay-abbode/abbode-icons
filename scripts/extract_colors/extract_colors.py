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
from PIL import Image, ImageFilter
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
RESIZE_TO = 400               # px on longer side — higher than before to preserve small details
MAX_SAMPLE_PIXELS = 20000     # max foreground pixels passed to k-means; raised to keep small regions
MEDIAN_FILTER_SIZE = 3        # window size for the texture-smoothing median filter
INITIAL_CLUSTERS = 16         # candidates extracted before merging/filtering
MIN_SHARE = 0.005             # drop clusters representing < 0.5% (lower than before, to keep small details)
LAB_MERGE_THRESHOLD = 8       # ΔE in CIELAB below which two clusters are considered the same color
MAX_COLORS_OUT = 10           # cap final colors per icon
MADEIRA_MAX_DISTANCE = 999    # effectively disabled: always pick nearest palette color

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
    slot: Optional[int] = None


@dataclass
class ExtractedColor:
    hex: str
    rgb: tuple[int, int, int]
    share: float            # proportion of foreground pixels in this cluster
    madeira_code: Optional[str]
    madeira_name: Optional[str]
    madeira_slot: Optional[int]
    madeira_distance: Optional[float]

    def label(self) -> str:
        """Human-readable label.

        With a slot: '20 Navy (1643)' — slot number first since that's what
        gets dialed in on the machine.
        Without a slot: '1764 Tiger (#E88A26)' — Madeira code + hex.
        Unmatched: just the hex.
        """
        if self.madeira_slot is not None:
            return f"{self.madeira_slot} {self.madeira_name} ({self.madeira_code})"
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
    Steps:
      - Resize to RESIZE_TO on long side (preserves small details, manages CPU).
      - Apply a small median filter to RGB to smooth thread-render texture
        (highlights/shadows of the same thread color blur into one tone).
        Median is edge-preserving, so color boundaries between threads stay sharp.
      - Detect background via alpha channel if present, otherwise sample corners.
    """
    img = img.convert("RGBA")
    img.thumbnail((RESIZE_TO, RESIZE_TO), Image.LANCZOS)

    # Median-filter the RGB channels to remove thread texture without blurring edges
    rgb_img = img.convert("RGB").filter(ImageFilter.MedianFilter(size=MEDIAN_FILTER_SIZE))
    rgb_arr = np.array(rgb_img)
    alpha_arr = np.array(img.split()[-1])

    h, w = rgb_arr.shape[:2]

    has_transparency = alpha_arr.min() < 250
    if has_transparency:
        mask = alpha_arr > 200
    else:
        corners = np.stack([
            rgb_arr[0, 0],
            rgb_arr[0, w - 1],
            rgb_arr[h - 1, 0],
            rgb_arr[h - 1, w - 1],
        ]).astype(int)
        bg = corners.mean(axis=0)
        diff = rgb_arr.astype(int) - bg
        dist = np.sqrt((diff ** 2).sum(axis=-1))
        mask = dist > 25

    pixels = rgb_arr[mask]
    return pixels.astype(np.uint8)


# --------------------------------------------------------------------------
# CIELAB color space conversion
# --------------------------------------------------------------------------

def srgb_to_lab(rgb_arr: np.ndarray) -> np.ndarray:
    """
    Convert (N, 3) or (..., 3) sRGB pixels (0-255) to CIELAB (D65).
    Vectorized via numpy. Returns array of same outer shape with last axis = (L, a, b).
    """
    rgb = np.asarray(rgb_arr, dtype=float) / 255.0

    # sRGB companding -> linear RGB
    mask = rgb > 0.04045
    rgb_linear = np.where(mask, ((rgb + 0.055) / 1.055) ** 2.4, rgb / 12.92)

    # Linear RGB -> XYZ (D65)
    M = np.array([
        [0.4124564, 0.3575761, 0.1804375],
        [0.2126729, 0.7151522, 0.0721750],
        [0.0193339, 0.1191920, 0.9503041],
    ])
    xyz = rgb_linear @ M.T

    # Normalize by D65 reference white
    ref = np.array([0.95047, 1.0, 1.08883])
    xyz_n = xyz / ref

    # XYZ -> LAB
    eps = 216.0 / 24389.0
    kap = 24389.0 / 27.0
    f = np.where(xyz_n > eps, np.cbrt(xyz_n), (kap * xyz_n + 16.0) / 116.0)

    L = 116.0 * f[..., 1] - 16.0
    a = 500.0 * (f[..., 0] - f[..., 1])
    b = 200.0 * (f[..., 1] - f[..., 2])
    return np.stack([L, a, b], axis=-1)


def lab_distance(lab1, lab2) -> float:
    """
    Modified ΔE that down-weights lightness.

    For thread-rendered PNGs, simulated stitches produce a single thread color
    in many brightnesses — highlight, midtone, shadow. In raw ΔE these can be
    far apart, but they share the same hue and chroma (a, b). So we weight L
    at 0.2× to merge same-thread brightness variants while keeping different
    threads of similar lightness clearly separated.
    """
    L_WEIGHT_SQ = 0.04   # i.e. L weighted at 0.2
    l1, a1, b1 = lab1
    l2, a2, b2 = lab2
    return float(np.sqrt(L_WEIGHT_SQ * (l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2))


def cluster_colors(pixels: np.ndarray) -> list[tuple[np.ndarray, np.ndarray, float]]:
    """
    Cluster pixels in CIELAB color space — perceptually meaningful, so different
    brightnesses of the same thread color end up in the same cluster.

    Returns a list of (rgb_center, lab_center, share) sorted by share descending.
    The rgb_center is the mean RGB of pixels in that cluster (true average, not
    the LAB centroid round-tripped to RGB, which can drift slightly).
    """
    if len(pixels) < 50:
        return []

    # Subsample for k-means speed; raised cap helps catch small regions
    if len(pixels) > MAX_SAMPLE_PIXELS:
        idx = np.random.RandomState(42).choice(len(pixels), MAX_SAMPLE_PIXELS, replace=False)
        pixels = pixels[idx]

    pixels_lab = srgb_to_lab(pixels)
    k = min(INITIAL_CLUSTERS, len(pixels))
    km = KMeans(n_clusters=k, n_init=5, random_state=42).fit(pixels_lab)
    labels = km.labels_

    counts = np.bincount(labels, minlength=k)
    shares = counts / counts.sum()

    results: list[tuple[np.ndarray, np.ndarray, float]] = []
    for i in range(k):
        cluster_mask = labels == i
        if not cluster_mask.any():
            continue
        rgb_center = pixels[cluster_mask].mean(axis=0).astype(int)
        lab_center = pixels_lab[cluster_mask].mean(axis=0)
        results.append((rgb_center, lab_center, float(shares[i])))

    results.sort(key=lambda p: p[2], reverse=True)
    return results


def filter_and_merge(
    clusters: list[tuple[np.ndarray, np.ndarray, float]]
) -> list[tuple[np.ndarray, float]]:
    """
    Drop low-share clusters; merge clusters whose LAB centers are within
    LAB_MERGE_THRESHOLD of each other. Merging is weighted by share, and both
    the RGB and LAB centers are kept in sync during merges.

    Returns (rgb_center, share) tuples — LAB is dropped here since downstream
    code doesn't need it.
    """
    kept: list[list] = []  # mutable rows: [rgb, lab, share]
    for rgb_c, lab_c, share in clusters:
        if share < MIN_SHARE:
            continue

        merged = False
        for row in kept:
            if lab_distance(lab_c, row[1]) < LAB_MERGE_THRESHOLD:
                total = row[2] + share
                row[0] = ((row[0] * row[2] + rgb_c * share) / total).astype(int)
                row[1] = (row[1] * row[2] + lab_c * share) / total
                row[2] = total
                merged = True
                break
        if not merged:
            kept.append([rgb_c, lab_c, share])

    kept.sort(key=lambda r: r[2], reverse=True)
    return [(r[0], r[2]) for r in kept[:MAX_COLORS_OUT]]


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
        MadeiraColor(
            code=str(e["code"]),
            name=e["name"],
            rgb=tuple(e["rgb"]),
            slot=e.get("slot"),
        )
        for e in raw
    ]


def match_madeira(rgb, db: list[MadeiraColor]) -> tuple[Optional[MadeiraColor], Optional[float]]:
    """
    Find the nearest color in the palette by Euclidean RGB distance.

    Because the user's palette is a constrained set of physical thread spools,
    there's always a 'nearest' — we don't apply a distance threshold. If the
    distance is large, the user can see it via the extracted hex code (kept
    in the output) and judge for themselves.
    """
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
            madeira_slot=match.slot if match else None,
            madeira_distance=dist,
        ))

    # Final dedup: clusters that mapped to the same physical spool are the same
    # thread. Combine them into a single row so the output reflects actual spools,
    # not internal clustering artifacts (e.g. thread highlight + shadow).
    by_slot: dict[int, ExtractedColor] = {}
    unslotted: list[ExtractedColor] = []
    for c in result:
        if c.madeira_slot is None:
            unslotted.append(c)
            continue
        existing = by_slot.get(c.madeira_slot)
        if existing is None:
            by_slot[c.madeira_slot] = c
            continue
        # Keep the hex/rgb of whichever cluster had the larger share — that's the
        # "main" appearance of this spool in the design.
        if c.share > existing.share:
            existing.hex, existing.rgb = c.hex, c.rgb
            existing.madeira_distance = c.madeira_distance
        existing.share += c.share

    combined = list(by_slot.values()) + unslotted
    combined.sort(key=lambda c: c.share, reverse=True)
    return combined


def write_outputs(results: list[tuple[IconRow, list[ExtractedColor]]], out_dir: Path):
    out_dir.mkdir(parents=True, exist_ok=True)
    csv_path = out_dir / "thread_colors.csv"
    json_path = out_dir / "thread_colors.json"

    with csv_path.open("w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["slug", "name", "category", "color_count", "slots", "colors", "hex_codes"])
        for icon, colors in results:
            labels = "; ".join(c.label() for c in colors)
            hex_only = "; ".join(c.hex for c in colors)
            slots = ", ".join(
                str(c.madeira_slot) for c in colors if c.madeira_slot is not None
            )
            w.writerow([icon.slug, icon.name, icon.category, len(colors), slots, labels, hex_only])

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
                    "madeira_slot": c.madeira_slot,
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
