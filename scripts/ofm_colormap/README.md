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
```

Service account needs: Editor on MASTER, Viewer on the OFM files/folder,
optional Viewer on the Icon Color Master List (falls back to the local
`scripts/extract_colors/madeira_polyneon.json` if not shared — same 24 codes).

Rows that fail any check (missing OFM, parse error, unmapped Madeira number,
internal consistency mismatch) are reported and left untouched.
