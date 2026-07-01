MACHINES — THREAD ALLOCATION (live feature) — v2
================================================

This zip is the COMPLETE Machines feature (it supersedes the first machines zip —
just unzip over the repo root and push; no need to have pushed the earlier one).

WHAT'S NEW IN THIS VERSION
--------------------------
1. Click any machine -> it opens FULL-SCREEN (enlarged diagram + table). Close
   with the X, by clicking the backdrop, or with Esc.
2. Choose WHICH heads are off-color, per fleet, with the "Off-color heads"
   toggles. Default is the last 1 head (Abbode) / last 2 heads (Webster). The
   loadouts and the change-free % recompute instantly in the browser as you
   toggle -- nothing reloads. Your selection is also carried into the printable
   day sheet (via the Print day sheet link), so the paper/PDF matches the screen.

Everything from v1 is still here: the colored spool diagrams (no Melco outline),
the Needle / # / Color name table beside each machine, the big change-free %
callout, hover-for-color-name, and the printable day sheet.

HOW IT WORKS (unchanged math, now interactive)
----------------------------------------------
Every ordered design is one "job": the colors it uses x how often it was ordered.
The app ranks color popularity, loads the top-16 / top-15 on the standard heads,
and greedily fills the off-color heads to cover the rest. The change-free % is the
share of order-weight whose design fits entirely on at least one head.

The engine (lib/threadAllocation.ts) is now PURE and client-safe, so the browser
recomputes the moment you change the off-color selection. The sheet read stays on
the server (lib/threadAllocationData.ts) -- no Shopify token in the web app.

DATA SOURCE -- rolling 3 months
  Reads the rolling-3-month THREAD_STATS tab if present, else falls back to
  ORDER_STATS (12-month) so the page works right now. To turn on the 3-month feed,
  just run your existing stats script again -- it now also writes THREAD_STATS:

      cd scripts\icon_order_stats
      python icon_order_stats.py --dry-run     (preview; shows a THREAD_STATS section)
      python icon_order_stats.py               (writes it for real)

  No new environment variables. Once it runs, /machines flips from "12-month" to
  "Rolling 3 months" on its own within ~60s.

REACHING THE PAGE
-----------------
Linked under the header's "Reports" dropdown as "Machines" (added via
components/ReportsMenu.tsx, so Header.tsx is untouched). Want a dedicated top-nav
pill instead? Send me the current components/Header.tsx and I'll wire one in.

FILES IN THIS ZIP
-----------------
  lib/threadAllocation.ts            pure allocation engine (selectable off-color)
  lib/threadAllocationData.ts        server-only sheet reader (NEW)
  components/MachinesView.tsx        interactive UI: fullscreen + off-color toggles
  components/DaySheetHeader.tsx      print bar (local date + Print button)
  components/ReportsMenu.tsx         adds the "Machines" nav entry
  app/machines/page.tsx              the /machines route
  app/machines/daysheet/page.tsx     printable day sheet (honors your selection)
  scripts/icon_order_stats/icon_order_stats.py
                                     also writes the rolling-3-month THREAD_STATS tab

Unzip over the repo root (merge/replace), then push:

  cd /d "C:\Users\abbod\Dropbox\File Processing (Don't Open)\ICON APP\abbode-icons"
  git add -A
  git commit -m "Machines: full-screen a head + selectable off-color heads (live recompute)"
  git push

Vercel auto-deploys on push.

VALIDATION DONE
---------------
  * With the default selection the engine's output is byte-for-byte identical to
    the earlier validated Python reference (same ranking, loadouts, off-color
    assignments, and change-free %). Custom selections (0 off, 2 off, etc.) were
    spot-checked and recompute correctly.
  * All new/changed .ts and .tsx transpile cleanly (esbuild).
