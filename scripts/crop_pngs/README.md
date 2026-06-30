# Auto-Crop PNGs in Drive

Trims empty space around every PNG referenced in the catalog sheet by
overwriting the file in Google Drive. Backs up originals first.

**This script modifies your source PNGs in Drive. Read this README in full
before running it with `--apply`.**

## What it does

For each PNG in your `MASTER` sheet:
1. Downloads the file via the service account.
2. Detects the bounding box of non-background pixels (handles both transparent
   and white-background PNGs automatically).
3. Crops to that bounding box plus a small padding (default 5px).
4. If `--apply` is passed: saves the original to a local `backups/` folder on
   your computer, then overwrites the file in place. **The file ID stays the
   same**, so every hyperlink in your sheet keeps working. (We back up locally
   rather than copying within Drive because the service account has no Drive
   storage quota of its own, so a Drive-side copy fails.)
5. If `--apply` is NOT passed (the default): does everything except the upload.
   This is dry-run mode.

## Prerequisites

There are two one-time setup steps because this script needs write access to
your Drive, which the read-only setup you have today doesn't allow.

### 1. Give the service account Editor access to your PNG folder

In Google Drive, find the folder containing your icon PNGs. Right-click the
folder → Share. Find the service account email (the
`icon-catalog-reader@...iam.gserviceaccount.com` address from your
`google-credentials.json`). Change its role from **Viewer** to **Editor**.
Click Save.

You only need to do this for the PNG folder — the OFM and DST folders can stay
on Viewer. This script doesn't touch them.

### 2. Install Python dependencies

If you already installed Python for the color-extraction script, you have most
of what you need. From this folder:

```cmd
cd "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons\scripts\crop_pngs"
pip install -r requirements.txt
```

## Recommended workflow

**Step 1 — Dry-run on a small sample**, to verify the algorithm makes sensible
crop decisions for your PNGs:

```cmd
python crop_pngs.py --limit 5
```

Look at the report file in `reports/` (a JSON file with one entry per icon).
For each icon, you'll see the original size, the proposed new size, and the
status:

- `cropped` — would trim from original size to new size
- `already_tight` — no meaningful empty space; would be skipped
- `no_foreground` — couldn't detect content; would be skipped (investigate
  these manually)
- `no_png` — no PNG file ID in the sheet
- `error` — something went wrong; check the `error` field

**Step 2 — Dry-run on the full catalog**, no flags:

```cmd
python crop_pngs.py
```

Skim the JSON report. Watch for unexpected `no_foreground` or `error` rows.
The summary at the end shows counts for each status.

**Step 3 — Apply the changes**, when you're confident:

```cmd
python crop_pngs.py --apply
```

The script will:
1. Ask you to type `yes` to confirm.
2. Create a local backup folder `backups/<timestamp>/` inside this script folder.
3. For each icon: save the original PNG to that local folder, then overwrite
   the file in Drive in place.
4. Write a final report to `reports/`.

This takes 30–60 minutes for 700 icons (Drive API rate limits the upload
speed). Leave it running.

## Restoring from backup

If something goes wrong, the local `backups/<timestamp>/` folder contains every
original PNG (named by icon slug), and the report in `reports/` maps each slug
to its Drive file ID. The easiest way to roll back is to ask me for a one-shot
restore script that re-uploads those originals over the cropped versions — it
reuses this script's setup and runs the same way.

## Flags

| Flag | Default | Meaning |
| --- | --- | --- |
| `--apply` | off | Actually overwrite Drive files. Without this it's a dry run. |
| `--no-backup` | off | Skip saving local backups of originals. Not recommended. |
| `--backup-root DIR` | `backups/` | Local folder to store the original backups in. |
| `--padding N` | 5 | Pixels of margin to keep around the cropped design. Set to 0 for flush. |
| `--limit N` | none | Stop after processing N icons. |
| `--sheet-id` | from .env.local | Override the sheet ID. |

## What the script will and won't do

- It will only touch files whose IDs appear in the `PNG` column of your
  `MASTER` tab. PNGs sitting in Drive but not in the sheet are left alone.
- It will not re-crop already-tight PNGs (anything where the design covers
  more than 95% of the image).
- It will not change file IDs, filenames, parent folders, or sharing
  settings. Just the file content.
- It will not modify your sheet.
- It will not touch any OFM or DST files.
- File sizes after cropping are typically 20–50% smaller than the originals.

## If the algorithm makes a wrong call

If you see `cropped` rows where the bounding box doesn't look right, the most
likely culprit is the background-detection threshold. Edit `BG_THRESHOLD` in
`crop_pngs.py` (default 25). Lower values = more aggressive (counts more
pixels as foreground); higher values = more conservative.

If a PNG has very faint or low-contrast content against the background, raise
`BG_THRESHOLD` to ~15 or even 10. If the algorithm is leaving in too much
background (e.g. soft shadows), lower to ~35.

For one-off corrections after a bulk apply, you can always restore the
original from the backup folder and crop it manually.
