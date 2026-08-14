import { ThreadTree } from "./MachineParts";
import type { Machine } from "@/lib/threadAllocation";
import type { WebsterThreadTree } from "@/lib/websterThreadTree";

/**
 * Body of the Webster Thread Config landing page: a small tree diagram up top,
 * the same threads listed in needle order underneath.
 *
 * The diagram reuses the <ThreadTree> the machine pages already draw, fed a
 * synthetic head whose slots are the ranked colors — one renderer for spool
 * layouts everywhere, so numbering and geometry can't drift from /machines.
 * It's a reference thumbnail here, not the main event: the list below is what
 * you actually thread from, so the graphic is deliberately small.
 */

/** Row template. Mobile shows needle/swatch/color/total/share; the icons-vs-text
 * split and the distribution bar only appear once there's room for them. */
const ROW =
  "grid grid-cols-[2rem_1rem_minmax(0,1fr)_3.5rem_3rem] md:grid-cols-[2.5rem_1rem_minmax(0,1fr)_3.5rem_3.5rem_4rem_3rem_minmax(4rem,7rem)] items-center gap-2 md:gap-3";

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
  const onTree = tree.threads.reduce((sum, t) => sum + t.total, 0);
  const coveredPct = Math.round(tree.covered * 100);

  return (
    <div>
      {/* ── The tree ─────────────────────────────────────────────────────── */}
      <section className="rounded-2xl border border-cream-200 bg-white p-5 md:p-6">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-7">
          {/* Fixed, small, and flex-none so it can never grow into the copy. */}
          <ThreadTree machine={machine} needleCount={tree.needleCount} widthClass="w-36 sm:w-40" />

          <div className="min-w-0 flex-1">
            <h2 className="font-display text-xl text-espresso">Standard tree</h2>
            <p className="font-ui mt-1.5 text-[13px] leading-relaxed text-ink-soft">
              The {tree.needleCount} spools that earn a permanent needle, ranked by real usage over
              the last {tree.windowLabel}. Needle 1 carries the busiest color; the number inside each
              spool is its color-menu #.
            </p>

            <dl className="mt-4 grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-parchment bg-parchment">
              <Stat label="Coverage" value={`${coveredPct}%`} accent />
              <Stat label="On tree" value={onTree.toLocaleString()} />
              <Stat label="Palette" value={tree.totalUses.toLocaleString()} />
            </dl>
          </div>
        </div>

        <p className="font-ui mt-4 text-[11px] leading-relaxed text-ink-muted">
          Coverage = share of every thread use in the window that lands on a spool already hanging on
          this tree. The remaining {Math.max(0, 100 - coveredPct)}% is what off-color heads and spool
          swaps exist to absorb.
          {tree.updatedAt ? ` · Updated ${tree.updatedAt}` : ""}
        </p>
      </section>

      {/* ── The list ─────────────────────────────────────────────────────── */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-xl text-espresso">Threads in order</h2>
          <p className="font-ui text-xs text-ink-muted">Thread the tree in this order</p>
        </div>

        <div className="overflow-hidden rounded-xl border border-parchment bg-white">
          <div
            className={`${ROW} font-ui border-b border-parchment px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted md:px-4`}
          >
            <span className="text-right">Ndl</span>
            <span />
            <span>Color</span>
            <span className="hidden text-right md:block">Icons</span>
            <span className="hidden text-right md:block">Text</span>
            <span className="text-right">Total</span>
            <span className="text-right">Share</span>
            <span className="hidden md:block">Distribution</span>
          </div>

          <ul>
            {tree.threads.map((t) => (
              <li
                key={t.slot}
                className={`${ROW} border-b border-parchment/60 px-3 py-2 last:border-b-0 md:px-4`}
              >
                <span className="font-ui text-right text-xs font-semibold tabular-nums text-espresso">
                  {t.needle}
                </span>
                <span
                  className="h-3 w-3 flex-none rounded-full ring-1 ring-black/10"
                  style={{ backgroundColor: t.hex }}
                  aria-hidden
                />
                <span className="font-ui truncate text-xs">
                  <span className="font-semibold text-espresso">{t.slot}</span>{" "}
                  <span className="text-ink-soft">{t.name}</span>{" "}
                  <span className="text-ink-muted">· {t.code}</span>
                </span>
                <span className="font-ui hidden text-right text-xs tabular-nums text-ink-soft md:block">
                  {t.icons.toLocaleString()}
                </span>
                <span className="font-ui hidden text-right text-xs tabular-nums text-ink-soft md:block">
                  {t.text.toLocaleString()}
                </span>
                <span className="font-ui text-right text-xs font-semibold tabular-nums text-cherry">
                  {t.total.toLocaleString()}
                </span>
                <span className="font-ui text-right text-xs tabular-nums text-ink-muted">
                  {(t.share * 100).toFixed(1)}%
                </span>
                <span className="hidden h-2 w-full overflow-hidden rounded-full bg-parchment md:block">
                  <span
                    className="block h-full rounded-full bg-berry"
                    style={{
                      width: `${Math.max((t.total / maxTotal) * 100, t.total > 0 ? 2 : 0)}%`,
                    }}
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
            {tree.benched.length} palette colors ranked below needle {tree.needleCount} — what an
            off-color head or a spool swap has to cover.
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

/**
 * One compact stat cell. Numbers use font-ui, not font-display — the serif's
 * figures are wide enough that a 6-digit total overflowed a narrow cell, which
 * is what made these overlap.
 */
function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="min-w-0 bg-porcelain px-3 py-2.5">
      <dt className="font-ui truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
        {label}
      </dt>
      <dd
        className={`font-ui mt-0.5 truncate text-lg font-semibold tabular-nums ${
          accent ? "text-cherry" : "text-espresso"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
