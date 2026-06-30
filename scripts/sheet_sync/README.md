# Sync sheet links to canonical Drive folders

Links the MASTER tab's OFM / DST / PNG columns to the canonical files in your
Drive folders, matching each file to its cell by `<Icon Name> <SIZE>` filename.
Each folder is scanned **recursively** (including subfolders).

- **OFM → reconcile:** re-points every OFM cell to its canonical file in
  New OFMs 2026. Fixes the wrong-design links (Adderall, Dice, Nantucket Basket,
  Ski Aussie Shepherd, Bandana X/Z, Japan Stamp) and any others. Only changes a
  cell when it finds the canonical file; never blanks a cell.
- **DST → fill empty:** only fills blank DST cells; existing links untouched.
- **PNG → fill empty:** same, for the single PNG column.

Only files named `<Icon> SMALL|MEDIUM|LARGE.ofm/.dst` are used for OFM/DST.
PNG uses `<Icon>.png` (no size). Files that don't match are reported, not guessed.

## Run (from this folder) — DRY RUN FIRST
```
set GOOGLE_SHEET_ID=1zP1wTjPpYxhEQ4GnF8pCLdZj1DiyoGIrwEr3VWrLbqo

python sync_files.py ^
  --ofm-folder 1w2lm2dDm8y7hYLmgTM09bV9KqbG27dpg ^
  --dst-folder 1Odohy4THFilMdJ6Ur-fMGo-UojLrpElc ^
  --png-folder 1kJRvCNe_uZnuwKVxL-mHDA_ucJY5HSf4 ^
  --dry-run

# then drop --dry-run to apply (it asks you to type "yes")
```
Run one type at a time by passing only that folder (e.g. just `--ofm-folder`).

## Needs
- `google-credentials.json` at the repo root (the same service account the other
  scripts use), with **Viewer** on each folder and **Editor** on the sheet.

## What the dry-run shows
- OFM: every cell it will re-point (old file id → canonical), and how many are
  already correct. If this number is much bigger than the 9 known bad cells, it
  means your other OFM cells currently point to older copies and it's migrating
  them all to New OFMs 2026 — expected, but eyeball the list.
- DST/PNG: every blank cell it will fill, and how many were already linked.
- For all three: duplicate filenames (skipped), files matching no icon row, and
  files not following the naming pattern.

## Notes
- Writes links as `=HYPERLINK(...)`; the app and the crop script read these the
  same as the inserted links already in the sheet.
- The app reflects changes within ~60 seconds; no redeploy.
