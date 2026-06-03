import { THREAD_PALETTE, getThreadBySlot, rgbToHex } from "./threadPalette";
import {
  getMultiColorRule,
  getAnchorRgb,
  getAccentForBase,
  type MultiColorRule,
} from "./multiColorRules";
import type { Icon } from "./sheets";

/**
 * Shared color-variation logic.
 *
 * Both the per-icon /variations page and the bulk Asset Downloads export need
 * to produce the exact same set of recolored previews with the exact same
 * download filenames. Keeping that in one place means the two can't drift
 * apart (e.g. a filename tweak on one but not the other).
 *
 * Everything here is pure (no Drive / googleapis), so it is safe to import
 * from client components. The `Icon` import is type-only and erased at build.
 */

export type Variant = {
  key: string;
  label: string;
  sublabel: string;
  swatchHex: string;
  /** URL on /api/image that renders this recolor. */
  src: string;
  /** Filename to save this variant as, e.g. "Matcha Aries.png". */
  downloadName: string;
};

/** Drop a leading "Abbode " from icon names used in download filenames. */
export function iconFileLabel(name: string): string {
  return name.replace(/^abbode\s+/i, "").trim();
}

/** Keep a label usable as a filename while preserving spaces. */
export function fileSafe(s: string): string {
  return s.replace(/[\/\\:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
}

export function buildVariants(icon: Icon, rule: MultiColorRule | null): Variant[] {
  if (!icon.pngFileId) return [];

  // Multi-color path with a rule
  if (icon.isMultiColor && rule) {
    const anchor = getAnchorRgb(rule);
    const anchorStr = anchor.join(",");

    if (rule.mode === "named") {
      return rule.variants.map((v, i) => {
        const baseThread = getThreadBySlot(v.base);
        const accentThread = getThreadBySlot(v.accent);
        const baseName = baseThread ? baseThread.name : `Slot ${v.base}`;
        const accentName = accentThread ? accentThread.name : `Slot ${v.accent}`;
        const swatchHex = baseThread ? rgbToHex(baseThread.rgb) : "#999999";
        return {
          key: `named-${i}`,
          label: v.label,
          sublabel: `${baseName} · ${accentName}`,
          swatchHex,
          src: `/api/image/${icon.pngFileId}?base=${v.base}&accent=${v.accent}&anchor=${anchorStr}`,
          downloadName: `${fileSafe(`${v.label} ${iconFileLabel(icon.name)}`)}.png`,
        };
      });
    }

    // all-24 mode
    return THREAD_PALETTE.map((thread) => {
      const accentSlot = getAccentForBase(rule, thread.slot);
      const accentThread = getThreadBySlot(accentSlot);
      const accentName = accentThread ? accentThread.name : `Slot ${accentSlot}`;
      return {
        key: `slot-${thread.slot}`,
        label: `${thread.slot} ${thread.name}`,
        sublabel: `with ${accentName}`,
        swatchHex: rgbToHex(thread.rgb),
        src: `/api/image/${icon.pngFileId}?base=${thread.slot}&accent=${accentSlot}&anchor=${anchorStr}`,
        downloadName: `${fileSafe(`${thread.name} ${iconFileLabel(icon.name)}`)}.png`,
      };
    });
  }

  // Single-color path (Col. Var. = YES)
  return THREAD_PALETTE.map((thread) => ({
    key: `slot-${thread.slot}`,
    label: `${thread.slot} ${thread.name}`,
    sublabel: `Madeira ${thread.code}`,
    swatchHex: rgbToHex(thread.rgb),
    src: `/api/image/${icon.pngFileId}?slot=${thread.slot}`,
    downloadName: `${fileSafe(`${thread.name} ${iconFileLabel(icon.name)}`)}.png`,
  }));
}

/**
 * Variants to include in a bulk export for one icon. Returns [] for anything
 * that shouldn't contribute variation PNGs:
 *   - icons without the color-variation indicator,
 *   - multi-color icons that don't have a colorway rule configured yet
 *     (we don't invent variants for those; they just ship their default PNG).
 */
export function buildExportVariants(icon: Icon): Variant[] {
  if (!icon.hasColorVariation || !icon.pngFileId) return [];
  const rule = icon.isMultiColor ? getMultiColorRule(icon.name) : null;
  if (icon.isMultiColor && !rule) return [];
  return buildVariants(icon, rule);
}
