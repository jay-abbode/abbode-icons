/**
 * Catalog-wide thread color usage stats. Used by the header dropdown,
 * the downloadable PDF reference sheet, and any other view that needs to
 * know how often each Madeira spool is referenced in the icon catalog.
 *
 * Computed by tallying every slot in every icon's `threadSlots` field.
 * Returns an entry for every spool in THREAD_PALETTE (24 entries) — slots
 * with zero usage are included so the dropdown / reference sheet has a
 * complete inventory rather than just the used ones.
 *
 * Sorted by usage descending so the most-used color is first.
 */

import { getIconCatalog } from "./sheets";
import { THREAD_PALETTE, rgbToHex } from "./threadPalette";

export type ColorStat = {
  slot: number;
  name: string;
  /** Madeira product code, e.g. "1801" for slot 35 White. */
  code: string;
  /** Hex string with leading "#" — for swatches in HTML / CSS / PDF. */
  hex: string;
  /** Number of icons in the catalog that include this thread. */
  count: number;
};

export async function getColorStats(): Promise<ColorStat[]> {
  const catalog = await getIconCatalog();
  const counts = new Map<number, number>();
  for (const icon of catalog.icons) {
    for (const slot of icon.threadSlots) {
      counts.set(slot, (counts.get(slot) || 0) + 1);
    }
  }
  return THREAD_PALETTE.map((thread) => ({
    slot: thread.slot,
    name: thread.name,
    code: thread.code,
    hex: rgbToHex(thread.rgb),
    count: counts.get(thread.slot) || 0,
  })).sort((a, b) => b.count - a.count);
}

/** One category's color usage: how many icons in the category use each thread. */
export type CategoryColorBreakdown = {
  category: string;
  iconCount: number;
  colors: Array<{ slot: number; name: string; hex: string; count: number }>;
};

/** Everything the downloadable color-data report needs, from one catalog read. */
export type ColorDataReport = {
  totalIcons: number;
  totalUses: number;
  /** All 24 spools sorted by usage descending. */
  colors: ColorStat[];
  /** Per-category breakdown, categories sorted alphabetically. */
  categories: CategoryColorBreakdown[];
};

export async function getColorDataReport(): Promise<ColorDataReport> {
  const catalog = await getIconCatalog();
  const paletteBySlot = new Map(THREAD_PALETTE.map((t) => [t.slot, t]));

  const overall = new Map<number, number>();
  // Tally icon counts + per-slot usage keyed by category name. We still have
  // to walk the icons to build the tallies, but the set and ORDER of
  // categories in the report comes from catalog.categories below — the same
  // canonical list the browse sidebar uses — rather than anything we derive
  // or re-sort here.
  const tally = new Map<string, { iconCount: number; slots: Map<number, number> }>();

  for (const icon of catalog.icons) {
    let entry = tally.get(icon.category);
    if (!entry) {
      entry = { iconCount: 0, slots: new Map() };
      tally.set(icon.category, entry);
    }
    entry.iconCount++;
    for (const slot of icon.threadSlots) {
      overall.set(slot, (overall.get(slot) || 0) + 1);
      entry.slots.set(slot, (entry.slots.get(slot) || 0) + 1);
    }
  }

  const colors: ColorStat[] = THREAD_PALETTE.map((thread) => ({
    slot: thread.slot,
    name: thread.name,
    code: thread.code,
    hex: rgbToHex(thread.rgb),
    count: overall.get(thread.slot) || 0,
  })).sort((a, b) => b.count - a.count);

  const categories: CategoryColorBreakdown[] = catalog.categories.map(
    (category) => {
      const entry = tally.get(category);
      return {
        category,
        iconCount: entry?.iconCount ?? 0,
        colors: entry
          ? Array.from(entry.slots.entries())
              .map(([slot, count]) => {
                const t = paletteBySlot.get(slot);
                return {
                  slot,
                  name: t?.name ?? `Slot ${slot}`,
                  hex: t ? rgbToHex(t.rgb) : "#CCCCCC",
                  count,
                };
              })
              .sort((a, b) => b.count - a.count)
          : [],
      };
    },
  );

  const totalUses = colors.reduce((sum, c) => sum + c.count, 0);

  return {
    totalIcons: catalog.icons.length,
    totalUses,
    colors,
    categories,
  };
}
