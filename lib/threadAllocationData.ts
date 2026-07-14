/**
 * Server-only data access for the Machines page.
 *
 * JOB SOURCE (pluggable)
 * ----------------------
 * A "job" is one design: the Madeira slots it needs plus how many times it was
 * ordered. Where those jobs come from is deliberately behind one switch:
 *
 *   history  reads the rolling-3-month THREAD_STATS tab (written by
 *            scripts/icon_order_stats), falling back to ORDER_STATS
 *            (rolling-12-month) so the page renders before that job has run.
 *   queue    the open `webster-live` order queue — the jobs actually waiting to
 *            be stitched, rather than a bet on the recent past. Not wired yet;
 *            add a reader to JOB_SOURCES and it lights up everywhere.
 *
 * Everything downstream (the solver, the rooms, the day sheet, saved configs)
 * takes jobs as input and never asks where they came from, so switching the
 * source is a one-line change here — not a rewrite.
 *
 * The allocation math itself lives in ./threadAllocation (pure, client-safe) so
 * the browser can recompute instantly as the floor changes; this module just
 * fetches the jobs and offers a server-side compute for the day sheet.
 */

import { getSheetsClient } from "./google";
import { getThreadBySlot, parseThreadSlots } from "./threadPalette";
import { getActiveFloors } from "./machineConfigs";
import {
  computeAllocation,
  type AllocationResult,
  type FleetKey,
  type FloorState,
  type Job,
  type MachineJobsMeta,
} from "./threadAllocation";

export type JobSourceKey = "history" | "queue";

export type MachineJobs = { jobs: Job[]; meta: MachineJobsMeta };

const CACHE_TTL_MS = 60 * 1000;
const cache = new Map<JobSourceKey, { data: MachineJobs; expiresAt: number }>();

type TabRead = { jobs: Job[]; window: string; updatedAt: string | null; source: string } | null;

async function readJobsFromTab(spreadsheetId: string, tab: string): Promise<TabRead> {
  const sheets = getSheetsClient();
  let rows: string[][] | null | undefined;
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A1:H5000` });
    rows = res.data.values as string[][] | undefined;
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
    const slots = parseThreadSlots(String(row[iSlots] ?? "")).filter(
      (s) => getThreadBySlot(s) !== undefined
    );
    if (iWin >= 0 && row[iWin]) window = String(row[iWin]).trim();
    if (iUpd >= 0 && row[iUpd]) updatedAt = String(row[iUpd]).trim();
    if (slots.length === 0 || weight <= 0) continue;
    jobs.push({ slots, weight });
  }
  if (jobs.length === 0) return null;
  return { jobs, window, updatedAt, source: tab };
}

/** Order history: the 3-month feed if it exists, else the 12-month one. */
async function readHistoryJobs(): Promise<MachineJobs> {
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;
  if (!spreadsheetId) throw new Error("GOOGLE_SHEET_ID is not set in .env.local");

  const primaryTab = process.env.GOOGLE_THREAD_STATS_TAB || "THREAD_STATS";
  const fallbackTab = process.env.GOOGLE_ORDER_STATS_TAB || "ORDER_STATS";

  const read =
    (await readJobsFromTab(spreadsheetId, primaryTab)) ??
    (await readJobsFromTab(spreadsheetId, fallbackTab));

  if (!read) return { jobs: [], meta: { window: "", updatedAt: null, source: "" } };

  return {
    jobs: read.jobs,
    meta: {
      window: read.window || (read.source === primaryTab ? "Rolling 3 months" : "Rolling 12 months"),
      updatedAt: read.updatedAt,
      source: read.source,
    },
  };
}

/**
 * The live `webster-live` queue. Not connected yet — this is the seam. When it
 * lands it needs to: read open orders tagged `webster-live`, map each line's
 * icon-one/two/three + color-text-one to palette slots via MASTER, drop the
 * Checkout+ insurance line and any line with no customizer attributes, and emit
 * one Job per distinct color-set with weight = how many are waiting.
 */
async function readQueueJobs(): Promise<MachineJobs> {
  return { jobs: [], meta: { window: "Open queue", updatedAt: null, source: "" } };
}

const JOB_SOURCES: Record<JobSourceKey, () => Promise<MachineJobs>> = {
  history: readHistoryJobs,
  queue: readQueueJobs,
};

/** Jobs from the chosen source, cached 60s per source. */
export async function getMachineJobs(
  options: { source?: JobSourceKey; forceRefresh?: boolean } = {}
): Promise<MachineJobs> {
  const source: JobSourceKey = options.source ?? "history";
  const hit = cache.get(source);
  if (!options.forceRefresh && hit && hit.expiresAt > Date.now()) return hit.data;

  const data = await JOB_SOURCES[source]();
  cache.set(source, { data, expiresAt: Date.now() + CACHE_TTL_MS });
  return data;
}

/** Jobs + the saved floor for every fleet — everything the Machines page needs. */
export async function getMachinesPageData(options: { source?: JobSourceKey } = {}): Promise<{
  jobs: Job[];
  meta: MachineJobsMeta;
  floors: Partial<Record<FleetKey, FloorState>>;
}> {
  const [{ jobs, meta }, floors] = await Promise.all([
    getMachineJobs(options),
    getActiveFloors().catch(() => ({} as Partial<Record<FleetKey, FloorState>>)),
  ]);
  return { jobs, meta, floors };
}

/** Jobs + allocation for a given floor (defaults if omitted). Used by the day sheet. */
export async function getMachineAllocation(
  floors?: Partial<Record<FleetKey, FloorState>>,
  options: { source?: JobSourceKey } = {}
): Promise<AllocationResult> {
  const { jobs, meta } = await getMachineJobs(options);
  return computeAllocation(jobs, floors, meta);
}
