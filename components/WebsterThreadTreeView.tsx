import { ThreadTree } from "./MachineParts";
import type { Machine } from "@/lib/threadAllocation";
import type { WebsterThreadTree } from "@/lib/websterThreadTree";

/**
 * Body of the Webster Thread Config landing page: the tree diagram up top, the
 * same threads listed in needle order underneath.
 *
 * The diagram is the existing <ThreadTree> the machine pages already draw, fed a
 * synthetic head whose slots are the ranked colors — one renderer for spool
 * layouts everywhere, so the numbering and geometry can't drift between this
 * page and /machines.
 */
export default function WebsterThreadTreeView({ tree }: { tree: WebsterThreadTree }) {
  if (!tree.hasData) {
    return (
      <div className="rounded-2xl border border-cream-200 bg-cream-50 p-6">
        <h2 className="font-display text-lg text-espresso">No composite data yet</h2>
        <p className="font-ui mt-2 text-sm leading-relaxed text-ink-soft">
          This page ranks threads off the <span className="font-semibold">COMPOSITE</span> tab in the
          catalog sheet, written by the order-stats script. Run{" "}
          <span className="font-semibold">scripts/icon_order_stats</span> (or the GitHub Action) once
          and refresh.
        </p>
      </div>
    );
  }

  // Synthetic head: needle 1 = rank 1. Purely for the diagram — never saved.
  const machine: Machine = {
    id: "webster-tree",
    name: "Webster standard tree",
    roomId: null,
    active: true,
    offColor: false,
    locked: false,
    slots: tree.threads.map((t) => t.slot),
  };

  const maxTotal = Math.max(1, ...tree.threads.map((t) => t.total));

  return (
    <div>
      {/* ── The tree ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-cream-200 bg-white p-6 md:p-8">
        <div className="flex flex-col items-center gap-6 lg:flex-row lg:items-start lg:gap-10">
          <ThreadTree
            machine={machine}
            needleCount={tree.needleCount}
            widthClass="w-full max-w-[20rem]"
          />

          <div className="w-full flex-1">
            <h2 className="font-display text-2xl text-espresso">Standard tree</h2>
            <p className="font-ui mt-1.5 text-sm leading-relaxed text-ink-soft">
              The {tree.needleCount} spools that earn a permanent needle, ranked by real usage over
              the last {tree.windowLabel}. Needle 1 carries the busiest color. Numbers inside the
              spools are color-menu #s.
            </p>

            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Stat label="Coverage" value={`${Math.round(tree.covered * 100)}%`} accent />
              <Stat label="Uses on tree" value={onTreeUses(tree).toLocaleString()} />
              <Stat label="Palette uses" value={tree.totalUses.toLocaleString()} />
            </dl>

            <p className="font-ui mt-4 text-[11px] leading-relaxed text-ink-muted">
              Coverage = share of every thread use in the window that lands on a spool already
              hanging on this tree. The remaining{" "}
              {Math.max(0, 100 - Math.round(tree.covered * 100))}% is what off-color heads and spool
              swaps exist to absorb.
              {tree.updatedAt ? ` · Updated ${tree.updatedAt}` : ""}
            </p>
          </div>
        </div>
      </section>

      {/* ── The list ─────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl text-espresso">Threads in order</h2>
          <p className="font-ui text-xs text-ink-muted">
            Thread the tree top to bottom in this order
          </p>
        </div>

        <div className="overflow-hidden rounded-xl border border-parchment bg-white">
          <div className="font-ui grid grid-cols-[2.5rem_1.25rem_minmax(6rem,1fr)_3.5rem_3.5rem_4rem_3.5rem_minmax(4rem,7rem)] items-center gap-3 border-b border-parchment px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            <span className="text-right">Ndl</span>
            <span />
            <span>Color</span>
            <span className="text-right">Icons</span>
            <span className="text-right">Text</span>
            <span className="text-right">Total</span>
            <span className="text-right">Share</span>
            <span className="hidden sm:block">Distribution</span>
          </div>

          <ul>
            {tree.threads.map((t) => (
              <li
                key={t.slot}
                className="grid grid-cols-[2.5rem_1.25rem_minmax(6rem,1fr)_3.5rem_3.5rem_4rem_3.5rem_minmax(4rem,7rem)] items-center gap-3 border-b border-parchment/60 px-4 py-2 last:border-b-0"
              >
                <span className="font-ui text-right text-xs font-semibold tabular-nums text-espresso">
                  {t.needle}
                </span>
                <span
                  className="h-3.5 w-3.5 flex-none rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: t.hex }}
                  aria-hidden
                />
                <span className="font-ui truncate text-xs">
                  <span className="font-semibold text-espresso">{t.slot}</span>{" "}
                  <span className="text-ink-soft">{t.name}</span>{" "}
                  <span className="text-ink-muted">· {t.code}</span>
                </span>
                <span className="font-ui text-right text-xs tabular-nums text-ink-soft">
                  {t.icons.toLocaleString()}
                </span>
                <span className="font-ui text-right text-xs tabular-nums text-ink-soft">
                  {t.text.toLocaleString()}
                </span>
                <span className="font-ui text-right text-xs font-semibold tabular-nums text-cherry">
                  {t.total.toLocaleString()}
                </span>
                <span className="font-ui text-right text-xs tabular-nums text-ink-muted">
                  {(t.share * 100).toFixed(1)}%
                </span>
                <span className="hidden h-2 w-full overflow-hidden rounded-full bg-parchment sm:block">
                  <span
                    className="block h-full rounded-full bg-berry"
                    style={{ width: `${Math.max((t.total / maxTotal) * 100, t.total > 0 ? 2 : 0)}%` }}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── What didn't make the cut ─────────────────────────────────────── */}
      {tree.benched.length > 0 && (
        <section className="mt-8">
          <h2 className="font-display text-base text-espresso">Off the tree</h2>
          <p className="font-ui mt-1 text-xs text-ink-soft">
            {tree.benched.length} palette colors ranked below needle {tree.needleCount} — these are
            what an off-color head or a spool swap has to cover.
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {tree.benched.map((t) => (
              <li
                key={t.slot}
                className="font-ui inline-flex items-center gap-1.5 rounded-full border border-parchment bg-white px-2.5 py-1 text-[11px] text-ink-soft"
              >
                <span
                  className="h-2.5 w-2.5 flex-none rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: t.hex }}
                  aria-hidden
                />
                <span className="font-semibold text-espresso">{t.slot}</span>
                <span>{t.name}</span>
                <span className="tabular-nums text-ink-muted">{t.total.toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function onTreeUses(tree: WebsterThreadTree): number {
  return tree.threads.reduce((sum, t) => sum + t.total, 0);
}

function Stat({
  label,
  value,
  accent = false,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-parchment bg-porcelain px-3 py-2.5">
      <dt className="font-ui text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </dt>
      <dd
        className={`font-display mt-0.5 text-2xl tabular-nums ${
          accent ? "text-cherry" : "text-espresso"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
