/**
 * Change history for Webster's top-N thread tree.
 *
 * The tree is derived from a rolling 12-month window, so it moves on its own as
 * orders come in — a color can slide off the bottom, another can climb three
 * needles, and nobody would know unless it were written down. This records every
 * change so "when did Rust come off the tree?" has an answer.
 *
 * Backed by a THREAD_TREE_LOG tab in the catalog sheet, auto-created on first
 * write — same pattern as COMMENTS and MACHINE_CONFIGS. No new infrastructure,
 * and the rows stay human-readable in the sheet.
 *
 * Sheet layout:
 *   A Recorded At (ISO) · B Window · C Signature · D Coverage · E Total Uses
 *   F Summary · G Detail (JSON)
 *
 * "Signature" is the needle-ordered slot list, e.g. "35,28,34,29,17,...". Two
 * snapshots are the same tree iff their signatures match, so ORDER counts: a
 * color moving from needle 2 to needle 5 is a change worth recording, because
 * it's a change worth re-threading for.
 */

import { getSheetsClient } from "./google";
import { getThreadBySlot } from "./threadPalette";
import type { WebsterThreadTree } from "./websterThreadTree";

const TAB = "THREAD_TREE_LOG";
const HEADER = [
  "Recorded At",
  "Window",
  "Signature",
  "Coverage",
  "Total Uses",
  "Summary",
  "Detail (JSON)",
];
const RANGE = `${TAB}!A2:G1000`;
/** Rows kept. Beyond this the oldest are dropped on the next write. */
const MAX_ENTRIES = 200;

export type SlotMove = { slot: number; from: number; to: number };

export type TreeDiff = {
  /** Slots on the new tree that weren't on the old one. */
  added: number[];
  /** Slots that dropped off. */
  removed: number[];
  /** Slots that stayed but changed needle. `from`/`to` are 1-based needles. */
  moved: SlotMove[];
};

export type TreeLogEntry = {
  recordedAt: string;
  window: string;
  /** Needle-ordered slot list. */
  slots: number[];
  coverage: number;
  totalUses: number;
  summary: string;
  diff: TreeDiff;
  /** True for the very first entry, which has nothing to diff against. */
  baseline: boolean;
};

// ── Pure logic (unit tested) ───────────────────────────────────────────────

export function signatureOf(slots: number[]): string {
  return slots.join(",");
}

/** What changed between two needle-ordered slot lists. */
export function diffTrees(prev: number[], next: number[]): TreeDiff {
  const prevPos = new Map(prev.map((s, i) => [s, i + 1]));
  const nextPos = new Map(next.map((s, i) => [s, i + 1]));

  const added = next.filter((s) => !prevPos.has(s));
  const removed = prev.filter((s) => !nextPos.has(s));
  const moved: SlotMove[] = [];
  for (const [slot, to] of nextPos) {
    const from = prevPos.get(slot);
    if (from !== undefined && from !== to) moved.push({ slot, from, to });
  }
  // Biggest jumps first — that's what a person scanning the log cares about.
  moved.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from) || a.slot - b.slot);
  return { added, removed, moved };
}

function slotLabel(slot: number): string {
  const t = getThreadBySlot(slot);
  return t ? `${t.name} (${slot})` : `slot ${slot}`;
}

/** One-line human summary of a diff, for the sheet and the page. */
export function summarize(diff: TreeDiff): string {
  const parts: string[] = [];
  if (diff.added.length) parts.push(`+${diff.added.map(slotLabel).join(", ")}`);
  if (diff.removed.length) parts.push(`−${diff.removed.map(slotLabel).join(", ")}`);
  if (diff.moved.length) {
    const shown = diff.moved
      .slice(0, 3)
      .map((m) => `${slotLabel(m.slot)} n${m.from}→n${m.to}`)
      .join(", ");
    const rest = diff.moved.length > 3 ? ` +${diff.moved.length - 3} more` : "";
    parts.push(`moved: ${shown}${rest}`);
  }
  return parts.join(" · ") || "No change";
}

export function isEmptyDiff(diff: TreeDiff): boolean {
  return diff.added.length === 0 && diff.removed.length === 0 && diff.moved.length === 0;
}

function parseSlots(raw: string): number[] {
  return (raw || "")
    .split(",")
    .map((t) => parseInt(t.trim(), 10))
    .filter((n) => Number.isInteger(n));
}

function rowToEntry(r: string[]): TreeLogEntry | null {
  const [recordedAt, window, signature, coverage, totalUses, summary, detail] = r;
  if (!recordedAt || !signature) return null;

  let diff: TreeDiff = { added: [], removed: [], moved: [] };
  let baseline = false;
  try {
    const parsed = JSON.parse(detail || "{}") as Partial<TreeDiff> & { baseline?: boolean };
    diff = {
      added: Array.isArray(parsed.added) ? parsed.added.map(Number).filter(Number.isInteger) : [],
      removed: Array.isArray(parsed.removed)
        ? parsed.removed.map(Number).filter(Number.isInteger)
        : [],
      moved: Array.isArray(parsed.moved)
        ? parsed.moved.filter(
            (m): m is SlotMove =>
              !!m && Number.isInteger(m.slot) && Number.isInteger(m.from) && Number.isInteger(m.to)
          )
        : [],
    };
    baseline = parsed.baseline === true;
  } catch {
    /* a hand-edited Detail cell degrades to "no detail", not a crash */
  }

  return {
    recordedAt,
    window: window || "",
    slots: parseSlots(signature),
    coverage: Number.parseFloat(coverage || "0") || 0,
    totalUses: Number.parseInt(totalUses || "0", 10) || 0,
    summary: summary || "",
    diff,
    baseline,
  };
}

/**
 * Drop consecutive entries with the same signature.
 *
 * Recording happens on page view, so two people opening the page at the same
 * second could both see "changed" and both append. Collapsing on read means a
 * race shows up as one entry instead of two identical ones.
 */
export function dedupeConsecutive(entries: TreeLogEntry[]): TreeLogEntry[] {
  const out: TreeLogEntry[] = [];
  let last = "";
  for (const e of entries) {
    const sig = signatureOf(e.slots);
    if (sig === last) continue;
    out.push(e);
    last = sig;
  }
  return out;
}

// ── Sheet I/O ──────────────────────────────────────────────────────────────

function requireSheetId(): string {
  const id = process.env.GOOGLE_SHEET_ID;
  if (!id) throw new Error("GOOGLE_SHEET_ID environment variable is required.");
  return id;
}

/** Every logged entry, OLDEST first. Empty when the tab doesn't exist yet. */
export async function readTreeLog(): Promise<TreeLogEntry[]> {
  const sheets = getSheetsClient();
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: requireSheetId(),
      range: RANGE,
    });
    const rows = (resp.data.values as string[][]) || [];
    const entries = rows.map(rowToEntry).filter((e): e is TreeLogEntry => e !== null);
    entries.sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
    return dedupeConsecutive(entries);
  } catch {
    return []; // tab missing — nothing recorded yet
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function ensureTab(sheets: any, spreadsheetId: string): Promise<void> {
  try {
    await sheets.spreadsheets.values.get({ spreadsheetId, range: `${TAB}!A1:G1` });
    return;
  } catch {
    /* create below */
  }
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { addSheet: { properties: { title: TAB, gridProperties: { frozenRowCount: 1 } } } },
      ],
    },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${TAB}!A1:G1`,
    valueInputOption: "RAW",
    requestBody: { values: [HEADER] },
  });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function entryToRow(e: TreeLogEntry): string[] {
  return [
    e.recordedAt,
    e.window,
    signatureOf(e.slots),
    e.coverage.toFixed(4),
    String(e.totalUses),
    e.summary,
    JSON.stringify({ ...e.diff, baseline: e.baseline }),
  ];
}

/**
 * Compare the tree to the last recorded one and append an entry if it moved.
 *
 * Called on page view. Returns the full history (oldest first) either way, so
 * the page gets its data from one call. Writes are best-effort: a failure here
 * must never take down the page, so it's swallowed and the caller just gets
 * whatever history already existed.
 */
export async function recordTreeIfChanged(
  tree: WebsterThreadTree
): Promise<{ history: TreeLogEntry[]; recorded: boolean; writeFailed: boolean }> {
  const slots = tree.threads.map((t) => t.slot);
  const history = await readTreeLog();

  // Nothing to compare against and nothing meaningful to record.
  if (!tree.hasData || slots.length === 0) {
    return { history, recorded: false, writeFailed: false };
  }

  const latest = history.length ? history[history.length - 1] : null;
  if (latest && signatureOf(latest.slots) === signatureOf(slots)) {
    return { history, recorded: false, writeFailed: false };
  }

  const diff = latest
    ? diffTrees(latest.slots, slots)
    : { added: [], removed: [], moved: [] as SlotMove[] };
  const entry: TreeLogEntry = {
    recordedAt: new Date().toISOString(),
    window: tree.windowLabel,
    slots,
    coverage: tree.covered,
    totalUses: tree.totalUses,
    summary: latest ? summarize(diff) : "Baseline recorded",
    diff,
    baseline: !latest,
  };

  try {
    const sheets = getSheetsClient();
    const spreadsheetId = requireSheetId();
    await ensureTab(sheets, spreadsheetId);
    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: `${TAB}!A2`,
      valueInputOption: "RAW",
      insertDataOption: "INSERT_ROWS",
      requestBody: { values: [entryToRow(entry)] },
    });
  } catch {
    return { history, recorded: false, writeFailed: true };
  }

  const next = [...history, entry];
  return {
    history: next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next,
    recorded: true,
    writeFailed: false,
  };
}
