# Add Icons — one command for the whole routine

Every time you add new icons you used to run three scripts. `add_icons.py` runs
them for you, in the right order, from a single command:

1. **Upload** — sends your locally-processed files from the **ICON LAUNCHPAD**
   folder to the right Drive folders (`.ofm`/`.dst`/`.png` routed by type). If a
   file with that name already exists it's **overwritten in place** (same Drive
   ID, so the sheet link keeps working) — so it never makes duplicates. A name
   that's already duplicated in Drive is skipped with a warning.
2. **Backfill** — links the new OFM / DST / PNG files into the MASTER sheet
   (fills only blank cells, matched by icon name).
3. **Color stops** — reads the as-sewn color sequence straight out of each OFM
   in the push and writes **Color Stops** + **Thread Colors** for exactly those
   icons (runs `scripts/ofm_colormap` scoped to the push). New icons get stops
   immediately; a re-sent OFM is recomputed, so an edit refreshes its sequence
   in the same push. Only the pushed OFMs are downloaded — never the rest of
   the catalog. It also refreshes a **whole-catalog CSV** (Icon / Color Stops /
   Thread Colors) at `scripts/ofm_colormap/output/color_stops.csv` after the
   sheet write (path overridable with `COLOR_STOPS_CSV` in `.env.local`; folder
   is gitignored). Apply runs only — skipped in dry-run because the links
   aren't on the sheet yet. Skip with `--skip-color-stops`.
4. **Auto-crop** — trims empty space around the new/changed PNGs in Drive.
5. **Auto-tag** — for any icon on the sheet that has no row in `tags.csv`, it
   generates thematic search tags and appends a row. Existing rows are never
   touched. Edit any auto-generated tags in `tags.csv` whenever you like.
6. **Tags** — writes the MASTER "Tags" column from `tags.csv`.

Order matters: upload puts the files in Drive, backfill links them, color stops
reads those just-linked OFMs, auto-crop trims the new/changed PNGs, and
auto-tag runs before the tags write so new rows reach the sheet in the same
run.

**Launchpad path:** by default it uploads from
`C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON LAUNCHPAD`. If your
folder is named/placed differently, add `LAUNCHPAD_DIR=<full path>` to
`.env.local`. The uploader walks that folder *and its subfolders*, so PNGs+OFMs
in one subfolder and DSTs in another both work with no extra setup.

**Drive write access:** uploading needs the service account (in
`google-credentials.json`) to have **Content Manager** access to the three Drive
folders — more than the read access backfill needs. The preview run tells you
per-folder whether it can write; if not, share those folders with the service
account's `client_email` and re-run.

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

---

## Editing an icon — the PORTAL flow

For changing an icon that already exists (or sending any single change), use
**PORTAL** instead of digging through the launchpad folders:

1. Edit the icon and drop its files (PNG / OFM / DST) into the **PORTAL** folder
   inside ICON LAUNCHPAD.
2. Run `python scripts\add_icons\add_icons.py --portal --apply`
   (or double-click the **PORTAL – SEND** launcher).

It force-pushes everything in PORTAL through the whole pipeline — overwrites the
files in Drive **in place** (same file IDs, so the sheet links keep working),
backfills, re-crops the PNG, and updates tags — then **files the files back**
into the launchpad (PNGs + OFMs → `NEW OFM`, DSTs → `NEW DST`, overwriting the
old versions) and leaves PORTAL empty.

Preview first with `--portal` (no `--apply`) or the **PORTAL – PREVIEW**
launcher: it shows exactly what it would push and file away, and changes
nothing. If PORTAL is empty it just tells you so.

PORTAL shares the launchpad's `.upload_manifest.json`, so after a change is sent
and filed away, a normal run won't try to re-upload it. The normal run also
ignores the PORTAL folder entirely — PORTAL is only handled by `--portal`.

Folder locations are taken from the launchpad by default (`ICON
LAUNCHPAD\PORTAL`, `\NEW OFM`, `\NEW DST`). Override in `.env.local` with
`PORTAL_DIR`, `LOCAL_PNG_OFM_DIR`, `LOCAL_DST_DIR` if yours differ.
