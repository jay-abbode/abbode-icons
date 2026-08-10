/**
 * Per-icon order counts across the 3 / 6 / 12-month rolling windows — the data
 * behind /reports/icons and its PDF export.
 *
 * Primary source: the ICON_WINDOWS tab (written by icon_order_stats.py):
 *   Icon | Category | Thread Slots | Orders 3mo | Orders 6mo | Orders 12mo | Updated
 *
 * Fallback (until the stats job has run once with the ICON_WINDOWS writer):
 * stitch the same picture from the tabs that already exist — ORDER_STATS
 * (12-month) joined to THREAD_STATS (3-month). The 6-month window simply isn't
 * available in that mode; `available` says which windows are real so the UI can
 * grey the missing pill instead of showing zeros as if they were data.
 */

import { getSheetsClient } from "./google";
import { THREAD_PALETTE, parseThreadSlots, rgbToHex } from "./threadPalette";

export type WindowMonths = 3 | 6 | 12;
export const ALL_WINDOWS: WindowMonths[] = [3, 6, 12];

export type IconWindowStat = {
  icon: string;
  category: string;
  slots: number[];
  hexes: string[];
  /** Order count per window. 0 for a window listed in `available` means a real
   * zero; a window absent from `available` means "unknown in this mode". */
  counts: Record<WindowMonths, number>;
};

export type IconWindowsSnapshot = {
  stats: IconWindowStat[];
  available: WindowMonths[];
  /** Total icon-orders per window (sum over stats). */
  totals: Record<WindowMonths, number>;
  updatedAt: string | null;
  source: string;
};

const CACHE_TTL_MS = 60 * 1000;
let cache: { snap: IconWindowsSnapshot; expiresAt: number } | null = null;

const HEX_BY_SLOT = new Map(THREAD_PALETTE.map((t) => [t.slot, rgbToHex(t.rgb)]));

const EMPTY: IconWindowsSnapshot = {
  stats: [],
  available: [],
  totals: { 3: 0, 6: 0, 12: 0 },
  updatedAt: null,
  source: "",
};

export async function getIconWindows(
  options: { forceRefresh?: boolean } = {}
): Promise<IconWindowsSnapshot> {
  if (!options.forceRefresh && cache && cache.expiresAt > Date.now()) return cache.snap;
  const snap = (await readIconWindowsTab()) ?? (await readFallback()) ?? EMPTY;
  cache = { snap, expiresAt: Date.now() + CACHE_TTL_MS };
  return snap;
}

/** The stats sorted for one window: count desc, then 12-month count, then name. */
export function sortForWindow(stats: IconWindowStat[], months: WindowMonths): IconWindowStat[] {
  return [...stats].sort(
    (a, b) =>
      b.counts[months] - a.counts[months] ||
      b.counts[12] - a.counts[12] ||
      a.icon.localeCompare(b.icon)
  );
}

function requireSheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID is not set.");
  return id;
}

async function readTab(range: string): Promise<string[][] | null> {
  const sheets = getSheetsClient();
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: requireSheetId(), range });
    const rows = res.data.values as string[][] | undefined;
    return rows && rows.length >= 2 ? rows : null;
  } catch {
    return null;
  }
}

function num(v: unknown): number {
  return parseInt(String(v ?? "0").replace(/[^0-9-]/g, ""), 10) || 0;
}

async function readIconWindowsTab(): Promise<IconWindowsSnapshot | null> {
  const tab = process.env.GOOGLE_ICON_WINDOWS_TAB || "ICON_WINDOWS";
  const rows = await readTab(`${tab}!A1:G5000`);
  if (!rows) return null;

  const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
  const ci = (name: string) => header.indexOf(name);
  const iIcon = ci("icon");
  const iCat = ci("category");
  const iSlots = ci("thread slots");
  const i3 = ci("orders 3mo");
  const i6 = ci("orders 6mo");
  const i12 = ci("orders 12mo");
  const iUpd = ci("updated");
  if (iIcon < 0 || i3 < 0 || i6 < 0 || i12 < 0) return null;

  const stats: IconWindowStat[] = [];
  const totals: Record<WindowMonths, number> = { 3: 0, 6: 0, 12: 0 };
  let updatedAt: string | null = null;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const icon = String(row[iIcon] ?? "").trim();
    if (!icon) continue;
    if (iUpd >= 0 && row[iUpd]) updatedAt = String(row[iUpd]).trim();
    const slots = iSlots >= 0 ? parseThreadSlots(String(row[iSlots] ?? "")) : [];
    const counts: Record<WindowMonths, number> = { 3: num(row[i3]), 6: num(row[i6]), 12: num(row[i12]) };
    totals[3] += counts[3];
    totals[6] += counts[6];
    totals[12] += counts[12];
    stats.push({
      icon,
      category: iCat >= 0 ? String(row[iCat] ?? "").trim() : "",
      slots,
      hexes: slots.map((s) => HEX_BY_SLOT.get(s) ?? "#CCCCCC"),
      counts,
    });
  }
  if (!stats.length) return null;
  return { stats, available: [...ALL_WINDOWS], totals, updatedAt, source: tab };
}

/** ORDER_STATS (12mo) joined to THREAD_STATS (3mo); no 6-month data. */
async function readFallback(): Promise<IconWindowsSnapshot | null> {
  const orderTab = process.env.GOOGLE_ORDER_STATS_TAB || "ORDER_STATS";
  const threadTab = process.env.GOOGLE_THREAD_STATS_TAB || "THREAD_STATS";

  const parse = (rows: string[][] | null) => {
    if (!rows) return null;
    const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
    const ci = (name: string) => header.indexOf(name);
    const iIcon = ci("icon");
    const iCat = ci("category");
    const iCount = ci("orders");
    const iSlots = ci("thread slots");
    const iUpd = ci("updated");
    if (iIcon < 0 || iCount < 0) return null;
    const out = new Map<string, { category: string; slots: number[]; count: number }>();
    let updatedAt: string | null = null;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r] || [];
      const icon = String(row[iIcon] ?? "").trim();
      if (!icon) continue;
      if (iUpd >= 0 && row[iUpd]) updatedAt = String(row[iUpd]).trim();
      out.set(icon, {
        category: iCat >= 0 ? String(row[iCat] ?? "").trim() : "",
        slots: iSlots >= 0 ? parseThreadSlots(String(row[iSlots] ?? "")) : [],
        count: num(row[iCount]),
      });
    }
    return { out, updatedAt };
  };

  const twelve = parse(await readTab(`${orderTab}!A1:F5000`));
  if (!twelve) return null;
  const three = parse(await readTab(`${threadTab}!A1:F5000`));

  const stats: IconWindowStat[] = [];
  const totals: Record<WindowMonths, number> = { 3: 0, 6: 0, 12: 0 };
  for (const [icon, row] of twelve.out) {
    const c3 = three?.out.get(icon)?.count ?? 0;
    const counts: Record<WindowMonths, number> = { 3: c3, 6: 0, 12: row.count };
    totals[3] += c3;
    totals[12] += row.count;
    stats.push({
      icon,
      category: row.category,
      slots: row.slots,
      hexes: row.slots.map((s) => HEX_BY_SLOT.get(s) ?? "#CCCCCC"),
      counts,
    });
  }
  if (!stats.length) return null;
  return {
    stats,
    available: three ? [3, 12] : [12],
    totals,
    updatedAt: twelve.updatedAt,
    source: `${orderTab}+${threadTab}`,
  };
}
