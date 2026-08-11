"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@/auth";
import {
  deleteConfig,
  listConfigs,
  saveNamedConfig,
  setActiveFloor,
  type ConfigMeta,
  type MachineConfig,
} from "@/lib/machineConfigs";
import { computeAllocation, fleetBase, normalizeFloor, type FleetKey, type FloorState } from "@/lib/threadAllocation";
import { getMachineJobs } from "@/lib/threadAllocationData";
import { getActiveFloor } from "@/lib/machineConfigs";

export type ConfigResult =
  | { ok: true; configs: MachineConfig[] }
  | { ok: false; error: string };

function isFleetKey(v: string): v is FleetKey {
  return v === "abbode" || v === "webster";
}

async function requireUser(): Promise<{ email: string; name: string } | null> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return null;
  return { email: email.toLowerCase(), name: session.user?.name || email };
}

function refresh() {
  revalidatePath("/machines");
  revalidatePath("/machines/config");
  revalidatePath("/machines/daysheet");
  revalidatePath("/machines/webster/room/[id]", "page");
  revalidatePath("/machines/routing");
  revalidatePath("/machines/routing/room/[id]", "page");
}

/** Set what a fleet is actually threaded to right now. The config it replaces is
 * kept as an automatic snapshot. */
export async function setActiveConfig(
  fleet: string,
  state: FloorState,
  meta: ConfigMeta
): Promise<ConfigResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "You're not signed in." };
  if (!isFleetKey(fleet)) return { ok: false, error: "Unknown fleet." };

  try {
    const clean = normalizeFloor(fleetBase(fleet), state);
    await setActiveFloor(fleet, clean, meta, user.email);
    refresh();
    return { ok: true, configs: await listConfigs(fleet) };
  } catch (err) {
    console.error("Failed to set active thread config:", err);
    return {
      ok: false,
      error:
        "Couldn't save. The service account may not have edit access to the sheet — see setup notes.",
    };
  }
}

/** Save a named configuration you can load back later. */
export async function saveConfig(
  fleet: string,
  name: string,
  state: FloorState,
  meta: ConfigMeta
): Promise<ConfigResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "You're not signed in." };
  if (!isFleetKey(fleet)) return { ok: false, error: "Unknown fleet." };
  if (!(name || "").trim()) return { ok: false, error: "Give the configuration a name." };

  try {
    const clean = normalizeFloor(fleetBase(fleet), state);
    await saveNamedConfig(fleet, name, clean, meta, user.email);
    refresh();
    return { ok: true, configs: await listConfigs(fleet) };
  } catch (err) {
    console.error("Failed to save thread config:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

export async function removeConfig(fleet: string, id: string): Promise<ConfigResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "You're not signed in." };
  if (!isFleetKey(fleet)) return { ok: false, error: "Unknown fleet." };

  try {
    await deleteConfig(id);
    refresh();
    return { ok: true, configs: await listConfigs(fleet) };
  } catch (err) {
    console.error("Failed to delete thread config:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, error: msg };
  }
}

/** Re-read the saved configs (used after a save so scores can be re-scored). */
export async function refreshConfigs(fleet: string): Promise<ConfigResult> {
  if (!isFleetKey(fleet)) return { ok: false, error: "Unknown fleet." };
  try {
    return { ok: true, configs: await listConfigs(fleet) };
  } catch (err) {
    console.error("Failed to list thread configs:", err);
    return { ok: false, error: "Couldn't load saved configurations." };
  }
}

/**
 * The Webster board's one button. Takes the set of rooms blocked off, solves
 * the thread configuration across the remaining rooms against the OUTSTANDING
 * ORDER QUEUE (every open `webster-live` order, not a history bet), then PINS
 * the solved loadouts — every active room is saved locked, with each head's
 * exact slots frozen. That pin is what keeps every surface honest: the queue
 * keeps moving all day, but the board, the room lists, the day sheet, and the
 * tablet pages all recompute to the same frozen loadouts until the next
 * Generate. Room names, off-color heads, and solve scope carry over from the
 * previous config; a floor that has never been configured starts from room
 * scope, where every room stands alone.
 */
export async function generateWebsterDay(
  inactiveRooms: string[]
): Promise<{ ok: true; score: number; window: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "You're not signed in." };

  try {
    const base = fleetBase("webster");
    const existing = await getActiveFloor("webster");

    // Solve with locks cleared — yesterday's pins must not constrain today's.
    const floorForSolve = normalizeFloor(base, {
      ...(existing ?? { scope: "room" }),
      inactiveRooms: inactiveRooms.map(String),
      lockedRooms: [],
      lockedSlots: {},
    });

    const { jobs, meta } = await getMachineJobs({ source: "queue", forceRefresh: true });
    if (jobs.length === 0) {
      return {
        ok: false,
        error: "No outstanding orders in the queue — run the Webster order queue workflow, then Generate.",
      };
    }

    const alloc = computeAllocation(jobs, { webster: floorForSolve }, meta);
    const fleet = alloc.fleets.find((f) => f.key === "webster");
    if (!fleet) return { ok: false, error: "Webster fleet not found." };
    if (fleet.activeCount === 0) {
      return { ok: false, error: "Every room is blocked — leave at least one on." };
    }

    // Pin what was just solved: lock every open room, freeze every head.
    const lockedSlots: Record<string, number[]> = {};
    for (const m of fleet.machines) {
      if (m.active && m.slots.length > 0) lockedSlots[m.id] = m.slots;
    }
    const lockedRooms = (fleet.rooms ?? []).filter((r) => r.active).map((r) => r.id);

    const floorFinal = normalizeFloor(base, { ...floorForSolve, lockedRooms, lockedSlots });

    await setActiveFloor(
      "webster",
      floorFinal,
      { score: fleet.changeFreeAll, window: meta.window, jobCount: jobs.length },
      user.email
    );
    refresh();
    return { ok: true, score: fleet.changeFreeAll, window: meta.window };
  } catch (err) {
    console.error("Failed to generate the Webster config:", err);
    return {
      ok: false,
      error: "Couldn't generate. The service account may not have edit access to the sheet.",
    };
  }
}
