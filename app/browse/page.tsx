import Link from "next/link";
import { getIconCatalog, type Icon } from "@/lib/sheets";
import { getCommentCounts } from "@/lib/comments";
import Header from "@/components/Header";
import SearchBar from "@/components/SearchBar";
import FilterControls from "@/components/FilterControls";
import IconGrid from "@/components/IconGrid";

export const dynamic = "force-dynamic";

interface SearchParams {
  q?: string;
  category?: string;
  colorVar?: string;
  status?: string;
}

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  let catalog;
  let commentCounts: Record<string, number> = {};
  try {
    const [c, countsResult] = await Promise.all([
      getIconCatalog(),
      getCommentCounts().catch(() => ({ counts: {} as Record<string, number>, total: 0 })),
    ]);
    catalog = c;
    commentCounts = countsResult.counts;
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
  const category = searchParams.category || "";
  const colorVarOnly = searchParams.colorVar === "1";

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
  });

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
    query || category || colorVarOnly || statusView
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
          </div>

          <div className="flex w-full flex-col gap-3 md:w-auto md:items-end">
            <div className="w-full md:hidden">
              <SearchBar initialQuery={query} />
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
            />
          </aside>

          <section>
            {filtered.length === 0 ? (
              <EmptyState query={query} category={category} />
            ) : (
              <IconGrid icons={filtered} commentCounts={commentCounts} />
            )}
          </section>
        </div>
      </main>
    </>
  );
}

function applyFilters(
  icons: Icon[],
  opts: {
    query: string;
    category: string;
    colorVarOnly: boolean;
  }
): Icon[] {
  let result = icons;

  if (opts.category) result = result.filter((i) => i.category === opts.category);
  if (opts.colorVarOnly) result = result.filter((i) => i.hasColorVariation);

  if (opts.query) {
    const q = opts.query;
    result = result.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.category.toLowerCase().includes(q) ||
        (i.oldName && i.oldName.toLowerCase().includes(q))
    );
  }

  return result.slice().sort((a, b) => a.name.localeCompare(b.name));
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
