/**
 * Server-only reader for the WEBSTER_QUEUE tab — the handoff between the
 * Python queue writer (scripts/webster_queue, which holds the Shopify token
 * and the canonical icon→color derivation) and this app's routing engine.
 *
 * One row per order line. The writer clears + rewrites the whole tab each run
 * with every OPEN `webster-live` order, so this reader just parses and groups:
 *   Batch | Order | Order Id | Created At | Line | Qty | Product | Variant |
 *   Icons | Text | Text Color | Slots | Flag | Preview | Updated
 *
 * `Slots` is the design's color set ("20; 35; 8"). `Flag` marks lines the
 * routing page should send to the review pile (photo, no-color, unmatched: …).
 */

import { getSheetsClient } from "./google";
import { getThreadBySlot, parseThreadSlots } from "./threadPalette";

const TAB = process.env.WEBSTER_QUEUE_TAB || "WEBSTER_QUEUE";
const CACHE_TTL_MS = 60 * 1000;

export type QueueLine = {
  line: number;
  quantity: number;
  product: string;
  variant: string;
  icons: string;
  text: string;
  textColor: string;
  /** Palette slots this design needs. Empty when the line isn't stitchable. */
  slots: number[];
  /** "" | "photo" | "no-color" | "no-attributes" | "unmatched: …" */
  flag: string;
  preview: string;
};

export type QueueOrder = {
  /** Shopify order name, e.g. "#87479". */
  name: string;
  orderId: string;
  createdAt: string;
  /** Batch date (YYYY-MM-DD) in the writer's batch timezone. */
  batch: string;
  lines: QueueLine[];
};

export type WebsterQueue = {
  orders: QueueOrder[];
  /** Distinct batch dates, newest first. */
  batches: string[];
  updatedAt: string | null;
  /** False when the tab doesn't exist yet (writer never ran). */
  tabFound: boolean;
};

let cache: { data: WebsterQueue; expiresAt: number } | null = null;

export async function readWebsterQueue(options: { forceRefresh?: boolean } = {}): Promise<WebsterQueue> {
  if (!options.forceRefresh && cache && cache.expiresAt > Date.now()) return cache.data;

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not set.");

  const sheets = getSheetsClient();
  let rows: string[][] | undefined;
  let tabFound = true;
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `${TAB}!A1:O5000`,
    });
    rows = res.data.values as string[][] | undefined;
  } catch {
    tabFound = false; // tab missing — the writer has never run
  }

  const empty: WebsterQueue = { orders: [], batches: [], updatedAt: null, tabFound };
  if (!tabFound || !rows || rows.length < 2) {
    cache = { data: empty, expiresAt: Date.now() + CACHE_TTL_MS };
    return empty;
  }

  const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
  const ci = (name: string) => header.indexOf(name);
  const iBatch = ci("batch");
  const iOrder = ci("order");
  const iId = ci("order id");
  const iCreated = ci("created at");
  const iLine = ci("line");
  const iQty = ci("qty");
  const iProduct = ci("product");
  const iVariant = ci("variant");
  const iIcons = ci("icons");
  const iText = ci("text");
  const iColor = ci("text color");
  const iSlots = ci("slots");
  const iFlag = ci("flag");
  const iPreview = ci("preview");
  const iUpdated = ci("updated");
  if (iOrder < 0 || iSlots < 0) {
    cache = { data: empty, expiresAt: Date.now() + CACHE_TTL_MS };
    return empty;
  }

  const byName = new Map<string, QueueOrder>();
  let updatedAt: string | null = null;

  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const cell = (i: number) => (i >= 0 && i < row.length ? String(row[i] ?? "").trim() : "");
    if (iUpdated >= 0 && cell(iUpdated)) updatedAt = cell(iUpdated);

    const name = cell(iOrder);
    if (!name) continue; // sentinel / blank row

    let order = byName.get(name);
    if (!order) {
      order = {
        name,
        orderId: cell(iId),
        createdAt: cell(iCreated),
        batch: cell(iBatch),
        lines: [],
      };
      byName.set(name, order);
    }

    // Only real palette colors can ever be loaded on a head; anything else
    // would make the design permanently uncoverable, so drop it here.
    const slots = parseThreadSlots(cell(iSlots)).filter((s) => getThreadBySlot(s) !== undefined);

    order.lines.push({
      line: parseInt(cell(iLine) || "0", 10) || order.lines.length + 1,
      quantity: parseInt(cell(iQty) || "1", 10) || 1,
      product: cell(iProduct),
      variant: cell(iVariant),
      icons: cell(iIcons),
      text: cell(iText),
      textColor: cell(iColor),
      slots,
      flag: cell(iFlag),
      preview: cell(iPreview),
    });
  }

  const orders = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  const batches = [...new Set(orders.map((o) => o.batch).filter(Boolean))].sort().reverse();

  const data: WebsterQueue = { orders, batches, updatedAt, tabFound };
  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}
