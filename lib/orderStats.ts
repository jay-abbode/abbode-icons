import { getSheetsClient } from "./google";

/**
 * Normalizes an icon name for joining the catalog (MASTER) to the ORDER_STATS
 * tab: lowercased, with runs of whitespace collapsed. Both sides are generated
 * from the same source names, so this is just defensive against stray spacing.
 */
export function normIconName(name: string): string {
  return (name || "").toLowerCase().replace(/\s+/g, " ").trim();
}

// 60s cache, same TTL as the catalog — sheet edits feel near-instant without
// hammering Google's API on every request.
const CACHE_TTL_MS = 60 * 1000;
let cache: { counts: Record<string, number>; expiresAt: number } | null = null;

/**
 * Reads the precomputed ORDER_STATS tab (written by scripts/icon_order_stats)
 * and returns a map of normalized icon name -> order count over the rolling
 * window. Used by the browse page's "Most popular" sort.
 *
 * Expected tab layout (row 1 = headers, case-insensitive):
 *   Icon | Category | Orders | Thread Slots | Window | Updated
 *
 * Returns {} if the tab is missing or malformed, so the popularity sort simply
 * degrades to alphabetical rather than erroring the page.
 */
export async function getIconOrderCounts(): Promise<Record<string, number>> {
  if (cache && cache.expiresAt > Date.now()) return cache.counts;

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) return {};
  const tab = process.env.GOOGLE_ORDER_STATS_TAB || "ORDER_STATS";

  try {
    const sheets = getSheetsClient();
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${tab}!A1:Z100000`,
    });

    const rows = res.data.values || [];
    if (rows.length < 2) return {};

    const header = rows[0].map((h) => (h || "").toString().trim().toLowerCase());
    const iconCol = header.findIndex((h) => h === "icon");
    const ordersCol = header.findIndex((h) => h === "orders");
    if (iconCol === -1 || ordersCol === -1) return {};

    const counts: Record<string, number> = {};
    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      const name = (row[iconCol] || "").toString().trim();
      if (!name) continue;

      const raw = (row[ordersCol] || "").toString().replace(/[^0-9.-]/g, "");
      const n = parseInt(raw, 10);
      if (Number.isNaN(n)) continue;

      const key = normIconName(name);
      // If a name appears more than once (e.g. multiple time windows in the
      // tab), keep the largest — that's the broadest "popularity" figure.
      counts[key] = Math.max(counts[key] ?? 0, n);
    }

    cache = { counts, expiresAt: Date.now() + CACHE_TTL_MS };
    return counts;
  } catch (err) {
    console.warn(
      "Could not read ORDER_STATS tab; popularity sort will fall back to alphabetical:",
      err instanceof Error ? err.message : err
    );
    return {};
  }
}
