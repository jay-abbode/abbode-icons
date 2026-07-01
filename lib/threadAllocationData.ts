/**
 * Server-only data access for the Machines page.
 *
 * Reads the rolling-3-month THREAD_STATS tab (written by
 * scripts/icon_order_stats, which now also emits it) when present, and otherwise
 * falls back to ORDER_STATS (rolling-12-month) so the page renders before that
 * job has run. Each row becomes one "job" (design colors + order weight). Same
 * 60s cache pattern as the other sheet readers; no Shopify token in the web app.
 *
 * The allocation math itself lives in ./threadAllocation (pure, client-safe) so
 * the browser can recompute instantly as the off-color selection changes — this
 * module just fetches the jobs and offers a server-side compute for the day sheet.
 */

import { getSheetsClient } from "./google";
import { getThreadBySlot, parseThreadSlots } from "./threadPalette";
import {
  computeAllocation,
  defaultOffSelection,
  type AllocationResult,
  type Job,
  type MachineJobsMeta,
  type OffSelection,
} from "./threadAllocation";

export type MachineJobs = { jobs: Job[]; meta: MachineJobsMeta };

const CACHE_TTL_MS = 60 * 1000;
let cache: { data: MachineJobs; expiresAt: number } | null = null;

type TabRead = { jobs: Job[]; window: string; updatedAt: string | null; source: string } | null;

async function readJobsFromTab(spreadsheetId: string, tab: string): Promise<TabRead> {
  const sheets = getSheetsClient();
  let rows: any[][] | null | undefined;
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:H5000` });
    rows = res.data.values as any[][] | undefined;
  } catch {
    return null; // tab missing / inaccessible
  }
  if (!rows || rows.length < 2) return null;

  const header = rows[0].map((h) => String(h ?? "").trim().toLowerCase());
  const ci = (name: string) => header.indexOf(name);
  const iOrders = ci("orders");
  const iSlots = ci("thread slots");
  const iWin = ci("window");
  const iUpd = ci("updated");
  if (iOrders < 0 || iSlots < 0) return null;

  const jobs: Job[] = [];
  let window = "";
  let updatedAt: string | null = null;
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const weight = parseInt(String(row[iOrders] ?? "0").replace(/[^0-9-]/g, ""), 10) || 0;
    // Keep only real palette colors — a stray number can never be loaded, so it
    // would otherwise make its job permanently uncoverable.
    const slots = parseThreadSlots(String(row[iSlots] ?? "")).filter((s) => getThreadBySlot(s) !== undefined);
    if (iWin >= 0 && row[iWin]) window = String(row[iWin]).trim();
    if (iUpd >= 0 && row[iUpd]) updatedAt = String(row[iUpd]).trim();
    if (slots.length === 0 || weight <= 0) continue;
    jobs.push({ slots, weight });
  }
  if (jobs.length === 0) return null;
  return { jobs, window, updatedAt, source: tab };
}

/** Rolling-3-month jobs (fallback to 12-month), cached 60s. */
export async function getMachineJobs(options: { forceRefresh?: boolean } = {}): Promise<MachineJobs> {
  if (!options.forceRefresh && cache && cache.expiresAt > Date.now()) return cache.data;

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not set in .env.local");

  const primaryTab = process.env.GOOGLE_THREAD_STATS_TAB || "THREAD_STATS";
  const fallbackTab = process.env.GOOGLE_ORDER_STATS_TAB || "ORDER_STATS";

  const read = (await readJobsFromTab(spreadsheetId, primaryTab)) ?? (await readJobsFromTab(spreadsheetId, fallbackTab));

  const data: MachineJobs = read
    ? {
        jobs: read.jobs,
        meta: {
          window: read.window || (read.source === primaryTab ? "Rolling 3 months" : "Rolling 12 months"),
          updatedAt: read.updatedAt,
          source: read.source,
        },
      }
    : { jobs: [], meta: { window: "", updatedAt: null, source: "" } };

  cache = { data, expiresAt: Date.now() + CACHE_TTL_MS };
  return data;
}

/** Convenience: jobs + allocation for a given off-color selection (default if omitted).
 * Used by the printable day sheet, which is server-rendered. */
export async function getMachineAllocation(offSelection?: OffSelection): Promise<AllocationResult> {
  const { jobs, meta } = await getMachineJobs();
  return computeAllocation(jobs, offSelection ?? defaultOffSelection(), meta);
}
