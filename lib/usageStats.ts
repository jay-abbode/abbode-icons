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
 * (base product × template × type × value). The page pivots these rows two ways:
 * by base product (then template) or by template (then base product).
 *
 * Expected tab layout (row 1 = headers, case-insensitive):
 *   Base Product | Template | Type | Value | Count | Window | Updated
 * where Type is one of: icon | font | color
 */

import { getSheetsClient } from "./google";

export type UsageType = "icon" | "font" | "color";

export type UsageRow = {
  base: string;
  template: string;
  type: UsageType;
  value: string;
  count: number;
};

export type UsageSnapshot = {
  rows: UsageRow[];
  /** Distinct base products present in the data, sorted. */
  bases: string[];
  /** Distinct templates present in the data, sorted. */
  templates: string[];
  /** Human note on how far back the order data goes. */
  window: string;
  updatedAt: string | null;
};

export const EMPTY_USAGE: UsageSnapshot = {
  rows: [],
  bases: [],
  templates: [],
  window: "",
  updatedAt: null,
};

const UNSPECIFIED = "Unspecified";

async function fetchUsageStats(): Promise<UsageSnapshot> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  const tab = process.env.GOOGLE_PRODUCT_USAGE_TAB || "PRODUCT_USAGE";
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not set in .env.local");

  const sheets = getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${tab}!A1:Z50000`,
  });

  const raw = res.data.values;
  if (!raw || raw.length < 2) return EMPTY_USAGE;

  const header = raw[0].map((h) => String(h ?? "").trim().toLowerCase());
  const ci = (name: string) => header.indexOf(name);
  const iBase = ci("base product");
  const iTemplate = ci("template");
  const iType = ci("type");
  const iValue = ci("value");
  const iCount = ci("count");
  const iWin = ci("window");
  const iUpd = ci("updated");
  if (iBase < 0 || iTemplate < 0 || iType < 0 || iValue < 0 || iCount < 0) {
    return EMPTY_USAGE;
  }

  const rows: UsageRow[] = [];
  const baseSet = new Set<string>();
  const templateSet = new Set<string>();
  let window = "";
  let updatedAt: string | null = null;

  for (let r = 1; r < raw.length; r++) {
    const row = raw[r] || [];
    const typeRaw = String(row[iType] ?? "").trim().toLowerCase();
    const value = String(row[iValue] ?? "").trim();
    if (!value) continue;
    if (typeRaw !== "icon" && typeRaw !== "font" && typeRaw !== "color") continue;

    const base = String(row[iBase] ?? "").trim() || UNSPECIFIED;
    const template = String(row[iTemplate] ?? "").trim() || UNSPECIFIED;
    const count =
      parseInt(String(row[iCount] ?? "0").replace(/[^0-9-]/g, ""), 10) || 0;
    if (count <= 0) continue;

    rows.push({ base, template, type: typeRaw as UsageType, value, count });
    baseSet.add(base);
    templateSet.add(template);
    if (iWin >= 0 && row[iWin]) window = String(row[iWin]).trim();
    if (iUpd >= 0 && row[iUpd]) updatedAt = String(row[iUpd]).trim();
  }

  const sortNames = (a: string, b: string) =>
    a === UNSPECIFIED ? 1 : b === UNSPECIFIED ? -1 : a.localeCompare(b);

  return {
    rows,
    bases: [...baseSet].sort(sortNames),
    templates: [...templateSet].sort(sortNames),
    window,
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
