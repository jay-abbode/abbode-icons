/**
 * Thread-machine allocation engine (pure — no sheet/network I/O, so it is safe
 * to import into client components and recompute in the browser).
 *
 * Works out which of the 24 spool colors each embroidery head should carry so
 * that as many orders as possible run *change-free* (a head can stitch a design
 * without swapping spools iff every color the design uses is already loaded on
 * it).
 *
 * Standard heads carry the most-popular colors (top-16 / top-15 by
 * order-weighted frequency). Off-color heads carry the rarer colors plus the
 * popular companions they appear alongside, chosen greedily to cover the orders
 * the standard heads can't.
 *
 * FLOOR MODEL
 * -----------
 * A fleet may be organised into ROOMS (Webster: 6 rooms, 25 heads). Rooms and
 * individual heads can be switched off; rooms can be renamed and LOCKED.
 *
 *   • Locked room  — its heads keep the loadout they had when you locked it, and
 *                    the rest of the fleet re-solves around them. You lock so you
 *                    don't re-thread; drift is reported, not silently eaten.
 *   • Solve scope  — "fleet": one shared tail; off-color heads cover the whole
 *                    floor (right when work can go to any head).
 *                    "room": every room covers its own tail (right when a room
 *                    only ever runs the jobs handed to it).
 *
 * Each row of the stats tab is one design ("job"): the Madeira slot numbers it
 * uses and how many times it was ordered in the window (its weight).
 */

import { getThreadBySlot } from "./threadPalette";

export type FleetKey = "abbode" | "webster";

/** How off-color heads are solved. See the file header. */
export type SolveScope = "fleet" | "room";

export type RoomDef = { id: string; size: number };

/** Static description of a fleet. needleCount = spools per head (= loadout size). */
export type FleetBase = {
  key: FleetKey;
  label: string;
  brand: string;
  needleCount: number;
  /** Fixed head names, for roomless fleets (Abbode). */
  machineNames?: string[];
  /** Rooms, in physical order. Head ids are `${roomId}-${n}` (1-based). */
  rooms?: RoomDef[];
  /** Default off-color heads, counted from the end of the fleet (fleet scope). */
  defaultOffCount: number;
  /** Default off-color heads per room in room scope. A room is 3–5 heads, so the
   * fleet-wide number would swallow half of it; 1 is the sane starting point. */
  defaultRoomOffCount?: number;
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
    // 25 heads across 6 rooms. Ids are positional (1-1 … 6-4) and never change;
    // room *names* are labels the user can edit.
    rooms: [
      { id: "1", size: 4 },
      { id: "2", size: 3 },
      { id: "3", size: 5 },
      { id: "4", size: 4 },
      { id: "5", size: 5 },
      { id: "6", size: 4 },
    ],
    defaultOffCount: 2,
    defaultRoomOffCount: 1,
  },
];

export function fleetBase(key: FleetKey): FleetBase {
  const b = FLEET_BASES.find((f) => f.key === key);
  if (!b) throw new Error(`Unknown fleet: ${key}`);
  return b;
}

// ── Heads ──────────────────────────────────────────────────────────────────

export type HeadDef = { id: string; name: string; roomId: string | null };

/** Every head of a fleet in physical order. Roomed fleets get `${room}-${n}`. */
export function headsFor(base: FleetBase): HeadDef[] {
  if (base.rooms) {
    const out: HeadDef[] = [];
    for (const room of base.rooms) {
      for (let i = 1; i <= room.size; i++) {
        const id = `${room.id}-${i}`;
        out.push({ id, name: id, roomId: room.id });
      }
    }
    return out;
  }
  return (base.machineNames ?? []).map((name) => ({ id: name, name, roomId: null }));
}

// ── Floor state (the thing that gets saved) ────────────────────────────────

/**
 * Everything the user can change about a fleet's floor. Serialises to JSON and
 * lives in the MACHINE_CONFIGS tab. Empty lists mean "nothing switched off", so
 * a blank object is a fully-active floor.
 */
export type FloorState = {
  scope: SolveScope;
  /** roomId -> custom label. Ids stay positional; names are cosmetic. */
  roomNames: Record<string, string>;
  /** Rooms switched OFF. */
  inactiveRooms: string[];
  /** Individual heads switched OFF. */
  inactiveMachines: string[];
  /** Heads marked off-color. */
  offColor: string[];
  /** Rooms whose loadouts are pinned. */
  lockedRooms: string[];
  /** headId -> frozen loadout, captured at the moment its room was locked. */
  lockedSlots: Record<string, number[]>;
};

/** Off-color heads for a fresh floor: the last N of the fleet (fleet scope), or
 * the last N of every room (room scope, where each room must stand alone). */
export function defaultOffIds(base: FleetBase, scope: SolveScope): string[] {
  const heads = headsFor(base);
  const takeLast = (ids: string[], n: number) => {
    const off = Math.min(n, Math.max(0, ids.length - 1)); // always leave ≥1 standard head
    return ids.slice(ids.length - off);
  };
  if (scope === "room" && base.rooms) {
    const n = base.defaultRoomOffCount ?? 1;
    return base.rooms.flatMap((r) =>
      takeLast(
        heads.filter((h) => h.roomId === r.id).map((h) => h.id),
        n
      )
    );
  }
  return takeLast(
    heads.map((h) => h.id),
    base.defaultOffCount
  );
}

export function defaultFloor(base: FleetBase, scope: SolveScope = "fleet"): FloorState {
  return {
    scope,
    roomNames: {},
    inactiveRooms: [],
    inactiveMachines: [],
    offColor: defaultOffIds(base, scope),
    lockedRooms: [],
    lockedSlots: {},
  };
}

/** Coerce anything — a hand-edited sheet cell, an older saved config — into a
 * valid floor for this fleet: unknown ids dropped, missing keys defaulted. */
export function normalizeFloor(base: FleetBase, raw: unknown): FloorState {
  const heads = headsFor(base);
  const headIds = new Set(heads.map((h) => h.id));
  const roomIds = new Set((base.rooms ?? []).map((r) => r.id));
  const src = (raw && typeof raw === "object" ? raw : {}) as Partial<FloorState>;

  const scope: SolveScope = src.scope === "room" && base.rooms ? "room" : "fleet";
  const ids = (v: unknown, allowed: Set<string>) =>
    Array.isArray(v) ? Array.from(new Set(v.map(String).filter((x) => allowed.has(x)))) : [];

  const roomNames: Record<string, string> = {};
  if (src.roomNames && typeof src.roomNames === "object") {
    for (const [k, v] of Object.entries(src.roomNames)) {
      if (roomIds.has(k) && typeof v === "string" && v.trim()) roomNames[k] = v.trim().slice(0, 40);
    }
  }

  const lockedSlots: Record<string, number[]> = {};
  if (src.lockedSlots && typeof src.lockedSlots === "object") {
    for (const [k, v] of Object.entries(src.lockedSlots)) {
      if (!headIds.has(k) || !Array.isArray(v)) continue;
      const slots = (v as unknown[])
        .map((n) => parseInt(String(n), 10))
        .filter((n) => Number.isInteger(n) && getThreadBySlot(n) !== undefined)
        .slice(0, base.needleCount);
      if (slots.length) lockedSlots[k] = slots;
    }
  }

  return {
    scope,
    roomNames,
    inactiveRooms: ids(src.inactiveRooms, roomIds),
    inactiveMachines: ids(src.inactiveMachines, headIds),
    offColor: src.offColor === undefined ? defaultOffIds(base, scope) : ids(src.offColor, headIds),
    lockedRooms: ids(src.lockedRooms, roomIds),
    lockedSlots,
  };
}

/** Fill in any missing/invalid fleet floors. */
export function normalizeFloors(
  raw: Partial<Record<FleetKey, unknown>> | undefined
): Record<FleetKey, FloorState> {
  const out = {} as Record<FleetKey, FloorState>;
  for (const base of FLEET_BASES) {
    const given = raw?.[base.key];
    out[base.key] =
      given === undefined || given === null ? defaultFloor(base) : normalizeFloor(base, given);
  }
  return out;
}

// ── Public result shapes ───────────────────────────────────────────────────

export type Machine = {
  id: string;
  name: string;
  roomId: string | null;
  active: boolean;
  offColor: boolean;
  locked: boolean;
  /** Slot numbers in needle order (needle 1 = most popular). Empty when inactive. */
  slots: number[];
};

export type RoomResult = {
  id: string;
  /** Custom label if set, else "Room <id>". */
  name: string;
  active: boolean;
  locked: boolean;
  machines: Machine[];
  activeCount: number;
  /** Share of order-weight at least one active head *in this room* can stitch. */
  changeFree: number;
  /** What a clean re-thread of this room would score today. Only differs from
   * `changeFree` on a locked room whose pinned loadout has gone stale. */
  freshChangeFree: number;
};

export type Fleet = {
  key: FleetKey;
  label: string;
  brand: string;
  needleCount: number;
  scope: SolveScope;
  machines: Machine[];
  rooms: RoomResult[] | null;
  standardSlots: number[];
  activeCount: number;
  /** How many active heads carry the plain standard loadout. */
  standardCount: number;
  offCount: number;
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
  if (totalWeight <= 0 || loadouts.length === 0) return 0;
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

/** Run the greedy builder over a list of off-color heads, seeded by whatever the
 * already-fixed loadouts (locked heads + the standard loadout) cover. */
function assignOffColor(
  offHeads: { id: string }[],
  jobs: Job[],
  seeds: Set<number>[],
  K: number,
  rankpos: Map<number, number>,
  standard: number[],
  out: Map<string, number[]>
) {
  let rem = seeds.length ? jobs.filter((j) => !seeds.some((S) => isSubset(j.slots, S))) : jobs;
  for (const h of offHeads) {
    const { slots, remaining } = buildOffColor(K, rem, rankpos);
    // Nothing left to chase: carry the standard loadout rather than sit empty.
    out.set(h.id, slots.length ? slots : standard);
    rem = remaining;
  }
}

// ── Fleet solve ────────────────────────────────────────────────────────────

function solveFleet(
  base: FleetBase,
  jobs: Job[],
  floor: FloorState,
  ranked: number[],
  rankpos: Map<number, number>,
  totalWeight: number
): Fleet {
  const K = base.needleCount;
  const heads = headsFor(base);
  const standard = ranked.slice(0, K);
  const stdSet = new Set(standard);

  const inactiveRooms = new Set(floor.inactiveRooms);
  const inactiveHeads = new Set(floor.inactiveMachines);
  const lockedRooms = new Set(floor.lockedRooms);
  const offIds = new Set(floor.offColor);

  const isActive = (h: HeadDef) =>
    !inactiveHeads.has(h.id) && !(h.roomId !== null && inactiveRooms.has(h.roomId));
  // A head is only *effectively* pinned if we actually captured its loadout. A
  // lock with no stored slots (e.g. hand-edited JSON) just re-solves normally.
  const isPinned = (h: HeadDef) =>
    h.roomId !== null && lockedRooms.has(h.roomId) && Array.isArray(floor.lockedSlots[h.id]);

  const active = heads.filter(isActive);
  const slotsById = new Map<string, number[]>();

  // 1) Pinned heads keep the loadout they were locked with.
  for (const h of active) if (isPinned(h)) slotsById.set(h.id, floor.lockedSlots[h.id]);

  // 2) Free standard heads all share today's top-K.
  const free = active.filter((h) => !isPinned(h));
  const freeStd = free.filter((h) => !offIds.has(h.id));
  for (const h of freeStd) slotsById.set(h.id, standard);

  // 3) Free off-color heads chase whatever the fixed loadouts don't cover.
  const freeOff = free.filter((h) => offIds.has(h.id));
  const scope: SolveScope = floor.scope === "room" && base.rooms ? "room" : "fleet";

  if (scope === "room" && base.rooms) {
    for (const room of base.rooms) {
      const inRoom = (h: HeadDef) => h.roomId === room.id;
      const seeds: Set<number>[] = [];
      for (const h of active.filter(inRoom)) {
        if (isPinned(h)) seeds.push(new Set(slotsById.get(h.id)!));
      }
      if (freeStd.some(inRoom)) seeds.push(stdSet);
      assignOffColor(freeOff.filter(inRoom), jobs, seeds, K, rankpos, standard, slotsById);
    }
  } else {
    const seeds: Set<number>[] = [];
    for (const h of active) if (isPinned(h)) seeds.push(new Set(slotsById.get(h.id)!));
    if (freeStd.length) seeds.push(stdSet);
    assignOffColor(freeOff, jobs, seeds, K, rankpos, standard, slotsById);
  }

  const machines: Machine[] = heads.map((h) => ({
    id: h.id,
    name: h.name,
    roomId: h.roomId,
    active: isActive(h),
    offColor: offIds.has(h.id),
    locked: h.roomId !== null && lockedRooms.has(h.roomId),
    slots: isActive(h) ? slotsById.get(h.id) ?? [] : [],
  }));

  const activeLoadouts = machines.filter((m) => m.active && m.slots.length).map((m) => new Set(m.slots));
  const changeFreeAll = coverage(jobs, activeLoadouts, totalWeight);
  const changeFreeStandard = freeStd.length ? coverage(jobs, [stdSet], totalWeight) : 0;

  // Per-room reporting. A locked room also reports what a clean re-thread would
  // score today, so you can see when the pin is costing you points.
  let rooms: RoomResult[] | null = null;
  if (base.rooms) {
    rooms = base.rooms.map((room) => {
      const mine = machines.filter((m) => m.roomId === room.id);
      const activeMine = mine.filter((m) => m.active);
      const cf = coverage(
        jobs,
        activeMine.filter((m) => m.slots.length).map((m) => new Set(m.slots)),
        totalWeight
      );

      let fresh = cf;
      if (lockedRooms.has(room.id) && activeMine.length) {
        const trial = new Map<string, number[]>();
        const stdHeads = activeMine.filter((m) => !m.offColor);
        for (const m of stdHeads) trial.set(m.id, standard);
        assignOffColor(
          activeMine.filter((m) => m.offColor),
          jobs,
          stdHeads.length ? [stdSet] : [],
          K,
          rankpos,
          standard,
          trial
        );
        fresh = coverage(
          jobs,
          [...trial.values()].map((s) => new Set(s)),
          totalWeight
        );
      }

      return {
        id: room.id,
        name: floor.roomNames[room.id]?.trim() || `Room ${room.id}`,
        active: !inactiveRooms.has(room.id),
        locked: lockedRooms.has(room.id),
        machines: mine,
        activeCount: activeMine.length,
        changeFree: cf,
        freshChangeFree: fresh,
      };
    });
  }

  return {
    key: base.key,
    label: base.label,
    brand: base.brand,
    needleCount: K,
    scope,
    machines,
    rooms,
    standardSlots: standard,
    activeCount: active.length,
    standardCount: freeStd.length,
    offCount: machines.filter((m) => m.active && m.offColor).length,
    changeFreeStandard,
    changeFreeAll,
  };
}

/** Build the full allocation for every fleet given the floor state. Pure. */
export function computeAllocation(
  jobs: Job[],
  floors: Partial<Record<FleetKey, unknown>> | undefined,
  meta: MachineJobsMeta = { window: "", updatedAt: null, source: "" }
): AllocationResult {
  const { ranked, weightBySlot, totalWeight } = rankColors(jobs);
  const rankpos = new Map<number, number>(ranked.map((s, i) => [s, i]));
  const floorMap = normalizeFloors(floors);

  const popularity: PopularityRow[] = ranked.map((slot) => {
    const weight = weightBySlot.get(slot) ?? 0;
    return { slot, weight, share: totalWeight > 0 ? weight / totalWeight : 0 };
  });

  const fleets = FLEET_BASES.map((base) =>
    solveFleet(base, jobs, floorMap[base.key], ranked, rankpos, totalWeight)
  );

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

/** Order-independent signature of a floor. Two floors that would solve to the
 * same result share a fingerprint — that's how the UI knows it has unsaved
 * changes without diffing objects by hand. */
export function floorFingerprint(base: FleetBase, floor: FloorState): string {
  const f = normalizeFloor(base, floor);
  const sorted = (a: string[]) => [...a].sort();
  const slots: Record<string, number[]> = {};
  for (const k of Object.keys(f.lockedSlots).sort()) slots[k] = f.lockedSlots[k];
  const names: Record<string, string> = {};
  for (const k of Object.keys(f.roomNames).sort()) names[k] = f.roomNames[k];
  return JSON.stringify({
    scope: f.scope,
    roomNames: names,
    inactiveRooms: sorted(f.inactiveRooms),
    inactiveMachines: sorted(f.inactiveMachines),
    offColor: sorted(f.offColor),
    lockedRooms: sorted(f.lockedRooms),
    lockedSlots: slots,
  });
}

/** The loadouts a room's active heads currently carry — what we freeze on lock. */
export function captureRoomSlots(fleet: Fleet, roomId: string): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const m of fleet.machines) {
    if (m.roomId === roomId && m.active && m.slots.length) out[m.id] = [...m.slots];
  }
  return out;
}
