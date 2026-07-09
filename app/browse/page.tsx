import Link from "next/link";
import { getIconCatalog, type Icon } from "@/lib/sheets";
import { getCommentCounts } from "@/lib/comments";
import { getIconOrderCounts, normIconName } from "@/lib/orderStats";
import { getThreadBySlot, rgbToHex } from "@/lib/threadPalette";
import { loadVisualDescriptions } from "@/lib/visualIndex";
import {
  parseSearchQuery,
  familiesMatch,
  buildSearchDoc,
  scoreDoc,
  nameScore,
} from "@/lib/searchLang";
import Header from "@/components/Header";
import SearchBar from "@/components/SearchBar";
import FiltersMenu from "@/components/FiltersMenu";
import FilterControls from "@/components/FilterControls";
import IconGrid from "@/components/IconGrid";

export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  category?: string;
  colorVar?: string;
  status?: string;
  colors?: string;
  /** "popular" | "az" — controls the sort order of the results. */
  sort?: string;
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  let catalog;
  let commentCounts: Record<string, number> = {};
  let orderCounts: Record<string, number> = {};
  let visualDescriptions: Map<string, string> = new Map();
  try {
    const [c, countsResult, orders, visual] = await Promise.all([
      getIconCatalog(),
      getCommentCounts().catch(() => ({ counts: {} as Record<string, number>, total: 0 })),
      getIconOrderCounts().catch(() => ({} as Record<string, number>)),
      loadVisualDescriptions().catch(() => new Map<string, string>()),
    ]);
    catalog = c;
    commentCounts = countsResult.counts;
    orderCounts = orders;
    visualDescriptions = visual;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return (
      <main className="mx-auto max-w-3xl p-10">
        <h1 className="font-display text-3xl text-tomato">
          Failed to load catalog
        </h1>
        <pre className="mt-4 rounded-lg bg-pink-soft p-4 text-xs text-cherry">
          {message}
        </pre>
      </main>
    );
  }

  const query = (searchParams.q || "").trim().toLowerCase();
  // Color families parsed out of the search box (for the chips under the heading).
  const queryFamilies = query ? parseSearchQuery(query).families : [];
  const category = searchParams.category || "";
  const colorVarOnly = searchParams.colorVar === "1";
  const colorSlots = (searchParams.colors || "")
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter((n) => !Number.isNaN(n));

  // Sort mode. Absent => default ordering (relevance while searching,
  // alphabetical otherwise). "az" forces alphabetical even within a search.
  const sort: "popular" | "az" | null =
    searchParams.sort === "popular"
      ? "popular"
      : searchParams.sort === "az"
        ? "az"
        : null;

  // Status now works as a view mode rather than a filter:
  //   - default (no ?status)  → "Active": every icon that isn't DRAFT or ARCHIVED
  //   - ?status=DRAFT         → only DRAFT icons
  //   - ?status=ARCHIVED      → only ARCHIVED icons
  // Anything in the sheet that isn't explicitly DRAFT or ARCHIVED falls into
  // Active by default, so unrecognized / blank statuses stay visible.
  const statusParamRaw = (searchParams.status || "").toUpperCase();
  const statusView: "DRAFT" | "ARCHIVED" | null =
    statusParamRaw === "DRAFT"
      ? "DRAFT"
      : statusParamRaw === "ARCHIVED"
        ? "ARCHIVED"
        : null;

  const inCurrentView = (i: Icon) => {
    const s = (i.status || "").toUpperCase();
    if (statusView === "DRAFT") return s === "DRAFT";
    if (statusView === "ARCHIVED") return s === "ARCHIVED";
    return s !== "DRAFT" && s !== "ARCHIVED";
  };
  const scopedIcons = catalog.icons.filter(inCurrentView);

  const filtered = applyFilters(scopedIcons, {
    query,
    category,
    colorVarOnly,
    colorSlots,
    sort,
    orderCounts,
    visualDescriptions,
  });

  // When sorting by popularity, surface each visible icon's order count on its
  // card. Keyed by slug so IconGrid can look it up directly.
  const showOrderCounts = sort === "popular";
  const orderCountBySlug: Record<string, number> = {};
  if (showOrderCounts) {
    for (const i of filtered) {
      orderCountBySlug[i.slug] = orderCounts[normIconName(i.name)] ?? 0;
    }
  }

  // Catalog-wide counts for the Draft and Archived links in the sidebar.
  // These don't change as the user navigates between views — they always
  // reflect the totals across the whole catalog.
  let draftCount = 0;
  let archivedCount = 0;
  for (const i of catalog.icons) {
    const s = (i.status || "").toUpperCase();
    if (s === "DRAFT") draftCount++;
    else if (s === "ARCHIVED") archivedCount++;
  }

  // Per-category counts are scoped to the current view: on the default
  // (Active) view they're active icons by category, on the Draft view they're
  // draft icons by category, etc. That way the numbers always match what the
  // user would actually see if they clicked the category.
  const categoryCounts: Record<string, number> = {};
  for (const i of scopedIcons) {
    if (!i.category) continue;
    categoryCounts[i.category] = (categoryCounts[i.category] || 0) + 1;
  }
  const totalCount = scopedIcons.length;

  // Heading reflects category > query > view, in that order of specificity.
  // The view name is also surfaced as a small eyebrow above the heading when
  // we're not on the default view, so a "Bows" page under the Draft view is
  // clearly labeled as Draft.
  const viewLabel =
    statusView === "DRAFT"
      ? "DRAFT"
      : statusView === "ARCHIVED"
        ? "ARCHIVED"
        : null;
  const heading = category
    ? category
    : query
      ? `Search: "${query}"`
      : viewLabel ?? "All icons";

  const hasActiveFilters = Boolean(
    query || category || colorVarOnly || statusView || colorSlots.length
  );

  return (
    <>
      <Header initialQuery={query} showSearch />
      <main className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
        <nav className="font-ui mb-6 flex items-center gap-2 text-xs text-ink-muted">
          <Link href="/" className="hover:text-espresso transition-colors">
            Home
          </Link>
          <span aria-hidden>›</span>
          <span className="text-espresso">{heading}</span>
        </nav>

        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            {viewLabel && (category || query) && (
              <p className="font-ui text-[10px] font-semibold uppercase tracking-[0.18em] text-berry">
                {viewLabel}
              </p>
            )}
            <h1 className="font-display text-4xl font-medium tracking-tightest text-espresso md:text-5xl">
              {heading}
            </h1>
            <p className="font-ui mt-1.5 text-sm text-ink-muted">
              {filtered.length.toLocaleString()}{" "}
              {filtered.length === 1 ? "icon" : "icons"}
              {category && ` in ${category}`}
              {query && ` matching "${query}"`}
            </p>
            {colorSlots.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="font-ui text-[11px] text-ink-muted">
                  Uses all of:
                </span>
                {colorSlots.map((slot) => {
                  const t = getThreadBySlot(slot);
                  if (!t) return null;
                  return (
                    <span
                      key={slot}
                      className="font-ui inline-flex items-center gap-1.5 rounded-full border border-parchment bg-white px-2 py-0.5 text-[11px] text-ink-soft"
                    >
                      <span
                        className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
                        style={{ backgroundColor: rgbToHex(t.rgb) }}
                        aria-hidden
                      />
                      {t.name}
                    </span>
                  );
                })}
              </div>
            )}
            {queryFamilies.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="font-ui text-[11px] text-ink-muted">
                  Including colors:
                </span>
                {queryFamilies.map((f) => (
                  <span
                    key={f.word}
                    className="font-ui inline-flex items-center gap-1.5 rounded-full border border-parchment bg-white px-2 py-0.5 text-[11px] text-ink-soft"
                  >
                    <span className="flex -space-x-0.5">
                      {f.slots.slice(0, 3).map((slot) => {
                        const t = getThreadBySlot(slot);
                        if (!t) return null;
                        return (
                          <span
                            key={slot}
                            className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
                            style={{ backgroundColor: rgbToHex(t.rgb) }}
                            aria-hidden
                          />
                        );
                      })}
                    </span>
                    {f.word.replace(/\b\w/g, (c) => c.toUpperCase())}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex w-full flex-col gap-3 md:w-auto md:items-end">
            <div className="flex w-full items-center gap-2 md:hidden">
              <div className="flex-1">
                <SearchBar initialQuery={query} />
              </div>
              <FiltersMenu />
            </div>
            {hasActiveFilters && (
              <Link
                href="/browse"
                className="font-ui inline-flex items-center gap-1.5 self-start rounded-full border border-pink bg-white px-3.5 py-1.5 text-xs font-semibold text-cherry transition-colors hover:bg-pink-soft md:self-end"
              >
                Clear all filters
                <CloseIcon className="h-3 w-3" />
              </Link>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-10 lg:grid-cols-[220px_1fr]">
          <aside className="lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:pr-2">
            <FilterControls
              categories={catalog.categories}
              currentCategory={category}
              currentColorVar={colorVarOnly}
              currentQuery={query}
              categoryCounts={categoryCounts}
              totalCount={totalCount}
              currentStatusView={statusView}
              draftCount={draftCount}
              archivedCount={archivedCount}
              currentSort={sort}
            />
          </aside>

          <section>
            {filtered.length === 0 ? (
              <EmptyState query={query} category={category} />
            ) : (
              <IconGrid
                icons={filtered}
                commentCounts={commentCounts}
                orderCounts={orderCountBySlug}
                showOrderCounts={showOrderCounts}
              />
            )}
          </section>
        </div>
      </main>
    </>
  );
}

type SortMode = "popular" | "az" | null;

function applyFilters(
  icons: Icon[],
  opts: {
    query: string;
    category: string;
    colorVarOnly: boolean;
    colorSlots: number[];
    sort: SortMode;
    orderCounts: Record<string, number>;
    visualDescriptions: Map<string, string>;
  }
): Icon[] {
  let result = icons;

  // Visual description for an icon (from the VISUAL_INDEX tab), keyed by PNG
  // file ID. Folded into the search doc so looks-based queries work.
  const descOf = (i: Icon) =>
    i.pngFileId ? opts.visualDescriptions.get(i.pngFileId) : undefined;

  if (opts.category) result = result.filter((i) => i.category === opts.category);
  if (opts.colorVarOnly) result = result.filter((i) => i.hasColorVariation);

  // Compound color filter: keep only icons whose design uses EVERY selected
  // color (AND), not just any one of them.
  if (opts.colorSlots.length) {
    result = result.filter((i) =>
      opts.colorSlots.every((slot) => i.threadSlots.includes(slot))
    );
  }

  // Search narrows `result` to the matching icons and attaches a relevance
  // score (rel) to each. With no query, everything matches with rel 0, so the
  // relevance branch below collapses to the chosen default ordering.
  //
  // The query is parsed into color FAMILIES (e.g. "green" → Olive / Dark Green
  // / Matcha) and text TOKENS (fuzzy-matched against names, categories, old
  // names, and theme tags from the sheet's Tags column).
  let scored: { i: Icon; rel: number }[];

  if (opts.query) {
    const { families, tokens } = parseSearchQuery(opts.query);

    if (families.length > 0 && tokens.length > 0) {
      // Color + text: design must use a slot from EVERY named family (AND),
      // then rank by how well the text tokens match.
      scored = result
        .filter((i) => familiesMatch(i.threadSlots, families))
        .map((i) => ({ i, rel: scoreDoc(buildSearchDoc(i, descOf(i)), tokens) }))
        .filter((x) => x.rel > 0);
    } else if (families.length > 0) {
      // Pure color query ("olive", "red, green and blue"): also surface icons
      // NAMED after those colors (the Olive icon for "olive").
      const colorWords = families.flatMap((f) => f.word.split(" "));
      scored = result
        .map((i) => ({ i, rel: nameScore(buildSearchDoc(i), colorWords) }))
        .filter((x) => x.rel > 0 || familiesMatch(x.i.threadSlots, families));
    } else if (tokens.length > 0) {
      // Text-only query: every token must match somewhere.
      scored = result
        .map((i) => ({ i, rel: scoreDoc(buildSearchDoc(i, descOf(i)), tokens) }))
        .filter((x) => x.rel > 0);
    } else {
      // Query was only stopwords — keep everything, no relevance signal.
      scored = result.map((i) => ({ i, rel: 0 }));
    }
  } else {
    scored = result.map((i) => ({ i, rel: 0 }));
  }

  const byName = (a: Icon, b: Icon) => a.name.localeCompare(b.name);
  const ordersOf = (i: Icon) => opts.orderCounts[normIconName(i.name)] ?? 0;

  // An explicit sort choice wins in every context, including active searches.
  if (opts.sort === "popular") {
    return scored
      .sort((a, b) => ordersOf(b.i) - ordersOf(a.i) || byName(a.i, b.i))
      .map((x) => x.i);
  }
  if (opts.sort === "az") {
    return scored.sort((a, b) => byName(a.i, b.i)).map((x) => x.i);
  }

  // No explicit sort: rank by search relevance when there's a query (the
  // original behavior), otherwise fall back to alphabetical.
  if (opts.query) {
    return scored
      .sort((a, b) => b.rel - a.rel || byName(a.i, b.i))
      .map((x) => x.i);
  }
  return scored.sort((a, b) => byName(a.i, b.i)).map((x) => x.i);
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={className}
      aria-hidden
    >
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

function EmptyState({
  query,
  category,
}: {
  query: string;
  category: string;
}) {
  return (
    <div className="flex min-h-[300px] flex-col items-center justify-center rounded-2xl border border-dashed border-parchment bg-parchment/50 p-10 text-center">
      <p className="font-display text-2xl text-espresso">No icons match.</p>
      <p className="font-ui mt-2 max-w-sm text-sm text-ink-muted">
        {query && `Nothing matches "${query}"`}
        {query && category && " in this category"}
        {!query && category && "This category is empty"}
        {!query && !category && "Try adjusting your filters"}.
      </p>
      <Link
        href="/browse"
        className="font-ui mt-5 rounded-full border border-pink bg-white px-4 py-2 text-sm font-medium text-cherry transition-colors hover:bg-pink-soft"
      >
        Clear all filters
      </Link>
    </div>
  );
}
