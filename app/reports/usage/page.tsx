import Header from "@/components/Header";
import UsageReport from "@/components/UsageReport";
import { getUsageStats } from "@/lib/usageStats";

export const dynamic = "force-dynamic";

/**
 * /reports/usage — most common icons, fonts, and text colors per product and
 * per template, computed from real orders by the daily stats script.
 */
export default async function UsagePage() {
  const snapshot = await getUsageStats();

  return (
    <>
      <Header showSearch={false} />
      <main className="mx-auto max-w-5xl px-6 py-12 lg:px-10 lg:py-16">
        <div className="mb-8">
          <p className="font-ui mb-2 text-xs uppercase tracking-[0.25em] text-berry">
            Product usage
          </p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-espresso md:text-5xl">
            Icon &amp; color use across products
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft">
            What customers actually choose, from real orders. Start by product or
            by template, drill in, and see the most common icons, fonts, and text
            colors for that selection.
          </p>
          {snapshot.coverage && (
            <p className="font-ui mt-3 text-xs text-ink-muted">
              Coverage: {snapshot.coverage}
              {snapshot.updatedAt ? ` · updated ${snapshot.updatedAt}` : ""}
            </p>
          )}
        </div>

        <UsageReport snapshot={snapshot} />
      </main>
    </>
  );
}
