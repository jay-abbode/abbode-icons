import Header from "@/components/Header";
import { getIconCatalog } from "@/lib/sheets";
import AssetDownloader from "@/components/AssetDownloader";
import { NEW_WINDOW_DAYS, filterNewIcons, getIconAgeIndex } from "@/lib/iconDates";

export const dynamic = "force-dynamic";

/**
 * /assets — bulk asset downloads.
 *
 * Loads the live catalog server-side and hands it to the client exporter, which
 * builds and streams a single timestamped zip of the selected categories, file
 * types, and sizes directly to the user's disk.
 */
export default async function AssetsPage() {
  const catalog = await getIconCatalog();

  // Resolve which icons count as "recently added" here, on the server — dating
  // an icon can need a Drive call, which has no business in the browser. If it
  // fails the exporter just shows the criterion as unavailable.
  const index = await getIconAgeIndex(catalog.icons).catch(() => null);
  const newSlugs = index
    ? filterNewIcons(catalog.icons, index, NEW_WINDOW_DAYS).map((e) => e.icon.slug)
    : [];

  return (
    <>
      <Header showSearch={false} />
      <main className="mx-auto max-w-5xl px-6 py-10 lg:px-10">
        <header className="mb-8">
          <p className="font-ui text-[10px] font-semibold uppercase tracking-[0.16em] text-berry">
            Asset downloads
          </p>
          <h1 className="font-display mt-1 text-4xl font-medium tracking-tightest text-espresso md:text-5xl">
            Download assets
          </h1>
          <p className="font-ui mt-1.5 text-sm text-ink-muted">
            Pick categories, file types, and sizes, then export everything as one
            zip. File names follow the catalog convention; color variations are
            included for icons that have them.
          </p>
        </header>

        <AssetDownloader
          icons={catalog.icons}
          categories={catalog.categories}
          newSlugs={newSlugs}
          newWindowDays={NEW_WINDOW_DAYS}
        />
      </main>
    </>
  );
}
