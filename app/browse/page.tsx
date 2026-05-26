import Link from "next/link";
import { getIconCatalog, type Icon } from "@/lib/sheets";
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
  try {
    catalog = await getIconCatalog();
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
  const statusFilter = searchParams.status || "";

  const filtered = applyFilters(catalog.icons, {
    query,
    category,
    colorVarOnly,
    statusFilter,
  });

  const allStatuses = Array.from(
    new Set(catalog.icons.map((i) => i.status))
  ).sort();

  const heading = category
    ? category
    : query
      ? `Search: "${query}"`
      : "All icons";

  const hasActiveFilters = Boolean(
    query || category || colorVarOnly || statusFilter
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
              statuses={allStatuses}
              currentCategory={category}
              currentColorVar={colorVarOnly}
              currentStatus={statusFilter}
              currentQuery={query}
            />
          </aside>

          <section>
            {filtered.length === 0 ? (
              <EmptyState query={query} category={category} />
            ) : (
              <IconGrid icons={filtered} />
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
    statusFilter: string;
  }
): Icon[] {
  let result = icons;

  if (opts.category) result = result.filter((i) => i.category === opts.category);
  if (opts.colorVarOnly) result = result.filter((i) => i.hasColorVariation);
  if (opts.statusFilter) result = result.filter((i) => i.status === opts.statusFilter);

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
