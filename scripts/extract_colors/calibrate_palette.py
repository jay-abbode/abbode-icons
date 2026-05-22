"""
Abbode Icon Library — Calibrate Palette from Reference Images
==============================================================

Given a folder of reference images (one per thread color, named by slot
number), this script computes the representative RGB value for each thread
from the actual thread-rendered pixels, and writes those values into
madeira_polyneon.json. The main extraction script will then match against
real measured colors instead of my guesses.

Usage:
    cd scripts/extract_colors
    python calibrate_palette.py --samples-dir ./palette_samples

    # Inspect proposed changes without writing:
    python calibrate_palette.py --samples-dir ./palette_samples --dry-run

How to name the reference images:
    Each image's filename should START with the slot number for that thread.
    Anything after the number is optional and ignored, so all of these work:
        0.png
        0_burgundy.png
        0-burgundy-1567.png
        20.png
        20 navy.jpg

    The script accepts .png, .jpg, .jpeg, .webp, .gif, .bmp.

How the images should look:
    Each image should show ONE thread color rendered in your embroidery
    software (the same artificial thread display you see in the icon PNGs).
    A solid-ish patch is fine; doesn't have to be huge — a few hundred pixels
    across is plenty.

    Pure-color swatches from a non-rendered chart (e.g. flat hex squares)
    will work too, but the whole point of this is to calibrate against the
    *rendered* appearance, so prefer the rendered versions when possible.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image


SCRIPT_DIR = Path(__file__).resolve().parent
DEFAULT_PALETTE = SCRIPT_DIR / "madeira_polyneon.json"
DEFAULT_SAMPLES_DIR = SCRIPT_DIR / "palette_samples"

SUPPORTED_EXTS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp"}
SLOT_RE = re.compile(r"^(\d+)")


def extract_representative_color(img_path: Path) -> tuple[int, int, int]:
    """
    Computes a robust representative color for a thread sample image:
      - Crops to the central 50% of the image (avoids edges/labels/borders).
      - Filters out transparent or near-white pixels (background).
      - Returns the per-channel MEDIAN of remaining pixels.

    Median is preferred over mean because it ignores outliers (stray
    highlights, anti-aliased edges, watermarks) and stays anchored on the
    dominant thread color.
    """
    img = Image.open(img_path).convert("RGBA")
    arr = np.array(img)
    h, w = arr.shape[:2]

    # Central 50% of image
    cy, cx = h // 2, w // 2
    rh, rw = max(1, h // 4), max(1, w // 4)
    center = arr[cy - rh: cy + rh, cx - rw: cx + rw]
    rgb = center[..., :3]
    alpha = center[..., 3]

    # Build a mask of "real thread" pixels: opaque AND not near-white
    sums = rgb.astype(int).sum(axis=-1)
    mask = (alpha > 200) & (sums < 720)   # 720 = ~240 per channel

    if mask.sum() < 50:
        # Too aggressive — relax the filter and try again
        mask = alpha > 200
    if mask.sum() < 50:
        # Still nothing — use everything in center
        mask = np.ones(rgb.shape[:2], dtype=bool)

    pixels = rgb[mask]
    median = np.median(pixels, axis=0).astype(int)
    return (int(median[0]), int(median[1]), int(median[2]))


def find_samples(samples_dir: Path) -> dict[int, Path]:
    """Map slot-number -> first matching sample file in the folder."""
    by_slot: dict[int, Path] = {}
    for f in sorted(samples_dir.iterdir()):
        if not f.is_file() or f.suffix.lower() not in SUPPORTED_EXTS:
            continue
        m = SLOT_RE.match(f.stem)
        if not m:
            print(f"  (skipping {f.name}: doesn't start with a slot number)")
            continue
        slot = int(m.group(1))
        if slot in by_slot:
            print(f"  (warning: duplicate sample for slot {slot}: {f.name} — using {by_slot[slot].name})")
            continue
        by_slot[slot] = f
    return by_slot


def hex_str(rgb) -> str:
    r, g, b = rgb
    return f"#{r:02X}{g:02X}{b:02X}"


def main():
    parser = argparse.ArgumentParser(description="Calibrate the palette JSON from reference thread images.")
    parser.add_argument("--samples-dir", type=Path, default=DEFAULT_SAMPLES_DIR,
                        help=f"Folder of reference images (default: {DEFAULT_SAMPLES_DIR.name}/)")
    parser.add_argument("--palette", type=Path, default=DEFAULT_PALETTE,
                        help="Path to the palette JSON to update")
    parser.add_argument("--dry-run", action="store_true",
                        help="Show proposed changes without writing the file")
    args = parser.parse_args()

    if not args.samples_dir.exists():
        sys.exit(
            f"\nERROR: Sample folder not found: {args.samples_dir}\n"
            f"Create it and add one image per thread, named by slot number "
            f"(e.g. '0.png', '20.png').\n"
        )

    if not args.palette.exists():
        sys.exit(f"ERROR: Palette file not found: {args.palette}")

    palette = json.loads(args.palette.read_text(encoding="utf-8"))
    print(f"Palette: {len(palette)} entries loaded from {args.palette.name}")

    samples = find_samples(args.samples_dir)
    print(f"Samples: {len(samples)} valid images found in {args.samples_dir.name}/\n")

    if not samples:
        sys.exit("No usable sample images found. Make sure filenames start with a slot number.")

    updated = 0
    skipped = 0
    print(f"{'Slot':>4}  {'Name':22s}  {'Code':>5}  {'Old':>12}  {'New':>12}  Sample")
    print("-" * 90)
    for entry in palette:
        slot = entry["slot"]
        name = entry["name"]
        code = entry["code"]
        if slot not in samples:
            print(f"{slot:>4}  {name:22s}  {code:>5}  {hex_str(entry['rgb']):>12}  {'—':>12}  (no sample)")
            skipped += 1
            continue
        sample_path = samples[slot]
        try:
            new_rgb = extract_representative_color(sample_path)
        except Exception as e:
            print(f"{slot:>4}  {name:22s}  {code:>5}  ERROR reading {sample_path.name}: {e}")
            skipped += 1
            continue

        old_hex = hex_str(entry["rgb"])
        new_hex = hex_str(new_rgb)
        sym = "==" if entry["rgb"] == list(new_rgb) else "->"
        print(f"{slot:>4}  {name:22s}  {code:>5}  {old_hex:>12}  {new_hex:>12}  {sample_path.name}")
        entry["rgb"] = list(new_rgb)
        updated += 1

    # Warn about extra sample images that don't match a palette slot
    palette_slots = {e["slot"] for e in palette}
    extras = [s for s in samples if s not in palette_slots]
    if extras:
        print()
        print(f"  Note: {len(extras)} sample image(s) didn't match any palette slot: {sorted(extras)}")

    print()
    if args.dry_run:
        print(f"Dry-run: would update {updated} entries, skip {skipped}. Pass without --dry-run to write.")
    else:
        args.palette.write_text(json.dumps(palette, indent=2), encoding="utf-8")
        print(f"Wrote {args.palette.name}: updated {updated} entries, kept {skipped} unchanged.")
        print(f"Re-run 'python extract_colors.py --limit 10' to see the calibrated matches.")


if __name__ == "__main__":
    main()
