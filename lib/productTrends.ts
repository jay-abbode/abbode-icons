/**
 * DTC "Product Trends" data — the demand layer beneath popularity.
 *
 * Reads three precomputed tabs written by
 * scripts/icon_order_stats/icon_order_stats.py (aggregate_trends), so the page
 * stays fast and no Shopify token lives in the web app — same pattern as
 * orderStats / usageStats. Everything here is direct-to-consumer only: the
 * script counts web (online) and pos (in-store) orders and excludes Faire
 * wholesale and draft orders.
 *
 * Expected tab layouts (row 1 = headers, case-insensitive):
 *   TRENDS_TIMESERIES:  Month | Channel | Orders | Units | Coverage | Updated
 *   TRENDS_ITEM_COLORS: Month | Channel | Color  | Units | Coverage | Updated
 *   TRENDS_CATEGORIES:  Month | Channel | Category | Units | Coverage | Updated
 * where Month is "YYYY-MM" and Channel is one of web | pos.
 */

import { getSheetsClient } from "./google";

export type Channel = "web" | "pos";

export type TsRow = { month: string; channel: Channel; orders: number; units: number };
export type ColorRow = { month: string; channel: Channel; color: string; units: number };
export type CatRow = { month: string; channel: Channel; category: string; units: number };

export type ProductTrendsSnapshot = {
  timeseries: TsRow[];
  colors: ColorRow[];
  categories: CatRow[];
  /** Distinct months present across the data, ascending ("YYYY-MM"). */
  months: string[];
  /** Human note on how far back the order data goes. */
  coverage: string;
  updatedAt: string | null;
};

export const EMPTY_PRODUCT_TRENDS: ProductTrendsSnapshot = {
  timeseries: [],
  colors: [],
  categories: [],
  months: [],
  coverage: "",
  updatedAt: null,
};

function toChannel(raw: string): Channel | null {
  const v = raw.trim().toLowerCase();
  return v === "web" || v === "pos" ? v : null;
}

function toInt(v: unknown): number {
  return parseInt(String(v ?? "0").replace(/[^0-9-]/g, ""), 10) || 0;
}

async function fetchProductTrends(): Promise<ProductTrendsSnapshot> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not set in .env.local");
  const tsTab = process.env.GOOGLE_TRENDS_TS_TAB || "TRENDS_TIMESERIES";
  const colorTab = process.env.GOOGLE_TRENDS_COLORS_TAB || "TRENDS_ITEM_COLORS";
  const catTab = process.env.GOOGLE_TRENDS_CATS_TAB || "TRENDS_CATEGORIES";

  const sheets = getSheetsClient();
  const [tsRes, colorRes, catRes] = await Promise.all([
    sheets.spreadsheets.values
      .get({ spreadsheetId, range: `${tsTab}!A1:Z100000` })
      .catch(() => null),
    sheets.spreadsheets.values
      .get({ spreadsheetId, range: `${colorTab}!A1:Z100000` })
      .catch(() => null),
    sheets.spreadsheets.values
      .get({ spreadsheetId, range: `${catTab}!A1:Z100000` })
      .catch(() => null),
  ]);

  let coverage = "";
  let updatedAt: string | null = null;
  const monthSet = new Set<string>();

  const timeseries: TsRow[] = [];
  const tsRows = tsRes?.data.values;
  if (tsRows && tsRows.length >= 2) {
    const h = tsRows[0].map((x) => String(x ?? "").trim().toLowerCase());
    const ci = (n: string) => h.indexOf(n);
    const iM = ci("month");
    const iCh = ci("channel");
    const iO = ci("orders");
    const iU = ci("units");
    const iCov = ci("coverage");
    const iUpd = ci("updated");
    if (iM >= 0 && iCh >= 0) {
      for (let r = 1; r < tsRows.length; r++) {
        const row = tsRows[r] || [];
        const month = String(row[iM] ?? "").trim();
        const channel = toChannel(String(row[iCh] ?? ""));
        if (!month || !channel) continue;
        timeseries.push({ month, channel, orders: toInt(row[iO]), units: toInt(row[iU]) });
        monthSet.add(month);
        if (iCov >= 0 && row[iCov]) coverage = String(row[iCov]).trim();
        if (iUpd >= 0 && row[iUpd]) updatedAt = String(row[iUpd]).trim();
      }
    }
  }

  const colors: ColorRow[] = [];
  const cRows = colorRes?.data.values;
  if (cRows && cRows.length >= 2) {
    const h = cRows[0].map((x) => String(x ?? "").trim().toLowerCase());
    const ci = (n: string) => h.indexOf(n);
    const iM = ci("month");
    const iCh = ci("channel");
    const iC = ci("color");
    const iU = ci("units");
    if (iM >= 0 && iCh >= 0 && iC >= 0) {
      for (let r = 1; r < cRows.length; r++) {
        const row = cRows[r] || [];
        const month = String(row[iM] ?? "").trim();
        const channel = toChannel(String(row[iCh] ?? ""));
        const color = String(row[iC] ?? "").trim();
        if (!month || !channel || !color) continue;
        colors.push({ month, channel, color, units: toInt(row[iU]) });
        monthSet.add(month);
      }
    }
  }

  const categories: CatRow[] = [];
  const catRows = catRes?.data.values;
  if (catRows && catRows.length >= 2) {
    const h = catRows[0].map((x) => String(x ?? "").trim().toLowerCase());
    const ci = (n: string) => h.indexOf(n);
    const iM = ci("month");
    const iCh = ci("channel");
    const iC = ci("category");
    const iU = ci("units");
    if (iM >= 0 && iCh >= 0 && iC >= 0) {
      for (let r = 1; r < catRows.length; r++) {
        const row = catRows[r] || [];
        const month = String(row[iM] ?? "").trim();
        const channel = toChannel(String(row[iCh] ?? ""));
        const category = String(row[iC] ?? "").trim();
        if (!month || !channel || !category) continue;
        categories.push({ month, channel, category, units: toInt(row[iU]) });
        monthSet.add(month);
      }
    }
  }

  return {
    timeseries,
    colors,
    categories,
    months: Array.from(monthSet).sort(),
    coverage,
    updatedAt,
  };
}

export async function getProductTrends(): Promise<ProductTrendsSnapshot> {
  try {
    return await fetchProductTrends();
  } catch {
    return EMPTY_PRODUCT_TRENDS;
  }
}
