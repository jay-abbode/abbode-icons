# Abbode Icon Matcher (full catalog)

Matches every website (Shopify) icon to the app catalog by shape, in color, and produces a
manual review page (`icon_review.html`) where you tag each one and export a decision CSV.

## One-time setup per run: the Shopify catalog

The tool reads your **live catalog from a product export** (no Shopify token needed):

1. Shopify admin -> **Products** -> **Export** -> **All products** -> **CSV**.
2. Drop that `.csv` into this folder (any filename containing `products_export` is picked up
   automatically; or set `SHOPIFY_EXPORT_CSV` to its path).

It keeps only products whose SKU starts with `ICON-` and uses each product's first image.

## Run it

Double-click **`run_match_preview.bat`**. First run builds a Python environment **outside
Dropbox**, installs PyTorch + DINOv2, pulls the app icons from Drive, matches all ~500
website icons, and opens `icon_review.html`. Re-runs are fast (images, fingerprints, and
Claude decisions are all cached).

**Roughly 10-15 minutes on the first run** (the Claude vision pass is the bulk and runs in
parallel); under a minute afterward.

## Prerequisites

- Python 3.9+ on PATH.
- `google-credentials.json` in this folder or the abbode-icons repo root (auto-found), or the
  `GOOGLE_SERVICE_ACCOUNT_*` env vars.
- `ANTHROPIC_API_KEY` set (`setx ANTHROPIC_API_KEY "sk-ant-..."`, then a new terminal).
- A Shopify product export CSV in the folder (see above).

## The review page

Icons are listed **alphabetically**, grouped by confidence.

Each matched pair has tag buttons (single-select): **Keep as-is / Color change / Name change /
Color + Name / Cut / Wrong match / Missed / Other**.
- *Wrong match* = the right icon is among the candidates but the pick is wrong.
- *Missed* = the right icon exists but wasn't offered as a candidate.
- **Swap:** click a better candidate, hit **Confirm swap** -> the New column updates and the
  CSV exports the icon you chose.
- Plus a note field and a Reviewed checkbox.

**Bottom: app icons with no website match** (your new additions), alphabetical, each with
**New / Other** + note. Swap a website icon onto one and it drops out of this list automatically.

**Toolbar:** live tag counts, a Reviewed X/N tracker, and filters (All / Unreviewed / by
bucket). Tags autosave in the browser; **the CSV is the real output -> click Download CSV**
(download before re-running the bat, which regenerates a fresh page).

## Download CSV columns

`shopify_gid, handle, sku, old_name, new_name, matched_png_fileid, designation, color_change,
name_change, cut, wrong_match, missed, manual_override, confidence, auto_bucket, reviewed, note`

The export doesn't carry the product GID, so `shopify_gid` is blank -- **`handle` is the stable
key** (GID can be resolved from it at update time). App-only rows leave the Shopify columns
blank, put the app icon in `new_name` / `matched_png_fileid`, and set `designation` to
`new`/`other` with `auto_bucket = app-only`.

## Knobs (optional env vars)

- `MATCH_MODEL` -- vision model (default `claude-sonnet-5`).
- `MATCH_TOP_K` -- candidates per icon (default 12). Raise if the right icon isn't appearing.
- `MATCH_CONFIRM_WORKERS` -- parallel Claude calls (default 8). Lower if you hit rate limits.
- `MATCH_APP_ONLY_LIMIT` -- cap app-only cards (default 0 = all).
- `MATCH_APP_LIMIT` -- cap the app pool (default 0 = whole catalog).

## Outputs

- `icon_review.html` -- the review page (open this).
- `match_imgs/` -- thumbnails it references (keep next to the HTML).
- `icon_match_auto.csv` -- the raw auto decisions (the tagged Download CSV is the one you act on).
