/**
 * Saved thread configurations, backed by a MACHINE_CONFIGS tab in the same sheet
 * that holds the icon catalog. Auto-creates the tab on first write, same as
 * COMMENTS — no new infrastructure, and the rows stay human-inspectable.
 *
 * Three kinds of row:
 *   active    one per fleet. What the floor is *actually threaded to right now*.
 *             This is what the day sheet prints and what a room tablet shows.
 *   saved     a named config you can load back (seasonal presets, scenarios).
 *   snapshot  written automatically whenever Active changes, so you can roll
 *             back even when you forgot to save. Pruned to the last 20/fleet.
 *
 * Every row also stores the change-free % it scored and the data window it was
 * solved against — that's what lets the UI show config drift ("saved at 97.9%,
 * scores 91.4% on this week's queue").
 *
 * Sheet layout:
 *   A Id · B Fleet · C Kind · D Name · E Saved At · F Saved By
 *   G Score · H Window · I Jobs · J State (JSON)
 */

import { getSheetsClient } from "./google";
import { fleetBase, normalizeFloor, type FleetKey, type FloorState } from "./threadAllocation";

const TAB = "MACHINE_CONFIGS";
const HEADER = [
  "Id",
  "Fleet",
  "Kind",
  "Name",
  "Saved At",
  "Saved By",
  "Score",
  "Window",
  "Jobs",
  "State (JSON)",
];
const RANGE = `${TAB}!A2:J2000`;
const MAX_SNAPSHOTS = 20;

export type ConfigKind = "active" | "saved" | "snapshot";

export type MachineConfig = {
  id: string;
  fleet: FleetKey;
  kind: ConfigKind;
  name: string;
  savedAt: string;
  savedBy: string;
  /** Change-free share (0–1) at the moment it was saved. */
  score: number;
  /** Data window it was solved against, e.g. "Rolling 3 months". */
  window: string;
  jobCount: number;
  state: FloorState;
};

/** What a caller must hand us so a config can be re-scored later. */
export type ConfigMeta = { score: number; window: string; jobCount: number };

function requireSheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID environment variable is required.");
  return id;
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function isFleetKey(v: string): v is FleetKey {
  return v === "abbode" || v === "webster";
}

function rowToConfig(r: string[]): MachineConfig | null {
  const [id, fleet, kind, name, savedAt, savedBy, score, window, jobs, state] = r;
  if (!id || !fleet || !isFleetKey(fleet)) return null;
  const k: ConfigKind = kind === "active" || kind === "snapshot" ? kind : "saved";

  let parsed: unknown = {};
  try {
    parsed = JSON.parse(state || "{}");
  } catch {
    parsed = {};
  }

  return {
    id,
    fleet,
    kind: k,
    name: name || "",
    savedAt: savedAt || "",
    savedBy: savedBy || "",
    score: Number.parseFloat(score || "0") || 0,
    window: window || "",
    jobCount: Number.parseInt(jobs || "0", 10) || 0,
    // Always normalise on read: a hand-edited cell or a config saved before a
    // fleet's rooms changed can never crash the page.
    state: normalizeFloor(fleetBase(fleet), parsed),
  };
}

function configToRow(c: MachineConfig): string[] {
  return [
    c.id,
    c.fleet,
    c.kind,
    c.name,
    c.savedAt,
    c.savedBy,
    String(c.score),
    c.window,
    String(c.jobCount),
    JSON.stringify(c.state),
  ];
}

/** Every config row. Returns [] if the tab doesn't exist yet. */
export async function listConfigs(fleet?: FleetKey): Promise<MachineConfig[]> {
  const sheets = getSheetsClient();
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: requireSheetId(),
      range: RANGE,
    });
    const rows = (resp.data.values as string[][]) || [];
    const out = rows.map(rowToConfig).filter((c): c is MachineConfig => c !== null);
    const scoped = fleet ? out.filter((c) => c.fleet === fleet) : out;
    scoped.sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
    return scoped;
  } catch {
    return []; // tab missing — treat as "nothing saved yet"
  }
}

/** The floor a fleet is actually threaded to, or null if it's never been set. */
export async function getActiveFloor(fleet: FleetKey): Promise<FloorState | null> {
  const all = await listConfigs(fleet);
  const active = all.find((c) => c.kind === "active");
  return active ? active.state : null;
}

/** Active floors for every fleet, in one read. */
export async function getActiveFloors(): Promise<Partial<Record<FleetKey, FloorState>>> {
  const all = await listConfigs();
  const out: Partial<Record<FleetKey, FloorState>> = {};
  for (const c of all) {
    if (c.kind === "active" && !out[c.fleet]) out[c.fleet] = c.state;
  }
  return out;
}

export async function getConfig(id: string): Promise<MachineConfig | null> {
  const all = await listConfigs();
  return all.find((c) => c.id === id) ?? null;
}

// ── Writes ─────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

async function ensureTab(sheets: any, spreadsheetId: string): Promise<void> {
  try {
    await sheets.spreadsheets.values.get({ spreadsheetId, range: `${TAB}!A1:J1` });
    return; // exists
  } catch {
    // create it
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: { title: TAB, gridProperties: { frozenRowCount: 1 } },
          },
        },
      ],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TAB}!A1:J1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADER] },
  });
}

async function tabGid(sheets: any, spreadsheetId: string): Promise<number> {
  const meta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties(sheetId,title)",
  });
  const tab = (meta.data.sheets || []).find((s: any) => s.properties?.title === TAB);
  const gid = tab?.properties?.sheetId;
  if (gid === undefined || gid === null) throw new Error(`${TAB} tab not found.`);
  return gid;
}

/** Rewrite the whole tab body. Simplest correct thing at this row count (<2k),
 * and it makes upsert + prune a single atomic-ish operation. */
async function writeAll(configs: MachineConfig[]): Promise<void> {
  const sheets = getSheetsClient();
  const spreadsheetId = requireSheetId();
  await ensureTab(sheets, spreadsheetId);

  const gid = await tabGid(sheets, spreadsheetId);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateCells: {
            range: { sheetId: gid, startRowIndex: 1 },
            fields: "userEnteredValue",
          },
        },
      ],
    },
  });

  if (!configs.length) return;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TAB}!A2`,
    valueInputOption: "RAW",
    requestBody: { values: configs.map(configToRow) },
  });
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** Keep the newest MAX_SNAPSHOTS snapshots per fleet; drop the rest. */
function pruneSnapshots(configs: MachineConfig[]): MachineConfig[] {
  const kept: MachineConfig[] = [];
  const seen: Record<string, number> = {};
  // configs arrive newest-first
  for (const c of configs) {
    if (c.kind !== "snapshot") {
      kept.push(c);
      continue;
    }
    const n = (seen[c.fleet] ?? 0) + 1;
    seen[c.fleet] = n;
    if (n <= MAX_SNAPSHOTS) kept.push(c);
  }
  return kept;
}

/**
 * Set what a fleet is threaded to right now. The config it replaces is kept as a
 * snapshot, so there's always a way back even if nobody remembered to save.
 */
export async function setActiveFloor(
  fleet: FleetKey,
  state: FloorState,
  meta: ConfigMeta,
  savedBy: string
): Promise<MachineConfig> {
  const all = await listConfigs();
  const now = new Date().toISOString();

  const next: MachineConfig[] = [];
  for (const c of all) {
    if (c.fleet === fleet && c.kind === "active") {
      // Demote the outgoing active config to a snapshot.
      next.push({ ...c, kind: "snapshot", name: c.name || "Auto-snapshot" });
    } else {
      next.push(c);
    }
  }

  const active: MachineConfig = {
    id: newId(),
    fleet,
    kind: "active",
    name: "Active",
    savedAt: now,
    savedBy,
    score: meta.score,
    window: meta.window,
    jobCount: meta.jobCount,
    state: normalizeFloor(fleetBase(fleet), state),
  };

  // Newest first, then prune old snapshots.
  const merged = [active, ...next].sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
  await writeAll(pruneSnapshots(merged));
  return active;
}

/** Save a named config you can load back later. */
export async function saveNamedConfig(
  fleet: FleetKey,
  name: string,
  state: FloorState,
  meta: ConfigMeta,
  savedBy: string
): Promise<MachineConfig> {
  const clean = (name || "").trim().slice(0, 60);
  if (!clean) throw new Error("Give the configuration a name.");

  const all = await listConfigs();
  const now = new Date().toISOString();

  const config: MachineConfig = {
    id: newId(),
    fleet,
    kind: "saved",
    name: clean,
    savedAt: now,
    savedBy,
    score: meta.score,
    window: meta.window,
    jobCount: meta.jobCount,
    state: normalizeFloor(fleetBase(fleet), state),
  };

  // Overwrite a same-named save for the same fleet rather than piling up dupes.
  const rest = all.filter(
    (c) => !(c.fleet === fleet && c.kind === "saved" && c.name.toLowerCase() === clean.toLowerCase())
  );
  const merged = [config, ...rest].sort((a, b) => (b.savedAt || "").localeCompare(a.savedAt || ""));
  await writeAll(pruneSnapshots(merged));
  return config;
}

/** Delete one config. The active config can't be deleted — replace it instead. */
export async function deleteConfig(id: string): Promise<void> {
  const all = await listConfigs();
  const target = all.find((c) => c.id === id);
  if (!target) throw new Error("Configuration not found.");
  if (target.kind === "active") throw new Error("Can't delete the active configuration.");
  await writeAll(all.filter((c) => c.id !== id));
}
