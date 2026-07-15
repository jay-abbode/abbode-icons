import Header from "@/components/Header";
import ProductTrends from "@/components/ProductTrends";
import { getProductTrends, EMPTY_PRODUCT_TRENDS } from "@/lib/productTrends";
import { getUsageStats, EMPTY_USAGE } from "@/lib/usageStats";
import { getTrendStats, EMPTY_TRENDS } from "@/lib/trendStats";

export const dynamic = "force-dynamic";

/**
 * /reports/trends — the DTC "Product Trends" section. The demand layer beneath
 * popularity: order volume over time, item (garment) colors, product & design
 * mix, and seasonality, split by online vs in-store. Reads three precomputed
 * TRENDS_* tabs plus the existing PRODUCT_USAGE and ICON/COLOR_TRENDS tabs, all
 * written by the order-stats script — so this stays fast and token-free.
 */
export default async function ProductTrendsPage() {
  const [trends, usage, momentum] = await Promise.all([
    getProductTrends().catch(() => EMPTY_PRODUCT_TRENDS),
    getUsageStats().catch(() => EMPTY_USAGE),
    getTrendStats().catch(() => EMPTY_TRENDS),
  ]);

  return (
    <>
      <Header showSearch={false} />
      <main className="mx-auto max-w-5xl px-6 py-12 lg:px-10 lg:py-16">
        <div className="mb-8">
          <p className="font-ui mb-2 text-xs uppercase tracking-[0.25em] text-berry">
            Product trends
          </p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-espresso md:text-5xl">
            What people order, and when
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft">
            The demand layer beneath popularity — order volume over time, the item
            colors customers pick, the products and designs they choose, and how it
            shifts by season. Direct-to-consumer only: online store plus in-store.
          </p>
          {trends.coverage && (
            <p className="font-ui mt-3 text-xs text-ink-muted">
              Coverage: {trends.coverage}
              {trends.updatedAt ? ` · updated ${trends.updatedAt}` : ""}
            </p>
          )}
        </div>

        <ProductTrends trends={trends} usage={usage} momentum={momentum} />
      </main>
    </>
  );
}
