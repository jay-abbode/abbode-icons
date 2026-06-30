# Backfill blank OFM / DST / PNG cells

Fills only BLANK cells on the MASTER tab, matching files to rows by icon name:
- SMALL/MEDIUM/LARGE OFM  <- "<Icon> SMALL|MEDIUM|LARGE.ofm"
- SMALL/MEDIUM/LARGE DST  <- "<Icon> SMALL|MEDIUM|LARGE.dst"
- PNG                     <- "<Icon>.png"

Cells that already have a link are left untouched. Folders are scanned
recursively. Nothing is hardcoded — it reads whatever folders you pass.

## Run (from this folder) — dry-run first
```
set GOOGLE_SHEET_ID=1zP1wTjPpYxhEQ4GnF8pCLdZj1DiyoGIrwEr3VWrLbqo

python backfill_blanks.py ^
  --ofm-folder <OFM_FOLDER_ID> ^
  --dst-folder <DST_FOLDER_ID> ^
  --png-folder <PNG_FOLDER_ID> ^
  --dry-run

# drop --dry-run to apply (it asks you to type "yes")
```
Pass only the folders you want (e.g. just --ofm-folder) to do one type.

## Typo flagging
Any file that matches no row is listed under "matched NO icon row", with the
closest icon name in the sheet, e.g.:
  Bengal Catt SMALL.ofm   closest row: "Bengal Cat" (row 99)
That's your cue to fix the typo in the Icon column (or the file name).

## Needs
`google-credentials.json` at the repo root (same service account as the other
scripts) — Viewer on each folder, Editor on the sheet.

## Notes
- Writes links as =HYPERLINK(...); the app reads these the same as inserted links.
- PNG is matched as "<Icon>.png" (one per icon). If your PNGs are size-suffixed
  instead, they'll show up under "matched NO icon row" / wrong pattern — tell me
  and I'll switch the PNG match to a chosen size.
- App reflects changes within ~60s; no redeploy.
