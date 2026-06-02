import Header from "@/components/Header";
import CompositeView from "@/components/CompositeView";
import {
  getCompositeStats,
  type CompositeSnapshot,
} from "@/lib/compositeStats";

export const dynamic = "force-dynamic";

const EMPTY: CompositeSnapshot = {
  windows: {
    "3mo": { key: "3mo", label: "3 months", colors: [], totalUses: 0 },
    "6mo": { key: "6mo", label: "6 months", colors: [], totalUses: 0 },
    "12mo": { key: "12mo", label: "12 months", colors: [], totalUses: 0 },
  },
  updatedAt: null,
  coverage: "",
};

export default async function CompositePage() {
  let snapshot: CompositeSnapshot;
  try {
    snapshot = await getCompositeStats();
  } catch {
    snapshot = EMPTY;
  }

  return (
    <>
      <Header showSearch={false} />
      <main className="mx-auto max-w-5xl px-6 py-12 lg:px-10 lg:py-16">
        <div className="mb-8">
          <p className="font-ui mb-2 text-xs uppercase tracking-[0.25em] text-berry">
            Composite thread usage
          </p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-espresso md:text-5xl">
            Which threads get used most
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft">
            Real-world spool usage across orders — combining the thread colors
            in every ordered icon with the thread color customers pick for their
            text. Use this to see what actually runs through the machines.
          </p>
          {snapshot.coverage && (
            <p className="font-ui mt-3 text-xs text-ink-muted">
              Coverage: {snapshot.coverage}
            </p>
          )}
        </div>

        <CompositeView snapshot={snapshot} />
      </main>
    </>
  );
}
