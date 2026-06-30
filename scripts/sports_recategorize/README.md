# Move Hobby icons -> Sports

Reclassifies a fixed set of true-sport icons from the Hobby category into a new
"Sports" category by rewriting their Category cell (column A) on the MASTER tab.
Only the icons in the `SPORTS` list inside the script are touched.

## Run (from this folder)
```
set GOOGLE_SHEET_ID=<the icon sheet id>
python move_to_sports.py --dry-run    # preview every change, writes nothing
python move_to_sports.py              # apply (asks you to type "yes")
```

Needs `google-credentials.json` at the repo root (the same service-account file
the other scripts use; it must have Editor access to the sheet).

## Notes
- Matching is by icon name (case/spacing-insensitive), so it doesn't matter what
  order the columns are in — the Category and Icon columns are found by header.
- The app derives its category list from MASTER, so "Sports" appears in the app
  within ~60 seconds of the run. No code change or redeploy is needed.
- To move a borderline icon too (e.g. Bicycle), add its exact name to the
  `SPORTS` list near the top of the script and re-run.
