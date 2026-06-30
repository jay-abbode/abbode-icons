# Reshuffle Summer 26 + Beach

Combines the **Summer 26** and **Beach** categories into a single **Summer**
category, splits the 26 Yacht Flags (A–Z) into their own **Yacht Flags**
category, and moves the non-summer icons out to existing categories. Rewrites
the Category cell (column A) on the MASTER tab. Only Summer 26 + Beach rows are
touched.

Result (both under Shopify's 50-per-category cap):
- **Summer** — 32  (all Beach + the summer-adjacent Summer 26 icons)
- **Yacht Flags** — 26  (Yacht Flag A–Z)
- Drinks +4 (Cosmopolitan, Lemonade, Red Wine, White Wine)
- Food +1 (Watermelon Slice)
- NYC +1 (WSP Arch)
- Nature +1 (Rainbow Trout)

## Run (from this folder)
```
set GOOGLE_SHEET_ID=<the icon sheet id>
python reshuffle_summer.py --dry-run    # preview every change, writes nothing
python reshuffle_summer.py              # apply (asks you to type "yes")
```

Needs `google-credentials.json` at the repo root (the same service-account file
the other scripts use; it must have Editor access to the sheet).

## Notes
- The app derives its category list from MASTER, so the new **Summer** and
  **Yacht Flags** categories appear in the app within ~60 seconds. No redeploy.
- To tweak: edit the `MOVE_OUT` map near the top of the script. Delete a line to
  keep that icon in Summer; add `"<Icon Name>": "<Category>"` to move one out.
