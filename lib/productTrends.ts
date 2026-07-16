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
 *   TRENDS_ITEM_COLORS: Month | Channel | Product | Color | Units | Coverage | Updated
 *   TRENDS_CATEGORIES:  Month | Channel | Category | Units | Coverage | Updated
 * where Month is "YYYY-MM" and Channel is one of web | pos.
 */

import { getSheetsClient } from "./google";

export type Channel = "web" | "pos";

export type TsRow = { month: string; channel: Channel; orders: number; units: number };
export type ColorRow = { month: string; channel: Channel; product: string; color: string; units: number };
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

/**
 * Collapse a raw product label — a Shopify handle ("signature-waffle-pouch"),
 * title ("Signature Waffle Pouch"), or base-name — into a clean product family
 * ("Waffle Pouch"), so design variants group together instead of sprawling into
 * dozens of near-duplicate lines. Returns null for shipping/insurance/fee/
 * display noise (Route, Onward, gift cards, digitization, POS display SKUs, …)
 * so those drop out of every view even before the source data is re-scanned.
 *
 * Order matters: bundles first, then specific product types, then generic
 * fallbacks. Unknown products keep their own (title-cased) name rather than
 * vanishing.
 */
export function baseProduct(raw: string): string | null {
  const original = (raw || "").trim();
  if (!original) return "Unspecified";
  if (original.toLowerCase() === "unspecified") return "Unspecified";
  const s = ` ${original.toLowerCase().replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()} `;
  const has = (...needles: string[]) => needles.some((n) => s.includes(` ${n} `) || s.includes(`${n} `) || s.includes(` ${n}`));
  const sub = (...needles: string[]) => needles.some((n) => s.includes(n));

  // Noise — never a real sellable line.
  if (sub("route", "onward", "shipping protection", "package protection", "insurance", "gift card", "digitization", "digitisation", "upcharge", "wholesale", "display", "sample", " fee")) {
    return null;
  }

  // Bundles / sets.
  if (has("set", "sets", "bundle", "kit")) return "Sets";

  // Specific product families.
  if (sub("waffle")) return "Waffle Pouch";
  if (sub("croc")) return "Croc Pouch";
  if (sub("terry") && sub("tote")) return "Terry Tote";
  if (sub("terry")) return "Terry Pouch";
  if (sub("canvas")) return "Canvas Tote";
  if (sub("pointelle") || sub("tank")) return "Tank Top";
  if (sub("eye mask") || sub("eyemask") || (sub("satin") && sub("mask"))) return "Satin Eye Mask";
  if (sub("cocktail")) return "Cocktail Napkin";
  if (sub("tea towel")) return "Tea Towel";
  if (sub("pillow")) return "Pillowcase";
  if (sub("lighter")) return "Lighter Case";
  if (sub("charm")) return "Charms";
  if (sub("clip")) return "Hair Clips";
  if (sub("bandana")) return "Bandana";

  // Generic fallbacks by noun.
  if (sub("tote")) return "Tote";
  if (sub("pouch")) return "Pouch";
  if (sub("napkin")) return "Napkin";
  if (sub("towel")) return "Towel";
  if (sub("mask")) return "Eye Mask";
  if (sub("bag")) return "Bag";

  // Unknown — keep it, title-cased, so nothing silently disappears.
  return original
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

// Real garment colors, sourced from Shopify "Color" option values across every
// product family. Used to reject non-colors that leak in through "Style" options
// (e.g. "One Sided", "Mushroom", zodiac designs) and product-name junk. Keep in
// sync with the same set in scripts/icon_order_stats/icon_order_stats.py; if the
// brand adds a new garment color, add it here too.
const REAL_COLORS = new Set([
  "blush", "olive", "bonbon", "cloud", "linen", "blueberry", "fig", "chocolate", "butter",
  "cherry", "navy", "noir", "yuzu", "azure", "black", "red", "espresso",
  "pink", "white", "white / pink", "white / black", "burgundy", "brown", "pink striped",
  "cabana", "poolside", "natural",
]);

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
    const iP = ci("product");
    const iC = ci("color");
    const iU = ci("units");
    if (iM >= 0 && iCh >= 0 && iC >= 0) {
      for (let r = 1; r < cRows.length; r++) {
        const row = cRows[r] || [];
        const month = String(row[iM] ?? "").trim();
        const channel = toChannel(String(row[iCh] ?? ""));
        const rawProduct = iP >= 0 ? String(row[iP] ?? "").trim() : "";
        const color = String(row[iC] ?? "").trim();
        if (!month || !channel || !color) continue;
        // Only real garment colors count. Non-colors that leaked in via "Style"
        // options (designs like "Mushroom", "One Sided", zodiac names) or stray
        // product names are dropped.
        if (!REAL_COLORS.has(color.toLowerCase())) continue;
        const product = baseProduct(rawProduct);
        if (product === null) continue; // Route/shipping/fee noise
        colors.push({ month, channel, product, color, units: toInt(row[iU]) });
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
        const rawCategory = String(row[iC] ?? "").trim();
        if (!month || !channel || !rawCategory) continue;
        const category = baseProduct(rawCategory);
        if (category === null || category === "Unspecified") continue; // noise / unmapped
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
