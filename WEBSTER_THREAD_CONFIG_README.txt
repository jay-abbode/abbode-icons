WEBSTER THREAD CONFIG — banner button + landing page
====================================================

WHAT CHANGED
------------
Top banner: the two pills ("Webster" and "Thread Config") are gone. One pill
replaces them — "Webster Thread Config" -> /webster/thread-config.
Both old destinations moved into the hamburger menu ("Webster Board" and
"Thread Config"), and the new page links to both in its breadcrumb, so
nothing became unreachable.

NEW PAGE: /webster/thread-config
--------------------------------
  - Webster's standing thread tree, drawn with the same <ThreadTree> renderer
    the machine pages use (Barudan 15-needle geometry). Needle 1 = the most-
    used color; the number inside each spool is its color-menu #.
  - Threads are the top 15 by TOTAL usage over the 12-month window of the
    COMPOSITE tab (icon colors + chosen text colors).
  - Coverage stat: what share of ALL thread uses in the window land on a spool
    already on the tree.
  - Below the tree: the same 15 in needle order — swatch, menu #, name,
    Madeira code, icons / text / total, share, distribution bar.
  - "Off the tree": the 9 palette colors that ranked below the cut, which is
    what off-color heads and spool swaps have to absorb.
  - Read-only by design. Per-head toggles, off-color heads, locks, scope and
    saved configs stay on /machines; the live per-order board stays on /webster.

FILES
-----
  components/Header.tsx                  two pills -> one "Webster Thread Config"
  components/MobileNav.tsx               adds Webster Thread Config; renames
                                         "Webster" -> "Webster Board"
  lib/websterThreadTree.ts               NEW — ranks COMPOSITE 12mo into a tree.
                                         Cut size = fleetBase("webster").needleCount,
                                         not a hardcoded 15.
  components/WebsterThreadTreeView.tsx   NEW — tree diagram + ordered list
  app/webster/thread-config/page.tsx     NEW — the page

ASSUMPTIONS FLAGGED
-------------------
  1. "The current thread config buttons" = BOTH banner pills (Webster and
     Thread Config). Both moved to the hamburger.
  2. "12 months of composite data" = the 12mo window of the COMPOSITE tab
     (lib/compositeStats), ranked by Total (icons + text), not icons alone.
  3. Route is /webster/thread-config (sits under the existing /webster tree).
  4. Page is read-only — it reports the standing loadout rather than editing it.

DEPENDS ON
----------
  The COMPOSITE tab being populated by scripts/icon_order_stats. If it is
  empty the page renders a clear "no composite data yet" state instead of
  a broken tree.

VALIDATION
----------
  22-assertion unit test on buildThreadTree (ranking, needle numbering, tie
  breaks, coverage math, empty sheet, partial data, needle-count drives the
  cut) — all pass. Then esbuild -> tsc --noEmit -> next build, all clean.
  /webster/thread-config appears in the route table at 2.39 kB.

REDEPLOY
--------
  App-code change — Vercel redeploy required (auto on push).
