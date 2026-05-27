/**
 * Per-design multi-color variant rules.
 *
 * Each rule is keyed by a name matcher (prefix or exact) so the Col. Var.
 * column in the sheet can stay as "YES/MC" without per-row colorway config —
 * design intent lives here in code where it can be reviewed and versioned.
 *
 * Two modes:
 *   - "all-24": render the design in every Madeira color as the base, with
 *     the accent staying constant (with optional per-base overrides so
 *     e.g. a white base doesn't get white accent stitches and disappear).
 *   - "named": render a small fixed list of curated colorways, each with
 *     its own label.
 *
 * The classifier needs an anchor RGB to decide which of the two k-means
 * cluster centers in the source image is "base" vs "accent". For "named"
 * rules we derive it from the first variant's base slot (the "Default"
 * colorway is intended to roughly match the source PNG colors). For
 * "all-24" rules we store the anchor explicitly since none of the 24 base
 * slots is privileged.
 */

import { getThreadBySlot } from "./threadPalette";

export type NamedVariant = {
  /** Short label shown under the variant on the variations page. */
  label: string;
  /** Madeira slot number for the larger region in the design. */
  base: number;
  /** Madeira slot number for the smaller/accent region. */
  accent: number;
};

export type MultiColorRule =
  | {
      mode: "all-24";
      /** RGB of the source PNG's base region, used to seed the classifier. */
      anchorBaseRgb: readonly [number, number, number];
      /** Default accent slot used for every base. */
      defaultAccent: number;
      /**
       * Per-base accent overrides. Use when a base slot would be too close
       * to the default accent (e.g. base = white, accent = white).
       */
      accentOverrides?: Readonly<Record<number, number>>;
    }
  | {
      mode: "named";
      variants: readonly NamedVariant[];
    };

interface RuleMatcher {
  /** Returns true when this rule applies to the given icon name. */
  test: (name: string) => boolean;
  rule: MultiColorRule;
}

const RULES: readonly RuleMatcher[] = [
  // Bandana letters/icons — every name starting with "Bandana " (so the
  // alphabet plus any future bandana motifs all match).
  {
    test: (n) => /^bandana\b/i.test(n.trim()),
    rule: {
      mode: "all-24",
      // Source bandana red sampled from Bandana A
      anchorBaseRgb: [180, 40, 50],
      // White pattern by default
      defaultAccent: 35,
      // When base would clash with white (or other near-white tones), swap
      // the accent for something with visible contrast against the base.
      accentOverrides: {
        6: 4,   // Peach base → Rust Orange accent
        8: 7,   // Yellow base → Dark Yellow accent
        28: 27, // Light Pink base → Dusty Pink accent
        30: 31, // Milk Chocolate base → Dark Chocolate accent
        32: 34, // Silver base → Charcoal accent
        35: 36, // White base → Black accent
        36: 35, // Black base → White accent (no-op; kept for clarity)
      },
    },
  },

  // Cowboy Boot — three curated colorways
  {
    test: (n) => /^cowboy boot$/i.test(n.trim()),
    rule: {
      mode: "named",
      variants: [
        { label: "Default", base: 29, accent: 30 }, // Tan + Milk Chocolate
        { label: "Pink",    base: 28, accent: 27 }, // Light Pink + Dusty Pink
        { label: "Blue",    base: 17, accent: 20 }, // Cool Periwinkle + Navy
      ],
    },
  },

  // Heart Dice — two curated colorways
  {
    test: (n) => /^heart dice$/i.test(n.trim()),
    rule: {
      mode: "named",
      variants: [
        { label: "Default",       base: 27, accent: 1 },  // Dusty Pink + Dark Red
        { label: "Black & White", base: 35, accent: 36 }, // White + Black
      ],
    },
  },

  // Tic Tac Toe — red hearts stay, the grid/X swaps between black and white
  {
    test: (n) => /^tic[- ]?tac[- ]?toe$/i.test(n.trim()),
    rule: {
      mode: "named",
      variants: [
        { label: "Black + Red", base: 36, accent: 1 }, // Black grid, Dark Red hearts
        { label: "White + Red", base: 35, accent: 1 }, // White grid, Dark Red hearts
      ],
    },
  },

  // Bikini Polka Dot — all 24 base colors, dots always white
  {
    test: (n) => /^bikini polka dot$/i.test(n.trim()),
    rule: {
      mode: "all-24",
      anchorBaseRgb: [152, 42, 49], // Slot 1 Dark Red (matches source red)
      defaultAccent: 35,             // White dots, no overrides
    },
  },
];

/** Returns the matching rule for this icon name, or null if none configured. */
export function getMultiColorRule(name: string): MultiColorRule | null {
  for (const { test, rule } of RULES) {
    if (test(name)) return rule;
  }
  return null;
}

/** Anchor RGB used to seed the k-means classifier's base-vs-accent decision. */
export function getAnchorRgb(
  rule: MultiColorRule,
): readonly [number, number, number] {
  if (rule.mode === "all-24") return rule.anchorBaseRgb;
  const firstBase = rule.variants[0].base;
  const thread = getThreadBySlot(firstBase);
  // Fallback to a generic red anchor if the slot is unrecognized; should
  // never happen for a properly-configured rule.
  return thread ? thread.rgb : [180, 40, 50];
}

/** Resolve the accent slot for a given base in an all-24 rule. */
export function getAccentForBase(rule: MultiColorRule, base: number): number {
  if (rule.mode !== "all-24") {
    throw new Error("getAccentForBase is only valid for all-24 rules");
  }
  return rule.accentOverrides?.[base] ?? rule.defaultAccent;
}
