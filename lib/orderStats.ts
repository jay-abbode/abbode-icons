/**
 * Live order stats for the header "Live Order Data" dropdown.
 *
 * Reads a precomputed `ORDER_STATS` tab in the Icon List sheet — written by
 * scripts/icon_order_stats/icon_order_stats.py, which scans the Shopify Admin
 * API and joins each ordered icon to its catalog thread colors. The app just
 * reads that tab (same pattern as colorStats reads MASTER), so page loads stay
 * fast and no Shopify token lives in the web app.
 *
 * "Live" = as fresh as the last run of the stats script. Schedule that script
 * (cron / Vercel cron) for continuously fresh numbers.
 *
 * Expected tab layout (row 1 = headers, case-insensitive):
 *   Icon | Category | Orders | Thread Slots | Window | Updated
 */

import { getSheetsClient } from "./google";
import { THREAD_PALETTE, rgbToHex, parseThreadSlots } from "./threadPalette";

export type OrderStat = {
  icon: string;
  category: string;
  /** Times this icon was ordered within the window. */
  count: number;
  /** Madeira slot numbers making up the icon's design. */
  slots: number[];
  /** Hex strings for each slot, for swatch rendering. */
  hexes: string[];
};

export type OrderStatsSnapshot = {
  stats: OrderStat[];
  totalOrders: number;
  /** e.g. "Rolling 12 months". */
  window: string;
  /** ISO date the stats tab was last written, or null. */
  updatedAt: string | null;
};

const CACHE_TTL_MS = 60 * 1000;
let cache: { snap: OrderStatsSnapshot; expiresAt: number } | null = null;

const HEX_BY_SLOT = new Map(THREAD_PALETTE.map((t) => [t.slot, rgbToHex(t.rgb)]));

export async function getOrderStats(
  options: { forceRefresh?: boolean } = {}
): Promise<OrderStatsSnapshot> {
  if (!options.forceRefresh && cache && cache.expiresAt > Date.now()) {
    return cache.snap;
  }
  const snap = await fetchOrderStats();
  cache = { snap, expiresAt: Date.now() + CACHE_TTL_MS };
  return snap;
}

const EMPTY: OrderStatsSnapshot = {
  stats: [],
  totalOrders: 0,
  window: "",
  updatedAt: null,
};

async function fetchOrderStats(): Promise<OrderStatsSnapshot> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_ORDER_STATS_TAB || "ORDER_STATS";
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not set in .env.local");

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A1:F5000`,
  });

  const rows = res.data.values;
  if (!rows || rows.length < 2) return EMPTY;

  const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
  const ci = (name: string) => header.indexOf(name);
  const iIcon = ci("icon");
  const iCat = ci("category");
  const iCount = ci("orders");
  const iSlots = ci("thread slots");
  const iWin = ci("window");
  const iUpd = ci("updated");
  if (iIcon < 0 || iCount < 0) return EMPTY;

  const stats: OrderStat[] = [];
  let window = "";
  let updatedAt: string | null = null;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const icon = String(row[iIcon] ?? "").trim();
    if (!icon) continue;

    const count =
      parseInt(String(row[iCount] ?? "0").replace(/[^0-9-]/g, ""), 10) || 0;
    const slots = iSlots >= 0 ? parseThreadSlots(String(row[iSlots] ?? "")) : [];
    if (iWin >= 0 && row[iWin]) window = String(row[iWin]).trim();
    if (iUpd >= 0 && row[iUpd]) updatedAt = String(row[iUpd]).trim();

    stats.push({
      icon,
      category: iCat >= 0 ? String(row[iCat] ?? "").trim() : "",
      count,
      slots,
      hexes: slots.map((s) => HEX_BY_SLOT.get(s) ?? "#CCCCCC"),
    });
  }

  stats.sort((a, b) => b.count - a.count);
  const totalOrders = stats.reduce((sum, s) => sum + s.count, 0);
  return { stats, totalOrders, window, updatedAt };
}
