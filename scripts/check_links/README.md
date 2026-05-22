# Check Links

Scans every file hyperlink in your `MASTER` sheet and flags rows where the
linked Drive file's actual filename doesn't match the icon name on that row.

This is **read-only** — nothing in your sheet or Drive is modified.

## What it catches

- **MISMATCH**: the icon name is "Espresso Martini" but the linked file in
  Drive is actually named "Espresso.png". This is the case you described.
- **BROKEN_LINK**: the hyperlink points to a Drive file ID that the service
  account can't access — usually because the file was deleted, moved out of
  the shared folder, or had its permissions changed.
- **NOT_DRIVE_LINK**: the cell has a hyperlink that isn't a Drive URL (e.g. a
  Dropbox or local file:// link). Rare, but worth flagging.

## How it decides "match" vs "mismatch"

For each cell with a Drive hyperlink, it fetches the actual filename from
Drive via the service account, then compares it to the icon name on that row
by tokenizing both:

- Lowercases everything.
- Strips file extensions (.png, .ofm, .dst).
- Splits camelCase (`WeddingCake` → `wedding cake`).
- Splits on punctuation and underscores.
- Drops noise tokens: format hints (png/ofm/dst), size markers (small/medium/
  large/sm/med/lg/etc.), version markers (v1/v2/final/copy), and very short
  tokens (≤2 chars like "st", "mr").
- Then checks that every remaining token from the icon name appears in the
  filename tokens — either as an exact match or as a prefix/suffix variant of
  a 4+-character token (so "Patrick" matches "Patricks").

Examples:

| Icon name | Drive file name | Verdict |
| --- | --- | --- |
| Espresso Martini | Espresso.png | **MISMATCH** (missing "martini") |
| Wedding Cake | WeddingCake_Large.png | OK |
| Wedding Cake | Wedding-Cake.PNG | OK |
| St. Patrick's Day | St Patricks Day.png | OK |
| Heart | Sweetheart.png | **MISMATCH** |
| Anchor | anchor_v2.png | OK |

## Setup

If you already installed dependencies for the color extraction or crop
scripts, you have everything you need. Otherwise:

```cmd
cd "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons\scripts\check_links"
pip install -r requirements.txt
```

## Running

```cmd
:: Default: show only problems
python check_links.py

:: Show every link, including OKs (useful for spot-checking the algorithm)
python check_links.py --all

:: Quick test on first 50 rows
python check_links.py --limit 50
```

The script takes 1–3 minutes for 699 rows because it has to look up each
linked file's name in Drive (it uses Drive's batch API, but there are still
~5,000 file IDs to resolve).

## Output

`reports/links_check_<timestamp>.csv` with these columns:

| Column | Meaning |
| --- | --- |
| sheet_row | The row number as it appears in the Sheets UI (1-indexed, includes header rows). Jump straight to it. |
| icon_name | The icon name from the sheet's "Icon" column. |
| category | The icon's category. |
| file_column | Which file column the link is in (PNG / SMALL OFM / MEDIUM OFM / LARGE OFM / SMALL DST / MEDIUM DST / LARGE DST). |
| status | MISMATCH, BROKEN_LINK, or NOT_DRIVE_LINK. |
| file_name_in_drive | The actual filename of the linked file in Drive. Blank if the file couldn't be fetched. |
| file_id | The Drive file ID. Useful for copy-pasting into a Drive URL to inspect. |
| note | Human-readable explanation of the problem. |

Open the CSV in Excel or Google Sheets to review. Each MISMATCH row tells you
which row to fix and what file you're actually pointing to. The fix is
typically to replace the cell's hyperlink with the correct file.

## Possible false positives

The algorithm is conservative — it flags anything it can't confidently match.
Expect some false positives, especially for:

- Icons with very generic names (e.g. "Star") where the file might be named
  more specifically ("Star Burst") or vice versa.
- Names that are deliberately abbreviated in filenames ("XMas Tree" file for
  a "Christmas Tree" icon).
- Files named after a designer's internal code rather than the icon name.

These show up as MISMATCH, but a quick look at the `file_name_in_drive`
column tells you whether it's a real problem or just a naming convention
difference.

## What to do with the report

For each genuine mismatch:

1. Click the file_id (or paste into `https://drive.google.com/file/d/<id>`)
   to confirm what file the cell currently links to.
2. Open the icon's row in the sheet.
3. Replace the hyperlink in the offending cell with the correct file (use
   Drive's "Get link" on the right file and paste the URL into the cell).
4. After you've fixed everything, re-run `check_links.py` to confirm the
   problems are resolved.

Note: the sheet's catalog cache in the app is 60 seconds, so fixed links will
appear in the live site within a minute.
