/**
 * Composite thread-usage stats for the "Composite Data" page.
 *
 * This is the end-goal view: which Madeira spools get used the most across
 * real orders, combining TWO sources of usage per ordered line:
 *   1. Icon colors  — every thread color that makes up each ordered icon.
 *   2. Text color   — the thread color the customer chose for their text.
 * Both are croc->tusk adjusted and mapped to the 24-spool palette by the
 * stats script before they ever reach the sheet.
 *
 * Reads a precomputed `COMPOSITE` tab (written by
 * scripts/icon_order_stats/icon_order_stats.py) so the page stays fast and no
 * Shopify token lives in the web app — same pattern as colorStats / orderStats.
 *
 * Expected tab layout (row 1 = headers, case-insensitive):
 *   Slot | Color | 3mo Icons | 3mo Text | 3mo Total
 *        | 6mo Icons | 6mo Text | 6mo Total
 *        | 12mo Icons | 12mo Text | 12mo Total | Updated | Coverage
 *
 * Name / code / hex are taken from THREAD_PALETTE here (the authoritative
 * source), keyed by slot — the sheet only needs to supply the tallies.
 */

import { getSheetsClient } from "./google";
import { THREAD_PALETTE, rgbToHex } from "./threadPalette";

export type WindowKey = "3mo" | "6mo" | "12mo";

export const WINDOW_LABELS: Record<WindowKey, string> = {
  "3mo": "3 months",
  "6mo": "6 months",
  "12mo": "12 months",
};

export type CompositeColor = {
  slot: number;
  name: string;
  code: string;
  hex: string;
  /** Uses contributed by icon designs. */
  icons: number;
  /** Uses contributed by chosen text colors. */
  text: number;
  /** icons + text. */
  total: number;
};

export type CompositeWindow = {
  key: WindowKey;
  label: string;
  /** All 24 spools, sorted by total descending. */
  colors: CompositeColor[];
  totalUses: number;
};

export type CompositeSnapshot = {
  windows: Record<WindowKey, CompositeWindow>;
  updatedAt: string | null;
  /** Human note on how far back the data actually goes. */
  coverage: string;
};

const CACHE_TTL_MS = 60 * 1000;
let cache: { snap: CompositeSnapshot; expiresAt: number } | null = null;

const PALETTE_BY_SLOT = new Map(THREAD_PALETTE.map((t) => [t.slot, t]));

function emptyWindow(key: WindowKey): CompositeWindow {
  return { key, label: WINDOW_LABELS[key], colors: [], totalUses: 0 };
}

const EMPTY: CompositeSnapshot = {
  windows: {
    "3mo": emptyWindow("3mo"),
    "6mo": emptyWindow("6mo"),
    "12mo": emptyWindow("12mo"),
  },
  updatedAt: null,
  coverage: "",
};

export async function getCompositeStats(
  options: { forceRefresh?: boolean } = {}
): Promise<CompositeSnapshot> {
  if (!options.forceRefresh && cache && cache.expiresAt > Date.now()) {
    return cache.snap;
  }
  const snap = await fetchCompositeStats();
  cache = { snap, expiresAt: Date.now() + CACHE_TTL_MS };
  return snap;
}

async function fetchCompositeStats(): Promise<CompositeSnapshot> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_COMPOSITE_TAB || "COMPOSITE";
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not set in .env.local");

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A1:Z100`,
  });

  const rows = res.data.values;
  if (!rows || rows.length < 2) return EMPTY;

  const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
  const ci = (name: string) => header.indexOf(name);
  const iSlot = ci("slot");
  if (iSlot < 0) return EMPTY;
  const iUpd = ci("updated");
  const iCov = ci("coverage");

  const cols: Record<WindowKey, { icons: number; text: number; total: number }> = {
    "3mo": { icons: ci("3mo icons"), text: ci("3mo text"), total: ci("3mo total") },
    "6mo": { icons: ci("6mo icons"), text: ci("6mo text"), total: ci("6mo total") },
    "12mo": { icons: ci("12mo icons"), text: ci("12mo text"), total: ci("12mo total") },
  };

  const num = (row: (string | number)[], i: number): number => {
    if (i < 0) return 0;
    return parseInt(String(row[i] ?? "0").replace(/[^0-9-]/g, ""), 10) || 0;
  };

  const windows: Record<WindowKey, CompositeWindow> = {
    "3mo": emptyWindow("3mo"),
    "6mo": emptyWindow("6mo"),
    "12mo": emptyWindow("12mo"),
  };
  let updatedAt: string | null = null;
  let coverage = "";

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const slotRaw = String(row[iSlot] ?? "").trim();
    if (slotRaw === "") continue;
    const slot = parseInt(slotRaw, 10);
    if (Number.isNaN(slot)) continue;

    const t = PALETTE_BY_SLOT.get(slot);
    if (!t) continue; // ignore any slot outside the 24-spool palette

    if (iUpd >= 0 && row[iUpd]) updatedAt = String(row[iUpd]).trim();
    if (iCov >= 0 && row[iCov]) coverage = String(row[iCov]).trim();

    (Object.keys(windows) as WindowKey[]).forEach((key) => {
      const c = cols[key];
      const icons = num(row, c.icons);
      const text = num(row, c.text);
      const total = c.total >= 0 ? num(row, c.total) : icons + text;
      windows[key].colors.push({
        slot,
        name: t.name,
        code: t.code,
        hex: rgbToHex(t.rgb),
        icons,
        text,
        total,
      });
    });
  }

  (Object.keys(windows) as WindowKey[]).forEach((key) => {
    windows[key].colors.sort((a, b) => b.total - a.total);
    windows[key].totalUses = windows[key].colors.reduce((s, c) => s + c.total, 0);
  });

  return { windows, updatedAt, coverage };
}
