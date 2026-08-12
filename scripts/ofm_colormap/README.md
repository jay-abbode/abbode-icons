# OFM Colormap Backfill

Reads the machine color sequence directly out of every OFM linked on MASTER
(MEDIUM, falling back to LARGE/SMALL), maps Madeira Polyneon numbers to the
internal color menu, and writes:

- **Color Stops** — exact as-sewn sequence, repeats preserved (`7; 28; 37; 34; 37; ...`)
- **Thread Colors** — the same, deduped — replaces the old k-means estimates

```
pip install -r requirements.txt
python ofm_colormap.py --dry-run          # parse + report only
python ofm_colormap.py --limit 10         # small test slice
python ofm_colormap.py                    # apply (type "yes" to confirm)
python ofm_colormap.py --only-missing     # later runs: only fill new rows
python ofm_colormap.py --only-names-file f.json
                                          # only these icons (filenames or bare
                                          # names); recomputes existing stops
```

`--only-names-file` is how `add_icons.py` runs this automatically inside every
push: the pipeline writes the pushed OFM icon names to a temp JSON and scopes
this script to exactly those rows, so new icons get stops immediately and a
re-sent OFM refreshes its sequence in the same push.

`--csv-out <path>` additionally exports the **whole catalog** (Icon / Color
Stops / Thread Colors, sheet order, Excel-friendly utf-8-sig) after the sheet
write — no extra downloads, it's built from the same sheet read plus the values
just written. `add_icons` passes it on every push, landing at
`scripts/ofm_colormap/output/color_stops.csv` (override with `COLOR_STOPS_CSV`
in `.env.local`; the folder is gitignored). Skipped in `--dry-run` and on
abort, so the file always mirrors the sheet.

Service account needs: Editor on MASTER, Viewer on the OFM files/folder,
optional Viewer on the Icon Color Master List (falls back to the local
`scripts/extract_colors/madeira_polyneon.json` if not shared — same 24 codes).

Rows that fail any check (missing OFM, parse error, unmapped Madeira number,
internal consistency mismatch) are reported and left untouched.
