import Link from "next/link";
import { getIconCatalog, type Icon } from "@/lib/sheets";
import { isPremadeCategory } from "@/lib/categories";
import Header from "@/components/Header";
import Curtain from "@/components/Curtain";
import SearchBar from "@/components/SearchBar";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let catalog;
  try {
    catalog = await getIconCatalog();
  } catch (error) {
    return <ErrorView error={error} />;
  }

  const byCategory = new Map<string, Icon[]>();
  for (const icon of catalog.icons) {
    const arr = byCategory.get(icon.category) || [];
    arr.push(icon);
    byCategory.set(icon.category, arr);
  }

  const categories = catalog.categories.map((name) => {
    const items = byCategory.get(name) || [];
    const sample = items.find((i) => i.pngFileId) || items[0];
    return { name, count: items.length, sample };
  });

  return (
    <>
      <Curtain />
      <Header showSearch />
      <main>
        {/* Hero */}
        <section className="bg-paper border-b border-parchment">
          <div className="mx-auto max-w-5xl px-6 py-20 text-center lg:py-28">
            <p className="font-ui mb-5 text-xs uppercase tracking-[0.25em] text-berry">
              Internal catalog · {catalog.totalCount.toLocaleString()} icons
            </p>
            <h1 className="font-display text-5xl font-medium leading-[1.05] tracking-tightest text-espresso text-balance lg:text-7xl">
              Every Abbode icon,
              <br />
              <span className="font-paris italic text-berry">in one place.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-ink-soft md:text-lg">
              Browse, search, and download embroidery files for every icon in
              the library — always reflecting the latest version of the source
              sheet.
            </p>

            <div className="mx-auto mt-10 max-w-xl">
              <SearchBar />
            </div>
          </div>
        </section>

        {/* Categories */}
        <section className="mx-auto max-w-7xl px-6 py-16 lg:px-10 lg:py-24">
          <div className="mb-10 flex items-end justify-between gap-6">
            <div>
              <h2 className="font-display text-3xl font-medium tracking-tight text-espresso md:text-4xl">
                Browse by category
              </h2>
              <p className="font-ui mt-2 text-sm text-ink-muted">
                {categories.length} categories · click any tile to view all
                icons in it.
              </p>
            </div>
            <Link
              href="/browse"
              className="font-ui hidden whitespace-nowrap text-sm font-medium text-berry underline decoration-pink underline-offset-4 transition-colors hover:text-cherry hover:decoration-berry md:inline"
            >
              View all icons →
            </Link>
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map((category) => (
              <CategoryTile
                key={category.name}
                {...category}
                accent={isPremadeCategory(category.name)}
              />
            ))}
          </div>
        </section>

        <footer className="border-t border-parchment bg-parchment">
          <div className="font-ui mx-auto flex max-w-7xl flex-col gap-2 px-6 py-8 text-xs text-ink-muted md:flex-row md:items-center md:justify-between lg:px-10">
            <p>
              Last synced{" "}
              {new Date(catalog.fetchedAt).toLocaleString("en-US", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </p>
            <p>Source of truth: the master Google Sheet.</p>
          </div>
        </footer>
      </main>
    </>
  );
}

function CategoryTile({
  name,
  count,
  sample,
  accent = false,
}: {
  name: string;
  count: number;
  sample?: Icon;
  /** Special-category treatment: berry border, faint wash, berry title. */
  accent?: boolean;
}) {
  const slug = encodeURIComponent(name);
  return (
    <Link
      href={`/browse?category=${slug}`}
      className={`group relative flex aspect-[4/5] flex-col overflow-hidden rounded-2xl border p-5 transition-all duration-300 hover:-translate-y-0.5 hover:shadow-[0_8px_30px_-12px_rgba(187,55,103,0.20)] focus-ring ${
        accent
          ? "border-pink bg-pink-soft/40 hover:border-berry"
          : "border-parchment bg-white hover:border-pink"
      }`}
    >
      <div className="flex flex-1 items-center justify-center">
        {sample?.pngFileId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/image/${sample.pngFileId}`}
            alt=""
            loading="lazy"
            className="max-h-[70%] max-w-[70%] object-contain transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <span className="font-display text-6xl text-parchment">·</span>
        )}
      </div>
      <div className="mt-auto flex items-end justify-between gap-2">
        <h3
          className={`font-display text-xl font-medium leading-tight tracking-tight ${
            accent ? "text-berry" : "text-espresso"
          }`}
        >
          {name}
        </h3>
        <span className="font-ui text-[10px] uppercase tracking-wider text-ink-muted">
          {count}
        </span>
      </div>
    </Link>
  );
}

function ErrorView({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <main className="mx-auto max-w-3xl p-10">
      <h1 className="font-display text-3xl text-tomato">
        Failed to load the catalog
      </h1>
      <pre className="mt-4 rounded-lg bg-pink-soft p-4 text-xs text-cherry">
        {message}
      </pre>
    </main>
  );
}
