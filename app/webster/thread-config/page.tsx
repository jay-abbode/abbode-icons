import Link from "next/link";
import Header from "@/components/Header";
import WebsterThreadTreeView from "@/components/WebsterThreadTreeView";
import ThreadTreeLog from "@/components/ThreadTreeLog";
import { getWebsterThreadTree, type WebsterThreadTree } from "@/lib/websterThreadTree";
import { recordTreeIfChanged, type TreeLogEntry } from "@/lib/threadTreeLog";
import { fleetBase } from "@/lib/threadAllocation";

/**
 * /webster/thread-config — the landing page the header button points at.
 *
 * Shows Webster's standing thread tree (top N colors over 12 months of composite
 * data, N = the Barudan needle count) and the same threads listed in needle
 * order. Deliberately read-only: this is the "what should be hanging on the
 * machines" answer. The interactive floor — per-head toggles, off-color heads,
 * locks, saved configs — stays on /machines, and the live per-order board stays
 * on /webster; both are linked from here.
 */
export const dynamic = "force-dynamic";

export default async function WebsterThreadConfigPage() {
  const base = fleetBase("webster");
  let tree: WebsterThreadTree | null = null;
  let error: string | null = null;
  let history: TreeLogEntry[] = [];
  let writeFailed = false;

  try {
    tree = await getWebsterThreadTree();
  } catch (e) {
    error = e instanceof Error ? e.message : "Unknown error";
  }

  // Recording happens on view: compare this tree to the last one logged and
  // append an entry if it moved. Best-effort by design — the log is a record of
  // the page, so it must never be able to break the page.
  if (tree) {
    try {
      const res = await recordTreeIfChanged(tree);
      history = res.history;
      writeFailed = res.writeFailed;
    } catch {
      history = [];
      writeFailed = true;
    }
  }

  return (
    <>
      <Header showSearch={false} />
      <main className="mx-auto max-w-5xl px-5 pb-24 pt-6 lg:px-8">
        <nav className="font-ui mb-6 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <Link href="/" className="transition-colors hover:text-espresso">
            Home
          </Link>
          <span>/</span>
          <span className="text-ink-soft">Webster Thread Config</span>
          <span className="ml-auto flex items-center gap-4">
            <Link href="/webster" className="font-medium transition-colors hover:text-espresso">
              Webster Board →
            </Link>
            <Link href="/machines" className="font-medium transition-colors hover:text-espresso">
              Full Thread Config →
            </Link>
          </span>
        </nav>

        <div className="mb-8">
          <p className="font-ui mb-2 text-xs uppercase tracking-[0.25em] text-berry">
            {base.brand}
          </p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-espresso md:text-5xl">
            Webster Thread Config
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft">
            The {base.needleCount} threads that should be hanging on every Webster tree — ranked by
            what actually ran through the machines over the last 12 months, combining the colors in
            every ordered icon with the color customers picked for their text.
          </p>
          {tree?.coverage && (
            <p className="font-ui mt-3 text-xs text-ink-muted">Coverage: {tree.coverage}</p>
          )}
        </div>

        {error ? (
          <div className="rounded-2xl border border-cream-200 bg-cream-50 p-6">
            <h2 className="font-display text-lg text-tomato">Failed to load composite data</h2>
            <pre className="mt-3 overflow-auto rounded-lg bg-pink-soft p-4 text-xs text-cherry">
              {error}
            </pre>
          </div>
        ) : tree ? (
          <>
            <WebsterThreadTreeView tree={tree} />
            <ThreadTreeLog history={history} writeFailed={writeFailed} />
          </>
        ) : null}
      </main>
    </>
  );
}
