# Thread Color Extraction Script

Extracts dominant thread colors from every PNG in the icon catalog and matches
each color to the nearest spool in your active Madeira palette. Outputs CSV and
JSON listing, per icon, the machine slot numbers you'd thread up.

## What you'll need

- **Python 3.10 or newer** installed. If you don't have it, get it from
  [python.org/downloads](https://www.python.org/downloads/). On the installer's
  first page, **check the box that says "Add python.exe to PATH"** before
  clicking Install.
- The `google-credentials.json` file in your project root (you already have this).
- A few minutes for first install, ~5–10 minutes for the script to run on 699
  icons (subsequent runs are much faster because PNGs are cached locally).

## One-time setup

Open Command Prompt and navigate to this folder:

```cmd
cd "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons\scripts\extract_colors"
```

Install the Python dependencies:

```cmd
pip install -r requirements.txt
```

## Running

A first-run dry-run on just 10 icons, to confirm everything's wired up:

```cmd
python extract_colors.py --limit 10
```

If that produces an `output\thread_colors.csv` with reasonable-looking colors,
do the full run:

```cmd
python extract_colors.py
```

Output goes to:

- `output\thread_colors.csv` — one row per icon. Columns:
  - **slots** — comma-separated machine slot numbers (e.g. `20, 35, 8`). This
    is the "what spools do I load" answer at a glance.
  - **colors** — full readable list (e.g. `20 Navy (1643); 35 White (1801); 8 Yellow (1735)`).
  - **hex_codes** — the raw extracted hex codes, useful to spot when the
    algorithm chose a poor palette match.
- `output\thread_colors.json` — same data with per-color shares (proportion of
  the design each color covers), useful if we later want to display weighted
  swatches in the app.

PNGs are cached to `.png_cache\` so re-runs skip the download step entirely.

## How the extraction handles thread-rendered PNGs

Your PNGs aren't flat color — they show a simulated thread display with stitch
texture, sheen, and shading. A single thread color in the render produces many
pixel values (highlight + midtone + shadow). The script handles this with three
specific steps:

1. **Median filter pre-processing.** Before clustering, a 3×3 median filter
   smooths out high-frequency stitch texture while preserving sharp color
   boundaries between threads. This is what averages "sections" of the same
   thread together — exactly what you described needing.

2. **Clustering and merging in CIELAB.** The script clusters pixels in CIELAB
   color space (perceptually meaningful) and merges close clusters using a
   ΔE-style distance that **down-weights lightness**. This means the same
   thread color at different brightness levels (highlight vs shadow) lands in
   the same merged cluster, while different threads of similar brightness stay
   separate.

3. **Palette-mapped deduplication.** As a final pass, any clusters that mapped
   to the same machine spool are combined into a single output row. So if the
   clustering imperfectly split a thread into "main" and "deepest shadow"
   variants but both matched to slot 20 Navy, you get one row for slot 20
   listing the combined share, not two duplicate Navy rows.

The result: large color regions and small details both surface in the output,
and a single thread color appears once even with heavy texture in the render.

## Your palette

The script matches against the 24 colors defined in `madeira_polyneon.json`.
These are your active spool colors with their machine slot numbers (0-37, with
gaps where you don't have a spool).

The matching is straightforward: for each extracted color, find the spool with
the smallest RGB distance and report it. **No tolerance threshold** — every
extracted color gets mapped to the nearest of your 24 spools. This is intentional:
those 24 are the only colors you can actually embroider with, so "nearest" is
always the right answer.

When the algorithm picks an oddly-distant match (e.g. it pairs a sage tone with
Silver because there's no sage in your palette), the extracted hex code in the
CSV's `hex_codes` column lets you spot it and decide what to do.

## Tuning your palette colors

The RGB values in `madeira_polyneon.json` are my best-effort approximations
from the color names — they're not pulled from a spectrometer or Madeira's
official color card data. If a match is consistently wrong (e.g. your "Dusty
Pink" extracts to something that doesn't look like dusty pink), edit the JSON.

To get more accurate RGB values, the best source is Madeira's official
Polyneon shade card PDF (madeirausa.com → Resources → Color Charts). Update
an entry's `rgb` array with the better values and re-run — the script will
use the new values immediately. No need to re-download PNGs; the cache is
reused.

## Tuning the extraction algorithm

The constants near the top of `extract_colors.py`:

- `RESIZE_TO` (400): max image dimension in pixels. Higher preserves more
  small details, lower runs faster.
- `MEDIAN_FILTER_SIZE` (3): window for thread-texture smoothing. Raise to 5
  if texture artifacts are still showing up; lower to 0 to disable (then add
  back if you want).
- `INITIAL_CLUSTERS` (16): how many candidate colors k-means extracts before
  merging.
- `MIN_SHARE` (0.005 = 0.5%): minimum portion of the design a color must
  cover to appear in output. Raise to 0.01–0.02 if too many noise colors
  appear; lower to 0.002 if small details are still being missed.
- `LAB_MERGE_THRESHOLD` (8): ΔE distance below which two clusters are
  treated as the same color and merged. Higher = more aggressive merging.

## Limitations to know about

- The PNGs are *renders*, not ground truth. The median filter handles most
  stitch texture, but very stylized renders (heavy gradients, strong shadows,
  metallic effects) may still produce extra entries.
- Two visually-near-identical thread colors will collapse to one in the output.
- Because your palette is small, designs with colors outside your range will
  get assigned to whatever's numerically closest — not necessarily what
  *looks* closest perceptually. Always sanity-check via the `hex_codes` column.
