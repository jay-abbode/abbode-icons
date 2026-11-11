import Link from "next/link";
import Header from "@/components/Header";
import { getIconCatalog, type Icon } from "@/lib/sheets";
import { pickAlphabetCover } from "@/lib/categories";

/**
 * /alphabets — the lettering sets, one tile each.
 *
 * Every tile shows that set's letter "A" with the set's name under it, and
 * opens the set on the browse page. A set is whatever the catalog flags as an
 * alphabet (see detectAlphabetCategories in lib/categories.ts), so a new one
 * shows up here as soon as its rows are in the sheet.
 */
export const dynamic = "force-dynamic";

export default async function AlphabetsPage() {
  let catalog;
  try {
    catalog = await getIconCatalog();
  } catch (error) {
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

  const bySet = new Map<string, Icon[]>();
  for (const icon of catalog.icons) {
    if (!icon.isAlphabet) continue;
    const list = bySet.get(icon.category);
    if (list) list.push(icon);
    else bySet.set(icon.category, [icon]);
  }

  const sets = catalog.alphabetCategories.map((name) => {
    const designs = bySet.get(name) || [];
    const isLive = (i: Icon) => {
      const s = (i.status || "").toUpperCase();
      return s !== "DRAFT" && s !== "ARCHIVED";
    };
    // A set that's still entirely in draft opens on its Draft view, so the
    // tile never lands on an empty page.
    const draftOnly =
      !designs.some(isLive) &&
      designs.some((i) => (i.status || "").toUpperCase() === "DRAFT");
    return {
      name,
      cover: pickAlphabetCover(designs),
      href:
        `/browse?category=${encodeURIComponent(name)}` +
        (draftOnly ? "&status=DRAFT" : ""),
    };
  });

  return (
    <>
      <Header showSearch={false} />
      <main className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
        <nav className="font-ui mb-6 flex items-center gap-2 text-xs text-ink-muted">
          <Link href="/" className="transition-colors hover:text-espresso">
            Home
          </Link>
          <span aria-hidden>›</span>
          <span className="text-espresso">Alphabets</span>
        </nav>

        <h1 className="font-display mb-8 text-4xl font-medium tracking-tightest text-espresso md:text-5xl">
          Alphabets
        </h1>

        {sets.length === 0 ? (
          <p className="font-ui text-sm text-ink-muted">No alphabets yet.</p>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {sets.map((set) => (
              <Link
                key={set.name}
                href={set.href}
                className="group flex flex-col overflow-hidden rounded-2xl border border-parchment bg-white p-5 transition-all duration-300 hover:-translate-y-0.5 hover:border-pink hover:shadow-[0_8px_30px_-12px_rgba(187,55,103,0.20)] focus-ring"
              >
                <div className="flex aspect-square items-center justify-center">
                  {set.cover?.pngFileId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/image/${set.cover.pngFileId}`}
                      alt={set.cover.name}
                      loading="lazy"
                      className="max-h-[75%] max-w-[75%] object-contain transition-transform duration-500 group-hover:scale-105"
                    />
                  ) : (
                    <span className="font-display text-7xl text-parchment">A</span>
                  )}
                </div>
                <h2 className="font-display mt-4 text-center text-xl font-medium leading-tight tracking-tight text-espresso">
                  {set.name}
                </h2>
              </Link>
            ))}
          </div>
        )}
      </main>
    </>
  );
}
