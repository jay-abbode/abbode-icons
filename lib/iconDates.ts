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
 * of round trips per page load. Instead we ask a handful of icons which FOLDER
 * their PNG lives in, then list those folders once (1000 files per call) and
 * build an id -> createdTime map from the result. That's typically 3-5 calls
 * for the whole catalog. Icons whose PNG wasn't in a listed folder fall back to
 * individual lookups, hard-capped so a messy Drive can't stall the page.
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
  /** Icons with no date from either source. */
  undatedCount: number;
  /** True when the Drive lookup failed outright (permissions, quota, etc.). */
  driveFailed: boolean;
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

/** How many icons we ask "which folder are you in?" before listing. */
const PARENT_PROBES = 8;
/** Safety rails so a sprawling Drive can't hang a page render. */
const MAX_FOLDERS = 6;
const MAX_LIST_PAGES = 8;
const MAX_INDIVIDUAL_LOOKUPS = 40;

async function discoverParentFolders(fileIds: string[], drive: any): Promise<string[]> {
  const probes = fileIds.slice(0, PARENT_PROBES);
  const results = await Promise.all(
    probes.map(async (fileId) => {
      try {
        const r = await drive.files.get({ fileId, fields: "parents", supportsAllDrives: true });
        return (r.data.parents as string[] | undefined) ?? [];
      } catch {
        return [];
      }
    })
  );
  const seen: string[] = [];
  for (const parents of results) {
    for (const p of parents) if (p && !seen.includes(p)) seen.push(p);
  }
  return seen.slice(0, MAX_FOLDERS);
}

async function listFolderCreatedTimes(
  folderId: string,
  drive: any,
  out: Map<string, string>
): Promise<void> {
  let pageToken: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES; page++) {
    const r = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: "nextPageToken, files(id, createdTime)",
      pageSize: 1000,
      pageToken,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      corpora: "allDrives",
    });
    for (const f of (r.data.files as any[]) ?? []) {
      if (f.id && f.createdTime) out.set(f.id, String(f.createdTime).slice(0, 10));
    }
    pageToken = r.data.nextPageToken || undefined;
    if (!pageToken) return;
  }
}

/** fileId -> ISO creation date, for as many of `fileIds` as we can resolve. */
async function driveCreatedDates(fileIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (fileIds.length === 0) return out;

  const drive = getDriveClient();
  const folders = await discoverParentFolders(fileIds, drive);

  for (const folder of folders) {
    try {
      await listFolderCreatedTimes(folder, drive, out);
    } catch {
      // One unreadable folder shouldn't lose the others.
    }
  }

  // Stragglers: PNGs that live somewhere we didn't list. Capped — better to
  // leave a few icons undated than to make hundreds of serial calls.
  const missing = fileIds.filter((id) => !out.has(id)).slice(0, MAX_INDIVIDUAL_LOOKUPS);
  await Promise.all(
    missing.map(async (fileId) => {
      try {
        const r = await drive.files.get({
          fileId,
          fields: "createdTime",
          supportsAllDrives: true,
        });
        if (r.data.createdTime) out.set(fileId, String(r.data.createdTime).slice(0, 10));
      } catch {
        /* leave undated */
      }
    })
  );

  return out;
}

/* eslint-enable @typescript-eslint/no-explicit-any */

// ── Resolution + cache ─────────────────────────────────────────────────────

const CACHE_TTL_MS = 30 * 60 * 1000;
let cache: { index: IconAgeIndex; expiresAt: number } | null = null;

/**
 * Resolve an added-date for every icon we can. Cached 30 minutes.
 *
 * Never throws: if Drive is unavailable, the sheet dates still come through and
 * `driveFailed` is set so the UI can say so rather than quietly showing an
 * empty New Icons page.
 */
export async function getIconAgeIndex(
  icons: Icon[],
  options: { forceRefresh?: boolean } = {}
): Promise<IconAgeIndex> {
  if (!options.forceRefresh && cache && cache.expiresAt > Date.now()) return cache.index;

  const bySlug = new Map<string, IconAge>();
  const counts: Record<DateSource, number> = { sheet: 0, drive: 0 };

  // Pass 1 — the sheet column, which wins outright.
  const needDrive: Icon[] = [];
  for (const icon of icons) {
    if (icon.addedAt) {
      bySlug.set(icon.slug, { slug: icon.slug, addedAt: icon.addedAt, source: "sheet" });
      counts.sheet++;
    } else if (icon.pngFileId) {
      needDrive.push(icon);
    }
  }

  // Pass 2 — Drive, only for what's left.
  let driveFailed = false;
  if (needDrive.length > 0) {
    try {
      const ids = Array.from(new Set(needDrive.map((i) => i.pngFileId!).filter(Boolean)));
      const created = await driveCreatedDates(ids);
      for (const icon of needDrive) {
        const date = icon.pngFileId ? created.get(icon.pngFileId) : undefined;
        if (!date) continue;
        bySlug.set(icon.slug, { slug: icon.slug, addedAt: date, source: "drive" });
        counts.drive++;
      }
    } catch {
      driveFailed = true;
    }
  }

  const index: IconAgeIndex = {
    bySlug,
    counts,
    undatedCount: icons.length - bySlug.size,
    driveFailed,
  };
  cache = { index, expiresAt: Date.now() + CACHE_TTL_MS };
  return index;
}
