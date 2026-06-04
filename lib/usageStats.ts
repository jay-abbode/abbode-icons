/**
 * Product/template usage stats for the "Product Usage" report.
 *
 * Reads a precomputed `PRODUCT_USAGE` tab (written by
 * scripts/icon_order_stats/icon_order_stats.py) so the page stays fast and no
 * Shopify token lives in the web app — same pattern as orderStats / composite.
 *
 * Each ordered, personalized line item belongs to a product carrying two
 * metafields — `base_product_name_nb` (e.g. "Waffle Pouch") and
 * `design_template_name_nb` (e.g. "Dog Mom") — and records the icons, font, and
 * text color the customer chose. The script tallies those into one row per
 * (base product × template × window × type × value). The page pivots by base
 * product or by template, and lets you switch the time window.
 *
 * Expected tab layout (row 1 = headers, case-insensitive):
 *   Base Product | Template | Window | Type | Value | Count | Coverage | Updated
 * where Window is one of 3mo | 6mo | all, and Type is icon | font | color.
 */

import { getSheetsClient } from "./google";

export type UsageType = "icon" | "font" | "color";
export type UsageWindow = "3mo" | "6mo" | "all";

export const WINDOW_LABELS: Record<UsageWindow, string> = {
  "3mo": "3 months",
  "6mo": "6 months",
  all: "All time",
};

/** Display order for the window switcher. */
export const WINDOW_ORDER: UsageWindow[] = ["3mo", "6mo", "all"];

export type UsageRow = {
  base: string;
  template: string;
  window: UsageWindow;
  type: UsageType;
  value: string;
  count: number;
};

export type UsageSnapshot = {
  rows: UsageRow[];
  /** Which windows are actually present in the data, in display order. */
  windows: UsageWindow[];
  /** Human note on how far back the order data goes. */
  coverage: string;
  updatedAt: string | null;
};

export const EMPTY_USAGE: UsageSnapshot = {
  rows: [],
  windows: [],
  coverage: "",
  updatedAt: null,
};

const UNSPECIFIED = "Unspecified";

/** Strip a leading "NN — " / "NN - " so colors always render as names only. */
function colorName(value: string): string {
  return value.replace(/^\s*\d+\s*[\u2014\u2013-]\s*/, "").trim();
}

function normalizeWindow(raw: string): UsageWindow | null {
  const s = raw.trim().toLowerCase();
  if (s === "3mo" || s === "3" || s === "3 months") return "3mo";
  if (s === "6mo" || s === "6" || s === "6 months") return "6mo";
  if (s === "all" || s === "all time" || s === "12mo" || s === "12") return "all";
  return null;
}

async function fetchUsageStats(): Promise<UsageSnapshot> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_PRODUCT_USAGE_TAB || "PRODUCT_USAGE";
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not set in .env.local");

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A1:Z100000`,
  });

  const raw = res.data.values;
  if (!raw || raw.length < 2) return EMPTY_USAGE;

  const header = raw[0].map((h) => String(h ?? "").trim().toLowerCase());
  const ci = (name: string) => header.indexOf(name);
  const iBase = ci("base product");
  const iTemplate = ci("template");
  const iWindow = ci("window");
  const iType = ci("type");
  const iValue = ci("value");
  const iCount = ci("count");
  const iCov = ci("coverage");
  const iUpd = ci("updated");
  if (iBase < 0 || iTemplate < 0 || iType < 0 || iValue < 0 || iCount < 0) {
    return EMPTY_USAGE;
  }

  const rows: UsageRow[] = [];
  const windowSet = new Set<UsageWindow>();
  let coverage = "";
  let updatedAt: string | null = null;

  for (let r = 1; r < raw.length; r++) {
    const row = raw[r] || [];
    const typeRaw = String(row[iType] ?? "").trim().toLowerCase();
    if (typeRaw !== "icon" && typeRaw !== "font" && typeRaw !== "color") continue;
    const type = typeRaw as UsageType;

    // Default to "all" if the tab predates the Window column.
    const win = iWindow >= 0 ? normalizeWindow(String(row[iWindow] ?? "")) : "all";
    if (!win) continue;

    let value = String(row[iValue] ?? "").trim();
    if (type === "color") value = colorName(value);
    if (!value) continue;

    const count =
      parseInt(String(row[iCount] ?? "0").replace(/[^0-9-]/g, ""), 10) || 0;
    if (count <= 0) continue;

    const base = String(row[iBase] ?? "").trim() || UNSPECIFIED;
    const template = String(row[iTemplate] ?? "").trim() || UNSPECIFIED;

    rows.push({ base, template, window: win, type, value, count });
    windowSet.add(win);
    if (iCov >= 0 && row[iCov]) coverage = String(row[iCov]).trim();
    if (iUpd >= 0 && row[iUpd]) updatedAt = String(row[iUpd]).trim();
  }

  return {
    rows,
    windows: WINDOW_ORDER.filter((w) => windowSet.has(w)),
    coverage,
    updatedAt,
  };
}

export async function getUsageStats(): Promise<UsageSnapshot> {
  try {
    return await fetchUsageStats();
  } catch {
    return EMPTY_USAGE;
  }
}
