# Backfill DST links

Auto-populates the SMALL/MEDIUM/LARGE DST columns on the MASTER tab from a
Google Drive folder of exported `.dst` files. Matches each file to the right
row + size by its filename (`<Icon Name> <SIZE>.dst`), then writes a
`=HYPERLINK(...)` into the cell — same as the OFM/PNG links the app reads.

Empty cells only: any DST cell that already has a link is left untouched.
Re-run it after each export; it fills whatever is newly in the folder.

## One-time setup
1. Pick a single Drive folder for exported DSTs (e.g. "DST Exports").
2. Make sure the service account in `google-credentials.json` can see it
   (share the folder with the service-account email, Viewer is enough).
3. Get the folder's ID from its URL: `drive.google.com/drive/folders/<THIS>`.

## Run (from this folder)
```
set GOOGLE_SHEET_ID=<the icon sheet id>
python backfill_dsts.py --folder-id <DRIVE_FOLDER_ID> --dry-run   # preview, writes nothing
python backfill_dsts.py --folder-id <DRIVE_FOLDER_ID>             # apply (type "yes")
```
(You can set `DST_FOLDER_ID` as an env var instead of passing `--folder-id`.)

## What the dry-run tells you
- exactly which row/size each file will fill
- files skipped because the cell already had a link
- files whose name matched no icon row  (fix the name or add the icon)
- files not named `<Icon> <SIZE>.dst`     (rename the export)

## Notes
- File IDs only exist once a file is in Drive, so export into (or sync to) the
  Drive folder — a DST that only lives on your local disk can't be linked.
- Filenames must mirror the OFM names. Size = SMALL | MEDIUM | LARGE.
- `--overwrite` replaces already-linked DST cells (default is to keep them).
- The app reflects new links within ~60 seconds; no redeploy.
