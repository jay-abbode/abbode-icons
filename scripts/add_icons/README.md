# Add Icons — one command for the whole routine

Every time you add new icons you used to run three scripts. `add_icons.py` runs
them for you, in the right order, from a single command:

1. **Backfill** — links the new OFM / DST / PNG files into the MASTER sheet
   (fills only blank cells, matched by icon name).
2. **Auto-crop** — trims empty space around the catalog PNGs in Drive.
3. **Auto-tag** — for any icon on the sheet that has no row in `tags.csv`, it
   generates thematic search tags (from the icon's category + name) and appends
   a row, so new icons are never left untagged. Existing rows are never touched,
   so your hand-written tags are safe. Edit any auto-generated tags in `tags.csv`
   whenever you like.
4. **Tags** — writes the MASTER "Tags" column from `tags.csv`.

Order matters: backfill runs first so a brand-new PNG is linked before auto-crop
looks for it, and auto-tag runs before the tags write so new rows reach the sheet
in the same run.

## One-time setup

1. Install the dependencies (covers all three steps):
   ```
   pip install -r scripts/add_icons/requirements.txt
   ```
2. Make sure `google-credentials.json` is at the repo root (the same service
   account the other scripts use — it needs Edit access to the sheet and to the
   Drive folders).
3. Add your three Drive folder IDs to `.env.local` at the repo root, next to the
   `GOOGLE_SHEET_ID` line that's already there:
   ```
   GOOGLE_SHEET_ID=...        (already present)
   OFM_FOLDER_ID=<id of the folder holding the .ofm files>
   DST_FOLDER_ID=<id of the folder holding the .dst files>
   PNG_FOLDER_ID=<id of the folder holding the .png files>
   ```
   (A folder's ID is the last part of its Drive URL:
   `drive.google.com/drive/folders/THIS_PART`.)

## Everyday use

```
cd scripts/add_icons

python add_icons.py           # 1) PREVIEW — shows what each step would do, changes nothing
python add_icons.py --apply   # 2) DO IT — writes for real (asks you to confirm once)
```

That's it. On a real run, auto-crop only processes the PNGs that backfill just
linked, so you're not re-downloading all ~700 icons every time.

## Handy flags

- `--crop-all` — re-crop the **whole** catalog, not just the newly-linked icons.
- `--print-commands` — show the three sub-commands it would run, then stop.
- `--skip-backfill` / `--skip-crop` / `--skip-tags` — run only the steps you want.
- `--overwrite` — tags: replace existing Tags cells (default keeps your edits).
- `--limit N` — crop: only process N icons (handy for a quick test).
- `--no-backup` — crop: skip the local backup of originals (not recommended).

Settings are resolved in this order: a command-line flag, then an environment
variable, then `.env.local`. So once the folder IDs are in `.env.local`, the bare
`python add_icons.py --apply` is all you need.

## Notes

- **Safe by default.** With no flags nothing is written — it's a dry run.
- **One confirmation.** In `--apply` mode you confirm once; the individual steps
  don't ask again.
- The three underlying scripts still work on their own if you ever need to run
  just one (`backfill_blanks.py`, `crop_pngs.py`, `populate_tags.py`).
- Preview can't show the crop step for brand-new icons, because a PNG isn't
  linked until backfill actually writes. Run `--apply` (or use `--crop-all` to
  preview cropping across the existing catalog).
