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
import { fleetBase, normalizeFloor, type FleetKey, type FloorState } from "@/lib/threadAllocation";

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
  revalidatePath("/machines/daysheet");
  revalidatePath("/machines/webster/room/[id]", "page");
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
