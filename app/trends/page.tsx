import Header from "@/components/Header";
import TrendsView from "@/components/TrendsView";
import { getTrendStats, EMPTY_TRENDS, type TrendsSnapshot } from "@/lib/trendStats";

export const dynamic = "force-dynamic";

export default async function TrendsPage() {
  let snapshot: TrendsSnapshot;
  try {
    snapshot = await getTrendStats();
  } catch {
    snapshot = EMPTY_TRENDS;
  }

  return (
    <>
      <Header showSearch={false} />
      <main className="mx-auto max-w-5xl px-6 py-12 lg:px-10 lg:py-16">
        <div className="mb-8">
          <p className="font-ui mb-2 text-xs uppercase tracking-[0.25em] text-berry">
            Trends
          </p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-espresso md:text-5xl">
            What&rsquo;s trending right now
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft">
            Icons and text colors that are climbing fastest — comparing the most
            recent window of orders to the window just before it. Use it to spot
            what&rsquo;s spiking before it shows up in the all-time totals.
          </p>
        </div>

        <TrendsView snapshot={snapshot} />
      </main>
    </>
  );
}
