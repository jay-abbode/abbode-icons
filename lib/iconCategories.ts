/**
 * Server-only reader for the ICON_CATEGORIES tab — the synced snapshot of the
 * website's Custom Icon Categories (Shopify metaobjects), written by
 * scripts/shopify_categories/sync_icon_categories.py.
 *
 *   Category | Handle | Position | Icon Label | Canon Icon | Match |
 *   Category Updated | Synced
 *
 * `Canon Icon` is the catalog name the sync's matcher resolved the website
 * label to; blank when unmatched (the compare page surfaces those separately).
 */

import { getSheetsClient } from "./google";

export type CategoryIcon = {
  position: number;
  /** The label exactly as it appears on the website. */
  label: string;
  /** Canonical catalog name, or "" when the matcher couldn't place the label. */
  canon: string;
  match: string;
};

export type WebsiteCategory = {
  title: string;
  handle: string;
  icons: CategoryIcon[];
  /** When the metaobject itself was last edited on Shopify. */
  categoryUpdatedAt: string | null;
  /** When the sync last ran. */
  syncedAt: string | null;
};

export type IconCategoriesSnapshot = {
  categories: Map<string, WebsiteCategory>;
  tabFound: boolean;
};

const TAB = process.env.GOOGLE_ICON_CATEGORIES_TAB || "ICON_CATEGORIES";
const CACHE_TTL_MS = 60 * 1000;
let cache: { snap: IconCategoriesSnapshot; expiresAt: number } | null = null;

export async function getIconCategories(
  options: { forceRefresh?: boolean } = {}
): Promise<IconCategoriesSnapshot> {
  if (!options.forceRefresh && cache && cache.expiresAt > Date.now()) return cache.snap;

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not set.");

  const sheets = getSheetsClient();
  let rows: string[][] | undefined;
  let tabFound = true;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${TAB}!A1:H5000`,
    });
    rows = res.data.values as string[][] | undefined;
  } catch {
    tabFound = false;
  }

  const categories = new Map<string, WebsiteCategory>();
  if (tabFound && rows && rows.length >= 2) {
    const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
    const ci = (name: string) => header.indexOf(name);
    const iCat = ci("category");
    const iHandle = ci("handle");
    const iPos = ci("position");
    const iLabel = ci("icon label");
    const iCanon = ci("canon icon");
    const iMatch = ci("match");
    const iCatUpd = ci("category updated");
    const iSynced = ci("synced");

    if (iHandle >= 0 && iLabel >= 0) {
      for (let r = 1; r < rows.length; r++) {
        const row = rows[r] || [];
        const cell = (i: number) => (i >= 0 && i < row.length ? String(row[i] ?? "").trim() : "");
        const handle = cell(iHandle);
        const label = cell(iLabel);
        if (!handle || !label) continue;

        let cat = categories.get(handle);
        if (!cat) {
          cat = {
            title: cell(iCat) || handle,
            handle,
            icons: [],
            categoryUpdatedAt: cell(iCatUpd) || null,
            syncedAt: cell(iSynced) || null,
          };
          categories.set(handle, cat);
        }
        cat.icons.push({
          position: parseInt(cell(iPos) || "0", 10) || cat.icons.length + 1,
          label,
          canon: cell(iCanon),
          match: cell(iMatch),
        });
      }
      for (const cat of categories.values()) {
        cat.icons.sort((a, b) => a.position - b.position);
      }
    }
  }

  const snap: IconCategoriesSnapshot = { categories, tabFound };
  cache = { snap, expiresAt: Date.now() + CACHE_TTL_MS };
  return snap;
}
