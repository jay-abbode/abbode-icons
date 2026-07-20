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
