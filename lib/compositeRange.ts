/**
 * Pure range aggregation + comparison over the daily composite data.
 *
 * CLIENT-SAFE: no server-only imports (no ./google, no googleapis) — this is
 * used inside the "use client" chart component. Keep it that way.
 */

import { THREAD_PALETTE, rgbToHex } from "./threadPalette";

/** [slot, icons, text] — compact tuple as serialized from the server. */
export type DailySlotTuple = [number, number, number];

export type DailyDay = {
  /** YYYY-MM-DD (UTC order date). */
  date: string;
  slots: DailySlotTuple[];
};

export type RangeColor = {
  slot: number;
  name: string;
  code: string;
  hex: string;
  icons: number;
  text: number;
  total: number;
  /** 1-based rank after sorting by total desc (ties broken by slot asc). */
  rank: number;
};

export const TOP_N = 15;

// ---------------------------------------------------------------------------
// Range presets
// ---------------------------------------------------------------------------

export type PresetKey =
  | "1d" | "1w" | "1m" | "3m" | "6m" | "9m" | "12m" | "custom";

export const PRESET_ORDER: Exclude<PresetKey, "custom">[] = [
  "1d", "1w", "1m", "3m", "6m", "9m", "12m",
];

export const PRESET_LABELS: Record<PresetKey, string> = {
  "1d": "1 day",
  "1w": "1 week",
  "1m": "1 month",
  "3m": "3 months",
  "6m": "6 months",
  "9m": "9 months",
  "12m": "12 months",
  custom: "Custom",
};

/** Days spanned by each preset, matching the stats script's 30.5-day months. */
export const PRESET_DAYS: Record<Exclude<PresetKey, "custom">, number> = {
  "1d": 1,
  "1w": 7,
  "1m": 30,
  "3m": 91,
  "6m": 183,
  "9m": 274,
  "12m": 365,
};

export type DateRange = { start: string; end: string };

/** YYYY-MM-DD +/- n days, in UTC (no DST surprises). */
export function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve a preset to concrete dates, anchored at the latest data date so
 * "1 day" always shows the most recent day with orders even if the cron
 * hasn't run yet today.
 */
export function presetRange(
  key: Exclude<PresetKey, "custom">,
  anchorEnd: string
): DateRange {
  const span = PRESET_DAYS[key];
  return { start: shiftDate(anchorEnd, -(span - 1)), end: anchorEnd };
}

export function formatRange(r: DateRange): string {
  return r.start === r.end ? r.start : `${r.start} → ${r.end}`;
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

/**
 * Sum icons/text per slot across all days in [start, end] (inclusive) and
 * return ALL 24 spools ranked by total desc. Zero-usage spools are included
 * so the chart always shows the full menu.
 */
export function aggregateRange(days: DailyDay[], range: DateRange): RangeColor[] {
  const sums = new Map<number, { icons: number; text: number }>();
  for (const day of days) {
    if (day.date < range.start || day.date > range.end) continue;
    for (const [slot, icons, text] of day.slots) {
      const s = sums.get(slot) || { icons: 0, text: 0 };
      s.icons += icons;
      s.text += text;
      sums.set(slot, s);
    }
  }

  const out: RangeColor[] = THREAD_PALETTE.map((t) => {
    const s = sums.get(t.slot) || { icons: 0, text: 0 };
    return {
      slot: t.slot,
      name: t.name,
      code: t.code,
      hex: rgbToHex(t.rgb),
      icons: s.icons,
      text: s.text,
      total: s.icons + s.text,
      rank: 0,
    };
  });

  out.sort((a, b) => b.total - a.total || a.slot - b.slot);
  out.forEach((c, i) => (c.rank = i + 1));
  return out;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

export type RankMove = {
  slot: number;
  name: string;
  code: string;
  hex: string;
  /** Rank in range A (null = outside top 15 there). */
  rankA: number | null;
  rankB: number | null;
  totalA: number;
  totalB: number;
  /** rankA - rankB when both in top 15 (positive = climbed). */
  delta: number;
};

export type RangeComparison = {
  /** In B's top 15 but not A's. */
  entered: RankMove[];
  /** In A's top 15 but not B's. */
  left: RankMove[];
  /** In both top 15s, better rank in B. */
  rose: RankMove[];
  /** In both top 15s, worse rank in B. */
  fell: RankMove[];
  /** In both top 15s, same rank. */
  steady: RankMove[];
};

export function compareRanges(
  rankedA: RangeColor[],
  rankedB: RangeColor[],
  topN: number = TOP_N
): RangeComparison {
  const aBySlot = new Map(rankedA.map((c) => [c.slot, c]));
  const bBySlot = new Map(rankedB.map((c) => [c.slot, c]));
  const aTop = new Set(rankedA.slice(0, topN).map((c) => c.slot));
  const bTop = new Set(rankedB.slice(0, topN).map((c) => c.slot));

  const move = (slot: number): RankMove => {
    const a = aBySlot.get(slot)!;
    const b = bBySlot.get(slot)!;
    const inA = aTop.has(slot);
    const inB = bTop.has(slot);
    return {
      slot,
      name: a.name,
      code: a.code,
      hex: a.hex,
      rankA: inA ? a.rank : null,
      rankB: inB ? b.rank : null,
      totalA: a.total,
      totalB: b.total,
      delta: inA && inB ? a.rank - b.rank : 0,
    };
  };

  const entered: RankMove[] = [];
  const left: RankMove[] = [];
  const rose: RankMove[] = [];
  const fell: RankMove[] = [];
  const steady: RankMove[] = [];

  for (const slot of Array.from(bTop)) {
    if (!aTop.has(slot)) entered.push(move(slot));
  }
  for (const slot of Array.from(aTop)) {
    if (!bTop.has(slot)) left.push(move(slot));
  }
  for (const slot of Array.from(aTop)) {
    if (!bTop.has(slot)) continue;
    const m = move(slot);
    if (m.delta > 0) rose.push(m);
    else if (m.delta < 0) fell.push(m);
    else steady.push(m);
  }

  entered.sort((a, b) => (a.rankB ?? 99) - (b.rankB ?? 99));
  left.sort((a, b) => (a.rankA ?? 99) - (b.rankA ?? 99));
  rose.sort((a, b) => b.delta - a.delta || (a.rankB ?? 99) - (b.rankB ?? 99));
  fell.sort((a, b) => a.delta - b.delta || (a.rankB ?? 99) - (b.rankB ?? 99));
  steady.sort((a, b) => (a.rankB ?? 99) - (b.rankB ?? 99));

  return { entered, left, rose, fell, steady };
}
