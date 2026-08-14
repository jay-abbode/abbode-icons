import Link from "next/link";
import Header from "@/components/Header";
import IconGrid from "@/components/IconGrid";
import { getIconCatalog } from "@/lib/sheets";
import { getCommentCounts } from "@/lib/comments";
import {
  NEW_WINDOW_DAYS,
  bucketByAge,
  daysSince,
  filterNewIcons,
  getIconAgeIndex,
} from "@/lib/iconDates";

/**
 * /new — everything added to the catalog in the last 60 days.
 *
 * Dates come from lib/iconDates: the "Date Added" column in MASTER when it's
 * there, the Drive creation time of the icon's PNG when it isn't. Results are
 * grouped this-week / last-30 / 31-60 so the genuinely fresh stuff reads first
 * rather than being buried in two months of arrivals.
 *
 * ?days=N overrides the window (capped at a year) for the occasional "what
 * landed this quarter" question, without needing a second page.
 */
export const dynamic = "force-dynamic";

function parseDays(raw: string | undefined): number {
  const n = parseInt(raw ?? "", 10);
  if (!Number.isFinite(n) || n <= 0) return NEW_WINDOW_DAYS;
  return Math.min(n, 365);
}

export default async function NewIconsPage({
  searchParams,
}: {
  searchParams: { days?: string };
}) {
  const days = parseDays(searchParams.days);

  let catalog;
  try {
    catalog = await getIconCatalog();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return (
      <>
        <Header showSearch={false} />
        <main className="mx-auto max-w-3xl p-10">
          <h1 className="font-display text-3xl text-tomato">Failed to load catalog</h1>
          <pre className="mt-4 rounded-lg bg-pink-soft p-4 text-xs text-cherry">{message}</pre>
        </main>
      </>
    );
  }

  const [index, commentCounts] = await Promise.all([
    getIconAgeIndex(catalog.icons).catch(() => ({
      bySlug: new Map(),
      counts: { sheet: 0, drive: 0 },
      undatedCount: catalog.icons.length,
      driveFailed: true,
    })),
    getCommentCounts()
      .then((r) => r.counts)
      .catch(() => ({} as Record<string, number>)),
  ]);

  const entries = filterNewIcons(catalog.icons, index, days);
  const buckets = bucketByAge(entries);
  const datedCount = index.bySlug.size;

  return (
    <>
      <Header showSearch={false} />
      <main className="mx-auto max-w-6xl px-5 pb-24 pt-6 lg:px-8">
        <nav className="font-ui mb-6 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <Link href="/" className="transition-colors hover:text-espresso">
            Home
          </Link>
          <span>/</span>
          <span className="text-ink-soft">New Icons</span>
          <Link
            href="/assets"
            className="ml-auto font-medium transition-colors hover:text-espresso"
          >
            Download these →
          </Link>
        </nav>

        <header className="mb-6">
          <p className="font-ui text-[10px] font-semibold uppercase tracking-[0.16em] text-berry">
            Last {days} days
          </p>
          <h1 className="font-display mt-1 text-4xl font-medium tracking-tightest text-espresso md:text-5xl">
            New icons
          </h1>
          <p className="font-ui mt-1.5 text-sm text-ink-muted">
            {entries.length === 0
              ? `Nothing added in the last ${days} days.`
              : `${entries.length} icon${entries.length === 1 ? "" : "s"} added in the last ${days} days.`}
          </p>
        </header>

        {/* Window switcher */}
        <div
          className="mb-6 inline-flex rounded-full border border-parchment bg-white p-1"
          role="group"
          aria-label="Time window"
        >
          {[30, 60, 90].map((d) => (
            <Link
              key={d}
              href={d === NEW_WINDOW_DAYS ? "/new" : `/new?days=${d}`}
              className={`font-ui rounded-full px-4 py-1.5 text-xs font-semibold transition-colors focus-ring ${
                d === days ? "bg-berry text-porcelain" : "text-ink-soft hover:text-espresso"
              }`}
            >
              {d} days
            </Link>
          ))}
        </div>

        {/* Data-coverage note — without this an empty page is indistinguishable
            from a broken one. */}
        <p className="font-ui mb-6 text-[11px] leading-relaxed text-ink-muted">
          Dated {datedCount.toLocaleString()} of {catalog.icons.length.toLocaleString()} icons
          {index.counts.sheet > 0 && ` · ${index.counts.sheet.toLocaleString()} from the sheet`}
          {index.counts.drive > 0 && ` · ${index.counts.drive.toLocaleString()} from Drive`}
          {index.undatedCount > 0 &&
            ` · ${index.undatedCount.toLocaleString()} undated (these can't appear here)`}
          .{" "}
          {index.driveFailed
            ? "Drive lookup failed this time, so only icons with a Date Added value are shown."
            : "Add a \u201cDate Added\u201d column to MASTER to make this exact — it takes priority over the Drive fallback."}
        </p>

        {entries.length === 0 ? (
          <div className="rounded-2xl border border-cream-200 bg-cream-50 p-6">
            <h2 className="font-display text-lg text-espresso">Nothing new in this window</h2>
            <p className="font-ui mt-2 text-sm leading-relaxed text-ink-soft">
              Either nothing has been added recently, or the icons that were added don&rsquo;t have
              a resolvable date yet. Try a longer window above.
            </p>
          </div>
        ) : (
          <div className="space-y-10">
            {buckets.map((bucket) => (
              <section key={bucket.label}>
                <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b-2 border-berry/30 pb-1">
                  <h2 className="font-display text-xl text-espresso">{bucket.label}</h2>
                  <span className="font-ui text-xs text-ink-muted">
                    {bucket.items.length} icon{bucket.items.length === 1 ? "" : "s"}
                  </span>
                </div>

                {/* Dates as a readable line above the grid — IconGrid renders the
                    catalog card and shouldn't need to know about dates. */}
                <ul className="font-ui mb-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-muted">
                  {bucket.items.map(({ icon, age }) => (
                    <li key={icon.slug}>
                      <span className="text-ink-soft">{icon.name}</span>{" "}
                      <span className="tabular-nums">{relative(age.addedAt)}</span>
                      {age.source === "drive" && (
                        <span className="opacity-60" title="Date from Drive, not the sheet">
                          {" "}
                          ~
                        </span>
                      )}
                    </li>
                  ))}
                </ul>

                <IconGrid
                  icons={bucket.items.map((e) => e.icon)}
                  commentCounts={commentCounts}
                />
              </section>
            ))}
          </div>
        )}
      </main>
    </>
  );
}

function relative(isoDate: string): string {
  const d = Math.max(0, daysSince(isoDate));
  if (d === 0) return "today";
  if (d === 1) return "1 day ago";
  return `${d} days ago`;
}
