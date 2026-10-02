/**
 * When was each icon added?
 *
 * The catalog sheet has no reliable "added" date for older rows, so this
 * resolves one from two sources, in priority order:
 *
 *   1. SHEET — the optional "Date Added" column in MASTER (lib/sheets reads it
 *      into `icon.addedAt`). Authoritative when present: a human or a script
 *      wrote it deliberately, and it survives files being re-uploaded.
 *   2. DRIVE — the creation time of the icon's PNG. Covers every row that
 *      predates the column, and is a fair proxy for "when this icon appeared",
 *      since the PNG is created as part of adding an icon.
 *
 * Sheet always wins, so once the column is populated for a row, re-uploading
 * its PNG can't make an old icon look new again.
 *
 * WHY THE DRIVE LOOKUP IS SHAPED LIKE THIS
 * ----------------------------------------
 * Asking Drive for one file at a time would be ~1 API call per icon — hundreds
 * of round trips per page load. Instead we ask Drive once for every image
 * created inside the longest window any page can show (MAX_WINDOW_DAYS), no
 * matter which folder it lives in, and build an id -> createdTime map from the
 * result. One or two calls for the whole catalog, and every icon gets a
 * definite answer: in the listing = dated, not in it = older than the horizon.
 *
 * The whole map is cached for 30 minutes — creation times never change, so
 * there's nothing to gain from asking more often.
 */

import { getDriveClient } from "./google";
import type { Icon } from "./sheets";

/** How far back "new" reaches. One knob, used by every surface. */
export const NEW_WINDOW_DAYS = 60;

export type DateSource = "sheet" | "drive";

export type IconAge = {
  slug: string;
  /** ISO date, YYYY-MM-DD. */
  addedAt: string;
  source: DateSource;
};

export type IconAgeIndex = {
  /** slug -> age, only for icons we could actually date. */
  bySlug: Map<string, IconAge>;
  /** How many icons got a date from each source. */
  counts: Record<DateSource, number>;
  /**
   * Icons whose PNG exists but was created before the horizon. Not "new" by
   * definition, so they carry no exact date — Drive is only asked for files
   * inside the horizon.
   */
  olderCount: number;
  /** Icons with no date from either source (no PNG, Drive failed, listing truncated). */
  undatedCount: number;
  /** How far back the Drive listing reached, in days. */
  horizonDays: number;
  /** True when the Drive lookup failed outright (permissions, quota, etc.). */
  driveFailed: boolean;
  /** True when the Drive listing hit its page cap and may be incomplete. */
  driveTruncated: boolean;
};

// ── Pure helpers (no I/O — unit tested) ────────────────────────────────────

/** Whole days between an ISO date and `now`. Negative for future dates. */
export function daysSince(isoDate: string, now: Date = new Date()): number {
  const then = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(then)) return Number.POSITIVE_INFINITY;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.floor((today - then) / 86_400_000);
}

export function isWithinWindow(
  isoDate: string,
  days: number = NEW_WINDOW_DAYS,
  now: Date = new Date()
): boolean {
  const d = daysSince(isoDate, now);
  // Future-dated cells (a typo, or a deliberate "landing next week") still count
  // as new rather than being silently dropped.
  return d <= days;
}

/** Icons added within the window, newest first. Pure — takes a resolved index. */
export function filterNewIcons(
  icons: Icon[],
  index: IconAgeIndex,
  days: number = NEW_WINDOW_DAYS,
  now: Date = new Date()
): Array<{ icon: Icon; age: IconAge }> {
  const out: Array<{ icon: Icon; age: IconAge }> = [];
  for (const icon of icons) {
    const age = index.bySlug.get(icon.slug);
    if (!age || !isWithinWindow(age.addedAt, days, now)) continue;
    out.push({ icon, age });
  }
  out.sort(
    (a, b) => b.age.addedAt.localeCompare(a.age.addedAt) || a.icon.name.localeCompare(b.icon.name)
  );
  return out;
}

/** Bucket new icons for display. Buckets are inclusive of their upper bound. */
export type AgeBucket = { label: string; maxDays: number; items: Array<{ icon: Icon; age: IconAge }> };

export function bucketByAge(
  entries: Array<{ icon: Icon; age: IconAge }>,
  now: Date = new Date()
): AgeBucket[] {
  const buckets: AgeBucket[] = [
    { label: "This week", maxDays: 7, items: [] },
    { label: "Last 30 days", maxDays: 30, items: [] },
    { label: "31–60 days", maxDays: Number.POSITIVE_INFINITY, items: [] },
  ];
  for (const e of entries) {
    const d = Math.max(0, daysSince(e.age.addedAt, now));
    const bucket = buckets.find((b) => d <= b.maxDays) ?? buckets[buckets.length - 1];
    bucket.items.push(e);
  }
  return buckets.filter((b) => b.items.length > 0);
}

// ── Drive lookup ───────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * Longest window any surface can ask for (/new caps ?days at this). The Drive
 * listing below only needs to reach this far back: anything created earlier
 * can never be "new", so we don't need its exact date at all.
 */
export const MAX_WINDOW_DAYS = 365;

/** 1000 files per page; 8 pages = 8000 recent PNGs before we give up. */
const MAX_LIST_PAGES = 8;

export type RecentFiles = {
  /** fileId -> ISO creation date, for every image created since the horizon. */
  created: Map<string, string>;
  /** True when the listing hit MAX_LIST_PAGES and may be missing files. */
  truncated: boolean;
};

/**
 * Every PNG the service account can see that was created on or after
 * `since`, as fileId -> ISO date.
 *
 * WHY A DATE QUERY AND NOT A FOLDER WALK
 * --------------------------------------
 * The previous version guessed which folders held the PNGs by asking the first
 * eight icons in the sheet where they lived, then listed those folders. That
 * broke the moment new icons landed in a folder none of those eight were in:
 * the whole batch fell through to a 40-file "straggler" cap and the rest came
 * out undated, so /new showed a handful of them or nothing. (Verified against
 * the live Drive on 2026-09-30: the first rows of MASTER live in one folder,
 * the Varsity Letters batch in another.)
 *
 * Asking Drive directly for "PNGs created since <horizon>" doesn't care
 * where a file lives. It returns only what can possibly be new — a few hundred
 * files, one or two pages — and the whole catalog gets a yes/no answer from
 * the same call: in the result = dated, not in the result = older than the
 * horizon. No per-icon round trips, no caps that quietly drop icons.
 */
async function listRecentImages(since: Date, drive: any): Promise<RecentFiles> {
  const created = new Map<string, string>();
  const sinceIso = since.toISOString();
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const r = await drive.files.list({
      q: `mimeType = 'image/png' and createdTime >= '${sinceIso}' and trashed = false`,
      fields: "nextPageToken, files(id, createdTime)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "allDrives",
    });
    for (const f of (r.data.files as any[]) ?? []) {
      if (f.id && f.createdTime) created.set(f.id, String(f.createdTime).slice(0, 10));
    }
    pageToken = r.data.nextPageToken || undefined;
    if (!pageToken) return { created, truncated: false };
  }
  return { created, truncated: true };
}

/* eslint-enable @typescript-eslint/no-explicit-any */

/** Midnight UTC `days` days ago — the oldest createdTime that can still be "new". */
export function horizonDate(days: number = MAX_WINDOW_DAYS, now: Date = new Date()): Date {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(today - days * 86_400_000);
}

// ── Resolution + cache ─────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000;
let cache: { index: IconAgeIndex; expiresAt: number } | null = null;

/**
 * Resolve an added-date for every icon we can. Cached 30 minutes.
 *
 * Pure over its inputs apart from the Drive call, so the same function is used
 * by the unit tests with a stubbed `recent` listing.
 *
 * Never throws: if Drive is unavailable, the sheet dates still come through and
 * `driveFailed` is set so the UI can say so rather than quietly showing an
 * empty New Icons page.
 */
export async function getIconAgeIndex(
  icons: Icon[],
  options: { forceRefresh?: boolean; now?: Date } = {}
): Promise<IconAgeIndex> {
  if (!options.forceRefresh && cache && cache.expiresAt > Date.now()) return cache.index;

  const now = options.now ?? new Date();
  let recent: RecentFiles | null = null;
  let driveFailed = false;
  if (icons.some((i) => !i.addedAt && i.pngFileId)) {
    try {
      recent = await listRecentImages(horizonDate(MAX_WINDOW_DAYS, now), getDriveClient());
    } catch {
      driveFailed = true;
    }
  }

  const index = buildIconAgeIndex(icons, recent, { driveFailed });
  cache = { index, expiresAt: Date.now() + CACHE_TTL_MS };
  return index;
}

/**
 * Combine the sheet column with a recent-files listing. Exported for tests.
 *
 *   - sheet date            -> dated (source "sheet"), wins outright
 *   - PNG in the listing    -> dated (source "drive")
 *   - PNG not in a complete listing -> older than the horizon: not new, counted
 *                              in `olderCount`, never in `bySlug`
 *   - PNG not in a TRUNCATED listing, Drive failed, or no PNG at all -> undated
 */
export function buildIconAgeIndex(
  icons: Icon[],
  recent: RecentFiles | null,
  flags: { driveFailed?: boolean } = {}
): IconAgeIndex {
  const bySlug = new Map<string, IconAge>();
  const counts: Record<DateSource, number> = { sheet: 0, drive: 0 };
  let olderCount = 0;
  let undatedCount = 0;
  // Only a complete listing lets us say "not in it, therefore old".
  const listingIsComplete = !!recent && !recent.truncated;

  for (const icon of icons) {
    if (icon.addedAt) {
      bySlug.set(icon.slug, { slug: icon.slug, addedAt: icon.addedAt, source: "sheet" });
      counts.sheet++;
      continue;
    }
    const date = icon.pngFileId && recent ? recent.created.get(icon.pngFileId) : undefined;
    if (date) {
      bySlug.set(icon.slug, { slug: icon.slug, addedAt: date, source: "drive" });
      counts.drive++;
    } else if (icon.pngFileId && listingIsComplete) {
      olderCount++;
    } else {
      undatedCount++;
    }
  }

  return {
    bySlug,
    counts,
    olderCount,
    undatedCount,
    horizonDays: MAX_WINDOW_DAYS,
    driveFailed: !!flags.driveFailed,
    driveTruncated: !!recent?.truncated,
  };
}
