/**
 * Trend stats for the "Trends" page.
 *
 * Surfaces what's *rising / spiking right now* rather than all-time popular:
 *   - Trending icons      — icons gaining orders fastest.
 *   - Trending text colors — the thread color customers pick for their text,
 *                            gaining fastest.
 *
 * Both are precomputed by scripts/icon_order_stats/icon_order_stats.py into the
 * `ICON_TRENDS` and `COLOR_TRENDS` tabs, comparing a recent window to the window
 * just before it (default: last 30 days vs the prior 30 days). The app only
 * reads those tabs — same fast, token-free pattern as orderStats/compositeStats.
 *
 * Expected tab layouts (row 1 = headers, case-insensitive):
 *   ICON_TRENDS:  Icon | Category | Recent | Previous | Window | Updated
 *   COLOR_TRENDS: Slot | Color    | Recent | Previous | Window | Updated
 */

import { getSheetsClient } from "./google";
import { THREAD_PALETTE, rgbToHex } from "./threadPalette";

export type TrendItem = {
  /** Icon name, or color name. */
  label: string;
  /** Category (icons) or "Slot N · code" (colors). */
  detail: string;
  /** Colors only. */
  slot?: number;
  /** Colors only — swatch hex. */
  hex?: string;
  /** Orders in the recent window. */
  recent: number;
  /** Orders in the previous window. */
  previous: number;
  /** recent - previous. */
  delta: number;
  /** Percentage change vs previous; null when brand new (previous = 0). */
  growthPct: number | null;
  /** Appeared this window with no orders last window. */
  isNew: boolean;
  /** Meaningful volume AND at least doubled (or new). */
  isSpiking: boolean;
};

export type TrendsSnapshot = {
  icons: TrendItem[];
  colors: TrendItem[];
  /** e.g. "Last 30d vs prior 30d". */
  windowLabel: string;
  updatedAt: string | null;
};

const CACHE_TTL_MS = 60 * 1000;
let cache: { snap: TrendsSnapshot; expiresAt: number } | null = null;

const PALETTE_BY_SLOT = new Map(THREAD_PALETTE.map((t) => [t.slot, t]));

const SPIKE_MIN_RECENT = 5; // need some volume before we call it a spike
const SPIKE_GROWTH_PCT = 100; // doubled or more

export const EMPTY_TRENDS: TrendsSnapshot = {
  icons: [],
  colors: [],
  windowLabel: "",
  updatedAt: null,
};

export async function getTrendStats(
  options: { forceRefresh?: boolean } = {}
): Promise<TrendsSnapshot> {
  if (!options.forceRefresh && cache && cache.expiresAt > Date.now()) {
    return cache.snap;
  }
  const snap = await fetchTrendStats();
  cache = { snap, expiresAt: Date.now() + CACHE_TTL_MS };
  return snap;
}

function num(row: (string | number)[], i: number): number {
  if (i < 0) return 0;
  return parseInt(String(row[i] ?? "0").replace(/[^0-9-]/g, ""), 10) || 0;
}

function computeTrend(recent: number, previous: number) {
  const delta = recent - previous;
  const isNew = previous === 0 && recent > 0;
  const growthPct = previous > 0 ? (delta / previous) * 100 : null;
  const isSpiking =
    recent >= SPIKE_MIN_RECENT &&
    (isNew || (growthPct !== null && growthPct >= SPIKE_GROWTH_PCT));
  return { delta, growthPct, isNew, isSpiking };
}

async function fetchTrendStats(): Promise<TrendsSnapshot> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not set in .env.local");
  const iconTab = process.env.GOOGLE_ICON_TRENDS_TAB || "ICON_TRENDS";
  const colorTab = process.env.GOOGLE_COLOR_TRENDS_TAB || "COLOR_TRENDS";

  const sheets = getSheetsClient();
  const [iconRes, colorRes] = await Promise.all([
    sheets.spreadsheets.values
      .get({ spreadsheetId, range: `${iconTab}!A1:F5000` })
      .catch(() => null),
    sheets.spreadsheets.values
      .get({ spreadsheetId, range: `${colorTab}!A1:F200` })
      .catch(() => null),
  ]);

  let windowLabel = "";
  let updatedAt: string | null = null;

  const icons: TrendItem[] = [];
  const irows = iconRes?.data.values;
  if (irows && irows.length >= 2) {
    const h = irows[0].map((x) => String(x ?? "").trim().toLowerCase());
    const ci = (n: string) => h.indexOf(n);
    const iIcon = ci("icon");
    const iCat = ci("category");
    const iR = ci("recent");
    const iP = ci("previous");
    const iW = ci("window");
    const iU = ci("updated");
    if (iIcon >= 0) {
      for (let r = 1; r < irows.length; r++) {
        const row = irows[r] || [];
        const label = String(row[iIcon] ?? "").trim();
        if (!label) continue;
        const recent = num(row, iR);
        const previous = num(row, iP);
        if (iW >= 0 && row[iW]) windowLabel = String(row[iW]).trim();
        if (iU >= 0 && row[iU]) updatedAt = String(row[iU]).trim();
        icons.push({
          label,
          detail: iCat >= 0 ? String(row[iCat] ?? "").trim() : "",
          recent,
          previous,
          ...computeTrend(recent, previous),
        });
      }
    }
  }

  const colors: TrendItem[] = [];
  const crows = colorRes?.data.values;
  if (crows && crows.length >= 2) {
    const h = crows[0].map((x) => String(x ?? "").trim().toLowerCase());
    const ci = (n: string) => h.indexOf(n);
    const iSlot = ci("slot");
    const iR = ci("recent");
    const iP = ci("previous");
    const iW = ci("window");
    const iU = ci("updated");
    if (iSlot >= 0) {
      for (let r = 1; r < crows.length; r++) {
        const row = crows[r] || [];
        const slotRaw = String(row[iSlot] ?? "").trim();
        if (slotRaw === "") continue;
        const slot = parseInt(slotRaw, 10);
        if (Number.isNaN(slot)) continue;
        const t = PALETTE_BY_SLOT.get(slot);
        if (!t) continue; // ignore any slot outside the 24-spool palette
        const recent = num(row, iR);
        const previous = num(row, iP);
        if (iW >= 0 && row[iW] && !windowLabel) windowLabel = String(row[iW]).trim();
        if (iU >= 0 && row[iU] && !updatedAt) updatedAt = String(row[iU]).trim();
        colors.push({
          label: t.name,
          detail: `Slot ${slot} · ${t.code}`,
          slot,
          hex: rgbToHex(t.rgb),
          recent,
          previous,
          ...computeTrend(recent, previous),
        });
      }
    }
  }

  // Biggest absolute rise first, then highest current volume.
  const bySort = (a: TrendItem, b: TrendItem) =>
    b.delta - a.delta || b.recent - a.recent;
  icons.sort(bySort);
  colors.sort(bySort);

  return { icons, colors, windowLabel, updatedAt };
}
