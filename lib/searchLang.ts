import type { Icon } from "./sheets";

/**
 * Search language for the browse page: turns a free-text query into
 *   (a) color FAMILIES  — color words mapped to groups of thread slots, and
 *   (b) text TOKENS     — everything else, fuzzy-matched against icon names,
 *                         categories, old names, and theme tags.
 *
 * Color semantics mirror the Filters button: an icon matches when its design's
 * actual thread slots include at least one slot from EVERY named family
 * (AND across families, OR within a family). So "red, green, and blue" finds
 * designs stitched with a red AND a green AND a blue.
 *
 * Everything here is pure — safe to use server-side in the browse page.
 */

// ---------------------------------------------------------------------------
// Color vocabulary
// ---------------------------------------------------------------------------

export type ColorFamily = { word: string; slots: number[] };

/** Two-word color phrases, matched before single words (exact slots). */
const COLOR_PHRASES: Array<[string, number[]]> = [
  ["light blue", [17]],
  ["baby blue", [17]],
  ["sky blue", [17]],
  ["royal blue", [19]],
  ["navy blue", [20]],
  ["dark green", [12]],
  ["forest green", [12]],
  ["dark yellow", [7]],
  ["light pink", [28]],
  ["baby pink", [28]],
  ["hot pink", [27]],
  ["dusty pink", [27]],
  ["milk chocolate", [30]],
  ["dark chocolate", [31]],
  ["off white", [37]],
];

/** Single color words → thread-slot families (generous, "fuzzy" groupings). */
const COLOR_WORDS: Record<string, number[]> = {
  red: [1, 0, 4],
  burgundy: [0],
  maroon: [0],
  wine: [0],
  crimson: [1, 0],
  rust: [4],
  orange: [5, 4, 6],
  peach: [6],
  coral: [6, 27],
  yellow: [8, 7],
  gold: [7, 8],
  mustard: [7],
  green: [10, 12, 13],
  olive: [10],
  sage: [13, 10],
  matcha: [13],
  forest: [12],
  emerald: [12],
  blue: [17, 19, 20],
  navy: [20],
  royal: [19],
  periwinkle: [17],
  teal: [17],
  aqua: [17],
  turquoise: [17],
  purple: [21],
  violet: [21],
  lavender: [21],
  lilac: [21],
  plum: [21],
  pink: [27, 28],
  blush: [28, 27],
  rose: [27, 28],
  magenta: [27],
  fuchsia: [27],
  tan: [29],
  beige: [29],
  khaki: [29],
  sand: [29],
  camel: [29],
  brown: [30, 31, 29],
  chocolate: [30, 31],
  mocha: [30],
  espresso: [31],
  gray: [32, 34],
  grey: [32, 34],
  silver: [32],
  charcoal: [34],
  white: [35, 37],
  cream: [37],
  ivory: [37],
  tusk: [37],
  black: [36],
};

const STOPWORDS = new Set([
  "and", "or", "the", "a", "an", "of", "in", "with", "for", "to", "s",
  "icon", "icons", "color", "colors", "colour", "colours",
]);

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

export type ParsedQuery = {
  /** Color families pulled out of the query (deduped by word). */
  families: ColorFamily[];
  /** Remaining text tokens to fuzzy-match. */
  tokens: string[];
};

export function parseSearchQuery(raw: string): ParsedQuery {
  const words = (raw || "")
    .toLowerCase()
    // Collapse apostrophes so possessives match: "father's day" -> "fathers day".
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((w) => w && !STOPWORDS.has(w));

  const families: ColorFamily[] = [];
  const tokens: string[] = [];
  const seen = new Set<string>();

  const addFamily = (word: string, slots: number[]) => {
    if (!seen.has(word)) {
      seen.add(word);
      families.push({ word, slots });
    }
  };

  let i = 0;
  while (i < words.length) {
    // Two-word color phrases first ("light blue", "dark chocolate", …).
    if (i + 1 < words.length) {
      const pair = `${words[i]} ${words[i + 1]}`;
      const phrase = COLOR_PHRASES.find(([p]) => p === pair);
      if (phrase) {
        addFamily(pair, phrase[1]);
        i += 2;
        continue;
      }
    }
    const w = words[i];
    if (COLOR_WORDS[w]) {
      addFamily(w, COLOR_WORDS[w]);
    } else {
      tokens.push(w);
    }
    i++;
  }

  return { families, tokens };
}

/** True when the design's slots include at least one from every family. */
export function familiesMatch(threadSlots: number[], families: ColorFamily[]): boolean {
  return families.every((f) => f.slots.some((s) => threadSlots.includes(s)));
}

// ---------------------------------------------------------------------------
// Fuzzy text scoring
// ---------------------------------------------------------------------------

export type SearchDoc = {
  /** Lowercased full name, for whole-phrase bonuses. */
  nameFull: string;
  nameWords: string[];
  tagWords: string[];
  categoryWords: string[];
  oldNameWords: string[];
  /** Words from the icon's visual description (VISUAL_INDEX tab), if any. */
  visualWords: string[];
};

function splitWords(s: string | null | undefined): string[] {
  return (s || "")
    .toLowerCase()
    // Match parseSearchQuery: "Ralph's" indexes as "ralphs".
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function buildSearchDoc(
  icon: Pick<Icon, "name" | "category" | "oldName" | "tags">,
  visualDesc?: string | null
): SearchDoc {
  return {
    nameFull: icon.name.toLowerCase(),
    nameWords: splitWords(icon.name),
    tagWords: icon.tags.flatMap((t) => splitWords(t)),
    categoryWords: splitWords(icon.category),
    oldNameWords: splitWords(icon.oldName),
    visualWords: splitWords(visualDesc),
  };
}

/** Max edit distance allowed for a token of this length (typo tolerance). */
function maxDist(len: number): number {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

/** Levenshtein distance with an early-exit cap. */
function editDistance(a: string, b: string, cap: number): number {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
      if (curr[j] < rowMin) rowMin = curr[j];
    }
    if (rowMin > cap) return cap + 1;
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Score one token against one word. 0 = no match. */
function wordScore(token: string, word: string): number {
  if (word === token) return 100;
  if (token.length >= 2 && word.startsWith(token)) return 70;
  if (token.length >= 3 && word.includes(token)) return 45;
  const cap = maxDist(token.length);
  if (cap > 0 && editDistance(token, word, cap) <= cap) return 40;
  return 0;
}

const FIELD_WEIGHTS: Array<[keyof Omit<SearchDoc, "nameFull">, number]> = [
  ["nameWords", 3],
  ["tagWords", 2],
  ["categoryWords", 1.6],
  ["oldNameWords", 1.2],
  // Visual-description words rank LAST. They let a query like "stripes" or
  // "wood" find an icon by how it actually looks even when the name, tags, and
  // category don't say so — but the low weight means a visual-only hit never
  // outranks a real name or tag match.
  ["visualWords", 0.8],
];

/**
 * Score a doc against tokens. Every token must match somewhere (AND), else 0.
 * Name matches weigh heaviest, then tags, category, old name. A whole-phrase
 * hit on the name gets a large bonus so exact name searches rank first.
 */
export function scoreDoc(doc: SearchDoc, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const [field, weight] of FIELD_WEIGHTS) {
      for (const word of doc[field]) {
        const s = wordScore(token, word) * weight;
        if (s > best) best = s;
        if (best >= 100 * weight) break; // can't beat exact in this field
      }
    }
    if (best === 0) return 0;
    total += best;
  }
  const phrase = tokens.join(" ");
  if (doc.nameFull === phrase) total += 800;
  else if (doc.nameFull.includes(phrase)) total += 400;
  return total;
}

/** Name-only score, used so pure-color queries still surface icons NAMED
 *  after that color (e.g. "olive" → the Olive icon, "peach" → Peach). */
export function nameScore(doc: SearchDoc, tokens: string[]): number {
  if (tokens.length === 0) return 0;
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const word of doc.nameWords) {
      const s = wordScore(token, word);
      if (s > best) best = s;
    }
    if (best === 0) return 0;
    total += best;
  }
  return total;
}
