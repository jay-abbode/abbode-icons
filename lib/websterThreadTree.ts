/**
 * Webster's standing thread tree — the loadout the floor threads by default.
 *
 * This is deliberately NOT the allocation solver. The solver (lib/threadAllocation)
 * answers "given this floor and these jobs, what should each of the 25 heads carry
 * right now". This answers the flatter, more durable question: across a full year
 * of real orders, which spools earn a permanent spot on a Barudan tree?
 *
 * Source is the COMPOSITE tab (icon colors + chosen text colors, already mapped to
 * the 24-spool Madeira palette by scripts/icon_order_stats), read through
 * lib/compositeStats. We take the 12-month window because a thread tree is a
 * standing decision — a 3-month window would chase seasonal noise and have you
 * re-threading for Valentine's pink every February.
 *
 * The count of threads on the tree is the fleet's needle count, read from
 * FLEET_BASES rather than hardcoded to 15 — if a Webster machine spec ever
 * changes, the tree follows it instead of drifting.
 */

import {
  getCompositeStats,
  WINDOW_LABELS,
  type CompositeSnapshot,
  type WindowKey,
} from "./compositeStats";
import { fleetBase } from "./threadAllocation";

/** A thread tree is a standing loadout, so it reads the widest window we keep. */
export const TREE_WINDOW: WindowKey = "12mo";

export type TreeThread = {
  /** 1-based needle position. Needle 1 carries the most-used color. */
  needle: number;
  slot: number;
  name: string;
  /** Madeira Polyneon 4-digit code. */
  code: string;
  hex: string;
  /** Uses contributed by icon designs. */
  icons: number;
  /** Uses contributed by chosen text colors. */
  text: number;
  total: number;
  /** Share of ALL palette uses in the window (0–1). */
  share: number;
};

export type WebsterThreadTree = {
  needleCount: number;
  window: WindowKey;
  windowLabel: string;
  /** Exactly `needleCount` threads (fewer only if the palette itself is smaller). */
  threads: TreeThread[];
  /** Threads that ranked below the cut — kept so the page can show what's left off. */
  benched: TreeThread[];
  /** Total thread uses across the whole palette in the window. */
  totalUses: number;
  /** Share of window uses covered by the threads on the tree (0–1). */
  covered: number;
  updatedAt: string | null;
  coverage: string;
  hasData: boolean;
};

/**
 * Pure derivation — snapshot in, tree out. Split from the fetch so it can be
 * unit-tested and reused for any fleet with a needle count.
 */
export function buildThreadTree(
  snapshot: CompositeSnapshot,
  needleCount: number,
  window: WindowKey = TREE_WINDOW
): WebsterThreadTree {
  const win = snapshot.windows[window];
  // compositeStats already sorts each window by total descending, but sort here
  // too so this stays correct if that guarantee ever moves.
  const ranked = [...win.colors].sort((a, b) => b.total - a.total || a.slot - b.slot);
  const totalUses = win.totalUses;

  const toThread = (
    c: CompositeSnapshot["windows"][WindowKey]["colors"][number],
    i: number
  ): TreeThread => ({
    needle: i + 1,
    slot: c.slot,
    name: c.name,
    code: c.code,
    hex: c.hex,
    icons: c.icons,
    text: c.text,
    total: c.total,
    share: totalUses > 0 ? c.total / totalUses : 0,
  });

  const threads = ranked.slice(0, needleCount).map(toThread);
  const benched = ranked.slice(needleCount).map((c, i) => toThread(c, needleCount + i));
  const onTree = threads.reduce((sum, t) => sum + t.total, 0);

  return {
    needleCount,
    window,
    windowLabel: WINDOW_LABELS[window],
    threads,
    benched,
    totalUses,
    covered: totalUses > 0 ? onTree / totalUses : 0,
    updatedAt: snapshot.updatedAt,
    coverage: snapshot.coverage,
    hasData: threads.some((t) => t.total > 0),
  };
}

/** Webster's tree, straight from the sheet. Server-only (hits the Sheets API). */
export async function getWebsterThreadTree(): Promise<WebsterThreadTree> {
  const snapshot = await getCompositeStats();
  return buildThreadTree(snapshot, fleetBase("webster").needleCount);
}
