# Icon Tags (thematic search)

One-time setup that fills the "Tags" column on the MASTER tab so the app's
search can match themes like "summer", "sports", "new england", or "college".

## Files
- `tags.csv` — generated theme tags for every icon (columns: Icon, Tags)
- `populate_tags.py` — writes tags.csv into the MASTER sheet, matched by icon name

## Run (from this folder)
```
set GOOGLE_SHEET_ID=<the icon sheet id>
python populate_tags.py --dry-run    # preview, writes nothing
python populate_tags.py              # write
```

Needs `google-credentials.json` at the repo root — the same service-account
file the order-stats populator uses (it must have Editor access to the sheet).

## After it runs
- The app picks up tags within ~60 seconds — no redeploy needed.
- Edit tags any time directly in the MASTER "Tags" column (comma-separated).
- Re-runs PRESERVE any cells you've edited; pass `--overwrite` to replace them.
- New icons: type a few tags into their Tags cell when you add them
  (name and color search work regardless).
- The script lists any sheet rows it couldn't match and any CSV icons not
  found in the sheet, so gaps are easy to spot.
