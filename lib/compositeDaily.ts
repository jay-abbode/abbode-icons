/**
 * Daily composite thread-usage — feeds the range chart on /composite.
 *
 * Reads the sparse `COMPOSITE_DAILY` tab written by
 * scripts/icon_order_stats/icon_order_stats.py:
 *   Date | Slot | Icons | Text | Total | Updated | Coverage
 * (Updated/Coverage appear on the first data row only.)
 *
 * The whole dataset is shipped to the client once in a compact tuple form so
 * range switching and range-vs-range comparison are instant, with no extra
 * round trips. Worst case is ~24 slots x 366 days of sparse rows — small.
 */

import { getSheetsClient } from "./google";
import { THREAD_PALETTE } from "./threadPalette";
import type { DailyDay, DailySlotTuple } from "./compositeRange";

export type { DailyDay, DailySlotTuple };

export type CompositeDailySnapshot = {
  /** Sorted ascending by date. Days with zero usage are simply absent. */
  days: DailyDay[];
  updatedAt: string | null;
  coverage: string;
  /** Earliest / latest data dates, null when the tab is empty. */
  minDate: string | null;
  maxDate: string | null;
};

const CACHE_TTL_MS = 60 * 1000;
let cache: { snap: CompositeDailySnapshot; expiresAt: number } | null = null;

const VALID_SLOTS = new Set(THREAD_PALETTE.map((t) => t.slot));

export const EMPTY_DAILY: CompositeDailySnapshot = {
  days: [],
  updatedAt: null,
  coverage: "",
  minDate: null,
  maxDate: null,
};

export async function getCompositeDaily(
  options: { forceRefresh?: boolean } = {}
): Promise<CompositeDailySnapshot> {
  if (!options.forceRefresh && cache && cache.expiresAt > Date.now()) {
    return cache.snap;
  }
  const snap = await fetchCompositeDaily();
  cache = { snap, expiresAt: Date.now() + CACHE_TTL_MS };
  return snap;
}

async function fetchCompositeDaily(): Promise<CompositeDailySnapshot> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_COMPOSITE_DAILY_TAB || "COMPOSITE_DAILY";
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not set in .env.local");

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A1:G20000`,
  });

  const rows = res.data.values;
  if (!rows || rows.length < 2) return EMPTY_DAILY;

  const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
  const ci = (name: string) => header.indexOf(name);
  const iDate = ci("date");
  const iSlot = ci("slot");
  if (iDate < 0 || iSlot < 0) return EMPTY_DAILY;
  const iIcons = ci("icons");
  const iText = ci("text");
  const iUpd = ci("updated");
  const iCov = ci("coverage");

  const num = (row: (string | number)[], i: number): number => {
    if (i < 0) return 0;
    return parseInt(String(row[i] ?? "0").replace(/[^0-9-]/g, ""), 10) || 0;
  };

  const byDate = new Map<string, DailySlotTuple[]>();
  let updatedAt: string | null = null;
  let coverage = "";

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const date = String(row[iDate] ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const slot = parseInt(String(row[iSlot] ?? "").trim(), 10);
    if (Number.isNaN(slot) || !VALID_SLOTS.has(slot)) continue;

    if (iUpd >= 0 && row[iUpd] && !updatedAt) updatedAt = String(row[iUpd]).trim();
    if (iCov >= 0 && row[iCov] && !coverage) coverage = String(row[iCov]).trim();

    const icons = num(row, iIcons);
    const text = num(row, iText);
    if (icons === 0 && text === 0) continue;
    const list = byDate.get(date) || [];
    list.push([slot, icons, text]);
    byDate.set(date, list);
  }

  const dates = Array.from(byDate.keys()).sort();
  const days: DailyDay[] = dates.map((date) => ({
    date,
    slots: byDate.get(date)!,
  }));

  return {
    days,
    updatedAt,
    coverage,
    minDate: dates[0] ?? null,
    maxDate: dates[dates.length - 1] ?? null,
  };
}
