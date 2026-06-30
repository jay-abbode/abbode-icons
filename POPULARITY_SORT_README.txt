POPULARITY SORT — browse page
=============================

Adds an "A–Z / Most popular" toggle to the browse page sort (sidebar, top).
Popularity = the Orders count per icon from the ORDER_STATS tab (rolling
12 months), joined to the catalog by icon name.

FILES IN THIS ZIP (mirrors your repo)
  lib/orderStats.ts            NEW   reads ORDER_STATS -> { iconName: orderCount }
  app/browse/page.tsx          EDIT  fetches counts, adds ?sort= param, sorts results
  components/FilterControls.tsx EDIT  adds the Sort toggle (A–Z / Most popular)

INSTALL
  1. Unzip over your repo root (merge — these replace/add only the 3 files above).
  2. git add -A && git commit -m "Add popularity sort to browse" && git push
  3. Vercel redeploys. No env vars or sheet changes needed.

HOW IT BEHAVES
  - Default (no sort chosen): alphabetical when browsing, relevance while
    searching — exactly as before, nothing regresses.
  - "Most popular": orders high -> low (ties broken A–Z). Icons with no orders
    yet sort to the bottom. Works within a category, a color filter, or a search.
  - "A–Z": forces alphabetical, even inside a search.
  - The sort choice rides along in the URL (?sort=popular), so it sticks as you
    switch categories and is shareable/bookmarkable.

NOTES
  - The toggle lives in FilterControls, which on mobile stacks above the grid,
    so it's available on phone and desktop. (FiltersMenu — the color popover by
    the search bar — is unrelated and untouched.)
  - If ORDER_STATS is ever missing/unreadable, popularity silently falls back to
    alphabetical instead of erroring (getIconOrderCounts returns {}).
  - Popularity reflects ORDER_STATS, which your icon_order_stats job refreshes.
    It's only as current as the last run of that job.
