/**
 * Pure, client-safe category helpers.
 *
 * Deliberately imports nothing server-only (no googleapis, no "./google"), so
 * this can be used from both server components (sheets.ts, app/page.tsx) and
 * "use client" components (FilterControls, AssetDownloader, ContactSheetGenerator)
 * without dragging server code into the browser bundle.
 *
 * The category list the app shows is derived live from the sheet's Category
 * column. Everything about "Premade Designs" being special — its name, its
 * position at the bottom of the list, and how the UI can spot it — lives here
 * so it's defined once and easy to change.
 */

/** The catalog category that holds fixed-size, ready-made designs. */
export const PREMADE_CATEGORY = "Premade Designs";

/**
 * Categories floated to the very bottom of every category list, in this order.
 * Everything else stays alphabetical above them.
 */
const PINNED_TO_BOTTOM = [PREMADE_CATEGORY];

/** Case- and whitespace-insensitive canonical form for comparison. */
const canon = (s: string): string => (s || "").trim().toLowerCase();

const PINNED_CANON = PINNED_TO_BOTTOM.map(canon);

/**
 * True when a category name is the Premade Designs bucket. Tolerant of casing
 * and stray spaces so a sheet entry of "premade designs" or "Premade  Designs"
 * still matches.
 */
export function isPremadeCategory(name: string): boolean {
  return canon(name) === canon(PREMADE_CATEGORY);
}

/**
 * Order categories for display: alphabetical, then the pinned categories
 * appended at the end in PINNED_TO_BOTTOM order. Matching is case/space
 * insensitive, but the original spelling from the sheet is preserved in the
 * returned list. Categories not present in the input are simply absent, so this
 * is safe to call before any premade exists (nothing gets pinned).
 */
export function orderCategories(names: string[]): string[] {
  const isPinned = (n: string): boolean => PINNED_CANON.includes(canon(n));

  const normal = names
    .filter((n) => !isPinned(n))
    .sort((a, b) => a.localeCompare(b));

  const pinned = names
    .filter(isPinned)
    .sort((a, b) => PINNED_CANON.indexOf(canon(a)) - PINNED_CANON.indexOf(canon(b)));

  return [...normal, ...pinned];
}

// ---------- Alphabets ----------
//
// A lettering set (Varsity Letters, Plaid Letters, Bandana, Yacht Flags …) is
// an ordinary category in the sheet, but every design in it is one character:
// "Varsity 0 - Black", "Blue Plaid A", "Bandana A", "Yacht Flag B". The app
// recognizes those categories from that shape, so nothing has to be marked in
// the sheet and a new set is picked up as soon as its rows exist.

/** Share of a category's designs that must be single-character names. */
const ALPHABET_MIN_SHARE = 0.8;
/** Distinct characters a category must cover to count on shape alone. */
const ALPHABET_MIN_CHARS = 5;

/**
 * The character a design represents — the name's only one-character word
 * (A–Z or 0–9) — or null when the name has none, or more than one.
 *   "Varsity 0 - Black" -> "0"    "Blue Plaid A" -> "A"    "Vitamin C" -> "C"
 *   "Red Rose" -> null            "A to Z" -> null
 */
export function alphabetCharOf(name: string): string | null {
  const singles = (name || "")
    .split(/[^A-Za-z0-9]+/)
    .filter((t) => t.length === 1);
  return singles.length === 1 ? singles[0].toUpperCase() : null;
}

/**
 * Which categories are alphabets. A category qualifies when at least 80% of
 * its designs are single-character names AND it either spans 5+ different
 * characters, or its own name says so ("… Letters", "… Alphabet") — the name
 * covers a set that's only partly loaded. One stray "Vitamin C" in Food never
 * comes close: on the live catalog alphabets score 93–100% and nothing else
 * passes 42%.
 */
export function detectAlphabetCategories(
  icons: ReadonlyArray<{ name: string; category: string }>
): Set<string> {
  const stats = new Map<string, { total: number; chars: Set<string>; hits: number }>();
  for (const icon of icons) {
    if (!icon.category) continue;
    let s = stats.get(icon.category);
    if (!s) {
      s = { total: 0, chars: new Set(), hits: 0 };
      stats.set(icon.category, s);
    }
    s.total++;
    const ch = alphabetCharOf(icon.name);
    if (ch) {
      s.hits++;
      s.chars.add(ch);
    }
  }

  const out = new Set<string>();
  for (const [category, s] of stats) {
    if (s.hits / s.total < ALPHABET_MIN_SHARE) continue;
    const namedAsAlphabet = /\b(letters?|alphabets?)\s*$/i.test(category.trim());
    if (s.chars.size >= ALPHABET_MIN_CHARS || namedAsAlphabet) out.add(category);
  }
  return out;
}

/**
 * The design that represents an alphabet on its tile: its letter "A". When a
 * set has several A's (one per colourway) an active one wins, then the first
 * by name, so the pick is stable. A set with no "A" (or none with artwork yet)
 * falls back to its first design that has artwork, then to its first design.
 */
export function pickAlphabetCover<
  T extends { name: string; status: string; pngFileId: string | null }
>(designs: ReadonlyArray<T>): T | undefined {
  const isLive = (d: T) => {
    const s = (d.status || "").toUpperCase();
    return s !== "DRAFT" && s !== "ARCHIVED";
  };
  const ranked = [...designs].sort(
    (a, b) =>
      Number(isLive(b)) - Number(isLive(a)) || a.name.localeCompare(b.name)
  );
  const withArt = ranked.filter((d) => d.pngFileId);
  return (
    withArt.find((d) => alphabetCharOf(d.name) === "A") ?? withArt[0] ?? ranked[0]
  );
}
