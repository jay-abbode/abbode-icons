/**
 * Thread-machine allocation engine (pure — no sheet/network I/O, so it is safe
 * to import into client components and recompute in the browser).
 *
 * Works out which of the 24 spool colors each embroidery machine should carry
 * so that as many orders as possible run *change-free* (a machine can stitch a
 * design without swapping spools iff every color the design uses is already
 * loaded on it).
 *
 * Standard machines carry the most-popular colors (top-16 / top-15 by
 * order-weighted frequency). Off-color machines carry the rarer colors plus the
 * popular companions they appear alongside, chosen greedily to cover the orders
 * the standard machines can't. WHICH machines are off-color is selectable in the
 * UI (default: the last 1–2 heads); the loadouts and change-free % re-tune to
 * whatever is selected.
 *
 * Each row of the stats tab is one design ("job"): the Madeira slot numbers it
 * uses and how many times it was ordered in the window (its weight). Popularity,
 * loadouts, and coverage are all derived from these jobs.
 */

import { getThreadBySlot } from "./threadPalette";

export type FleetKey = "abbode" | "webster";

/** Static description of a fleet: its heads in physical order + how many are
 * off-color by default. needleCount = spools loaded per head (= loadout size). */
export type FleetBase = {
  key: FleetKey;
  label: string;
  brand: string;
  needleCount: number;
  /** Fixed head names, when the fleet size is constant (e.g. Abbode). */
  machineNames?: string[];
  /** For fleets whose number of heads in use varies day-to-day (e.g. Webster):
   * the selectable range + a namer. `machineNames` is ignored when this is set. */
  countable?: { min: number; max: number; default: number; nameFor: (index: number) => string };
  /** Default number of off-color heads = this many from the end of the list. */
  defaultOffCount: number;
};

export const FLEET_BASES: FleetBase[] = [
  {
    key: "abbode",
    label: "Abbode",
    brand: "Melco EMT16X · 16 needles",
    needleCount: 16,
    machineNames: ["Machine 4", "Machine 5", "Machine 6", "Machine 9", "No-Name", "Hello Kitty", "Megatron"],
    defaultOffCount: 1,
  },
  {
    key: "webster",
    label: "Webster",
    brand: "Barudan BEVT-X1501 · 15 needles",
    needleCount: 15,
    // Webster's number of running heads changes day-to-day; pick 1–25.
    countable: { min: 1, max: 25, default: 16, nameFor: (i) => `Machine ${i + 1}` },
    defaultOffCount: 2,
  },
];

/** Per-fleet indices (into machineNames) of the heads marked off-color. */
export type OffSelection = Record<FleetKey, number[]>;

/** The head names for a fleet, honouring a selected machine count for countable
 * fleets (Webster). Fixed fleets (Abbode) ignore the count. */
export function machineNamesFor(base: FleetBase, count?: number): string[] {
  if (base.countable) {
    const c = base.countable;
    const n = Math.min(c.max, Math.max(c.min, Math.round(count ?? c.default)));
    return Array.from({ length: n }, (_, i) => c.nameFor(i));
  }
  return base.machineNames ?? [];
}

/** Default off-color heads = the last `defaultOffCount` heads, but always leaving
 * at least one standard head. `machineCounts` sizes countable fleets. */
export function defaultOffSelection(machineCounts?: Partial<Record<FleetKey, number>>): OffSelection {
  const sel = {} as OffSelection;
  for (const base of FLEET_BASES) {
    const n = machineNamesFor(base, machineCounts?.[base.key]).length;
    const offN = Math.min(base.defaultOffCount, Math.max(0, n - 1));
    const start = n - offN;
    sel[base.key] = Array.from({ length: offN }, (_, i) => start + i);
  }
  return sel;
}

// ── Public shapes ──────────────────────────────────────────────────────────
export type Machine = {
  name: string;
  offColor: boolean;
  /** Slot numbers in needle order (needle 1 = most popular). */
  slots: number[];
};

export type Fleet = {
  key: FleetKey;
  label: string;
  brand: string;
  needleCount: number;
  machines: Machine[];
  standardSlots: number[];
  changeFreeStandard: number;
  changeFreeAll: number;
};

export type PopularityRow = { slot: number; weight: number; share: number };

export type MachineJobsMeta = { window: string; updatedAt: string | null; source: string };

export type AllocationResult = {
  fleets: Fleet[];
  ranked: number[];
  popularity: PopularityRow[];
  totalWeight: number;
  jobCount: number;
  window: string;
  updatedAt: string | null;
  source: string;
};

export type Job = { slots: number[]; weight: number };

// ── Core algorithm (validated against the Python reference) ─────────────────

const ALL_SLOTS = getPaletteSlots();
function getPaletteSlots(): number[] {
  const out: number[] = [];
  for (let s = 0; s <= 37; s++) if (getThreadBySlot(s)) out.push(s);
  return out;
}

function isSubset(slots: number[], loaded: Set<number>): boolean {
  for (const s of slots) if (!loaded.has(s)) return false;
  return true;
}

function rankColors(jobs: Job[]): {
  ranked: number[];
  weightBySlot: Map<number, number>;
  totalWeight: number;
} {
  const weightBySlot = new Map<number, number>();
  let totalWeight = 0;
  for (const job of jobs) {
    totalWeight += job.weight;
    for (const s of job.slots) weightBySlot.set(s, (weightBySlot.get(s) ?? 0) + job.weight);
  }
  const ranked = [...ALL_SLOTS].sort((a, b) => {
    const d = (weightBySlot.get(b) ?? 0) - (weightBySlot.get(a) ?? 0);
    return d !== 0 ? d : a - b;
  });
  return { ranked, weightBySlot, totalWeight };
}

function coverage(jobs: Job[], loadouts: Set<number>[], totalWeight: number): number {
  if (totalWeight <= 0) return 0;
  let covered = 0;
  for (const job of jobs) {
    if (loadouts.some((L) => isSubset(job.slots, L))) covered += job.weight;
  }
  return covered / totalWeight;
}

/** Greedily build one off-color loadout of size K, then return the still-uncovered
 * jobs. Faithful port of the validated Python: add the color that most increases
 * fully-covered weight, breaking ties toward the more popular color. */
function buildOffColor(
  K: number,
  remaining: Job[],
  rankpos: Map<number, number>
): { slots: number[]; remaining: Job[] } {
  const L = new Set<number>();
  let rem = remaining;

  while (L.size < K) {
    const cands = new Set<number>();
    for (const job of rem) for (const s of job.slots) if (!L.has(s)) cands.add(s);
    if (cands.size === 0) break;

    const base = rem.reduce((sum, j) => (isSubset(j.slots, L) ? sum + j.weight : sum), 0);
    let best: number | null = null;
    let bestGain = 0;
    const ordered = [...cands].sort((a, b) => rankpos.get(a)! - rankpos.get(b)!);
    for (const c of ordered) {
      const trial = new Set(L);
      trial.add(c);
      const covered = rem.reduce((sum, j) => (isSubset(j.slots, trial) ? sum + j.weight : sum), 0);
      const gain = covered - base;
      if (gain > bestGain) {
        bestGain = gain;
        best = c;
      }
    }
    if (best === null || bestGain <= 0) {
      const cnt = new Map<number, number>();
      for (const job of rem)
        for (const s of job.slots) if (!L.has(s)) cnt.set(s, (cnt.get(s) ?? 0) + job.weight);
      let fb: number | null = null;
      let fbW = -1;
      for (const [slot, w] of cnt) {
        if (w > fbW || (w === fbW && fb !== null && rankpos.get(slot)! < rankpos.get(fb)!)) {
          fbW = w;
          fb = slot;
        }
      }
      best = fb;
    }
    if (best === null) break;

    L.add(best);
    rem = rem.filter((j) => !isSubset(j.slots, L));
  }

  const slots = [...L].sort((a, b) => rankpos.get(a)! - rankpos.get(b)!);
  return { slots, remaining: rem };
}

/** Normalize an off-color index list for a fleet: keep in-range, unique, sorted. */
function cleanOffIndices(indices: number[] | undefined, machineCount: number): number[] {
  const seen = new Set<number>();
  const out: number[] = [];
  for (const i of indices ?? []) {
    if (Number.isInteger(i) && i >= 0 && i < machineCount && !seen.has(i)) {
      seen.add(i);
      out.push(i);
    }
  }
  out.sort((a, b) => a - b);
  return out;
}

/** Build the full allocation for both fleets given the off-color selection. Pure. */
export function computeAllocation(
  jobs: Job[],
  offSelection: OffSelection,
  meta: MachineJobsMeta = { window: "", updatedAt: null, source: "" },
  machineCounts?: Partial<Record<FleetKey, number>>
): AllocationResult {
  const { ranked, weightBySlot, totalWeight } = rankColors(jobs);
  const rankpos = new Map<number, number>(ranked.map((s, i) => [s, i]));

  const popularity: PopularityRow[] = ranked.map((slot) => {
    const weight = weightBySlot.get(slot) ?? 0;
    return { slot, weight, share: totalWeight > 0 ? weight / totalWeight : 0 };
  });

  const fleets: Fleet[] = FLEET_BASES.map((base) => {
    const K = base.needleCount;
    const machineNames = machineNamesFor(base, machineCounts?.[base.key]);
    const offIdx = cleanOffIndices(offSelection?.[base.key], machineNames.length);
    const offSet = new Set(offIdx);

    const standard = ranked.slice(0, K);
    const stdSet = new Set(standard);

    // Greedily build one loadout per off-color head.
    const offs: number[][] = [];
    let rem = jobs.filter((j) => !isSubset(j.slots, stdSet));
    for (let i = 0; i < offIdx.length; i++) {
      const { slots, remaining } = buildOffColor(K, rem, rankpos);
      offs.push(slots);
      rem = remaining;
    }

    // Assign loadouts to heads in physical order.
    let k = 0;
    const machines: Machine[] = machineNames.map((name, i) => {
      if (offSet.has(i)) {
        const loadout = offs[k] && offs[k].length ? offs[k] : standard;
        k += 1;
        return { name, offColor: true, slots: loadout };
      }
      return { name, offColor: false, slots: standard };
    });

    const changeFreeStandard = coverage(jobs, [stdSet], totalWeight);
    const changeFreeAll = coverage(jobs, [stdSet, ...offs.map((o) => new Set(o))], totalWeight);

    return {
      key: base.key,
      label: base.label,
      brand: base.brand,
      needleCount: base.needleCount,
      machines,
      standardSlots: standard,
      changeFreeStandard,
      changeFreeAll,
    };
  });

  return {
    fleets,
    ranked,
    popularity,
    totalWeight,
    jobCount: jobs.length,
    window: meta.window,
    updatedAt: meta.updatedAt,
    source: meta.source,
  };
}
