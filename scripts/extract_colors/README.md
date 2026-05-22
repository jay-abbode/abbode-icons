# Thread Color Extraction Script

Extracts dominant thread colors from every PNG in the icon catalog, attempts to
match each color against a Madeira Polyneon color database, and writes results
to CSV (for pasting into the sheet) and JSON (for programmatic use).

## What you'll need

- **Python 3.10 or newer** installed. If you don't have it, get it from
  [python.org/downloads](https://www.python.org/downloads/). On the installer's
  first page, **check the box that says "Add python.exe to PATH"** before
  clicking Install.
- The `google-credentials.json` file in your project root (you already have this).
- A few minutes for first install, ~5–10 minutes for the script to run on 699 icons
  (subsequent runs are much faster because PNGs are cached locally).

## One-time setup

Open Command Prompt and navigate to this folder:

```cmd
cd "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons\scripts\extract_colors"
```

Install the Python dependencies:

```cmd
pip install -r requirements.txt
```

This installs Pillow (image library), scikit-learn (clustering), the Google
API client, and a couple small helpers. Takes 1–2 minutes the first time.

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

- `output\thread_colors.csv` — one row per icon, columns include a `colors`
  cell with all matched threads (e.g. `1633 Royal Blue (#1C409E); 1701 Soft White (#FCFAEE)`).
  Paste that column into a new "Thread Colors" column in your MASTER tab.
- `output\thread_colors.json` — the same data but with per-color shares and RGB,
  useful if we later want to display proportional swatches in the app.

PNGs are cached to `.png_cache\` so re-runs skip the download step entirely.

## Reading the output

For each icon, the script gives up to 8 thread colors, sorted by how much of the
design they cover. The label format is:

```
1633 Royal Blue (#1C409E)   ← matched to Madeira
#8A5C32                      ← no good Madeira match within tolerance
```

Both formats can appear in the same row. When you see a raw hex code, it means
the algorithm couldn't find a Madeira within ~60 RGB units of the extracted
color — usually because the color isn't in the starter database yet, not
because the extraction was bad.

## Extending the Madeira database

`madeira_polyneon.json` ships with ~80 of the most commonly used Polyneon colors.
The RGB values are approximations based on color names and Madeira's published
shade cards — they're not pulled from spectrometer measurements, so treat them
as starting points.

To add or correct entries, edit the JSON file. Each entry needs:

```json
{ "code": "1845", "name": "Slate Blue", "rgb": [88, 110, 142] }
```

If your business uses a specific subset of Madeira colors a lot, prioritize
getting those right first. You can also remove rows from the JSON if a color
isn't in your inventory — the matcher just won't suggest it.

To get authoritative RGB values, the best source is Madeira's official Polyneon
shade card PDF (madeirausa.com → Resources → Color Charts). Many entries
include Pantone cross-references, and Pantone values translate to RGB via
official Pantone-to-RGB charts.

## Tuning

The top of `extract_colors.py` has constants you can adjust if results aren't
quite right:

- `INITIAL_CLUSTERS` (default 12): how many candidate colors k-means extracts.
  Raise to catch subtle colors; lower for blockier flat-color designs.
- `MIN_SHARE` (default 0.02 = 2%): minimum portion of the design a color must
  cover to be reported. Raise to drop incidental colors.
- `MERGE_DISTANCE` (default 25): RGB distance below which two near-identical
  colors get merged into one. Raise if you're getting duplicates like
  "Royal Blue" and "Slightly Different Royal Blue."
- `MADEIRA_MAX_DISTANCE` (default 60): if no Madeira color is within this RGB
  distance, output a raw hex instead of a wrong match.

## Limitations to know about

- The PNGs are *renders*, not ground truth. Anti-aliased edges produce
  intermediate pixel colors that the algorithm tries to filter but doesn't
  always catch perfectly.
- Two visually-near-identical thread colors will collapse to one in the output.
- Highlights, shadows, or gradient effects in a render may register as extra
  "colors" that aren't real threads. Watch for these in icons with lots of
  shading.
- The starter Madeira database is small. Expect ~20–30% of extracted colors to
  fall back to hex codes until you flesh it out.
- Re-running after editing `madeira_polyneon.json` re-uses the PNG cache but
  re-does the matching, so it's fast.
