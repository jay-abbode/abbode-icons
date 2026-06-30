ORDER COUNT ON CARDS (popularity mode)
======================================

When the browse sort is set to "Most popular", each icon card now shows its
order count (rolling 12 months) as a small badge in the TOP-LEFT corner.
In any other sort (A-Z, search relevance) the badge is hidden.

  - Icons with orders -> cherry badge with a little bag icon, e.g. "1,453".
  - Icons with 0 orders -> a quiet grey badge showing "0" (so you can see
    why they're at the bottom). Easy to hide entirely if you'd prefer.
  - Numbers use thousands separators; hover shows "1,453 orders - last 12 months".

FILES IN THIS ZIP (mirrors your repo)
  components/IconGrid.tsx   EDIT  adds the badge + orderCounts/showOrderCounts props
  app/browse/page.tsx       EDIT  passes each visible icon's count into the grid

No new files, no env changes. lib/orderStats.ts is unchanged (it already
supplies the counts via getIconOrderCounts).

INSTALL
  1. Unzip over your repo root (replaces the 2 files above).
  2. Commit + push (script below). Vercel redeploys.

The count comes straight from ORDER_STATS, so it matches the popularity sort
order exactly and is as fresh as the last run of your icon_order_stats job.
