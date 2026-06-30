BUILD FIX — lib/orderStats.ts name collision
=============================================

The popularity-sort zip shipped a NEW lib/orderStats.ts, but a file by that
name already existed (it exports getOrderStats / OrderStat, used by
app/api/icon-data-export/route.ts). Unzipping overwrote the original, so the
export route lost its imports and the build failed:

  Module '"@/lib/orderStats"' has no exported member 'getOrderStats'.

THIS ZIP fixes it: a merged lib/orderStats.ts that keeps the original
getOrderStats / OrderStat / OrderStatsSnapshot AND adds the popularity-sort
helpers (getIconOrderCounts / normIconName). Both the export route and the
browse page now compile.

INSTALL (replaces ONE file)
  1. Unzip over your repo root — it overwrites lib/orderStats.ts only.
  2. Commit and push (script below). Vercel rebuilds.

Your app/browse/page.tsx and components/FilterControls.tsx from the previous
zip are correct and unchanged — no need to touch them.
