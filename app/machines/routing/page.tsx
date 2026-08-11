import Link from "next/link";
import WebsterDayBoard, { type BoardRoom } from "@/components/WebsterDayBoard";
import { getMachineJobs } from "@/lib/threadAllocationData";
import { getActiveFloors } from "@/lib/machineConfigs";
import { computeAllocation } from "@/lib/threadAllocation";
import { readWebsterQueue } from "@/lib/websterQueue";
import { roomLoadoutsFromFleet, routeOrders, type RoutableOrder } from "@/lib/orderRouting";

/**
 * The Webster day board — the morning ritual in one screen:
 *
 *   1. Block off the rooms that aren't running today.
 *   2. Generate Thread Config — re-solves the loadouts across the open rooms
 *      and saves them as the ACTIVE config (day sheet + room pages follow).
 *   3. Each live room card shows its loadouts and its share of the day's
 *      batch; click through for the room's order list, oldest to newest.
 *
 * Orders come from the open `webster-live` queue (WEBSTER_QUEUE tab); the
 * batch defaults to the newest day and can be switched with ?batch=YYYY-MM-DD.
 * The review pile — orders nothing can be derived for — sits at the bottom.
 *
 * The full solver workbench (scopes, locks, saved configs, snapshots) lives on
 * the Thread Config page; this board is the daily surface.
 */
export const dynamic = "force-dynamic";

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function prettyBatch(batch: string): string {
  const d = new Date(`${batch}T00:00:00`);
  if (Number.isNaN(d.getTime())) return batch;
  return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export default async function DayBoardPage({
  searchParams,
}: {
  searchParams: { batch?: string | string[] };
}) {
  let jobsData, floors, queue;
  try {
    [jobsData, floors, queue] = await Promise.all([
      getMachineJobs(),
      getActiveFloors().catch(() => ({})),
      readWebsterQueue(),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return (
      <main className="mx-auto max-w-3xl p-10">
        <h1 className="font-display text-2xl text-tomato">Failed to load the day board</h1>
        <pre className="mt-4 rounded-lg bg-pink-soft p-4 text-xs text-cherry">{message}</pre>
      </main>
    );
  }

  const alloc = computeAllocation(jobsData.jobs, floors, jobsData.meta);
  const fleet = alloc.fleets.find((f) => f.key === "webster");
  const hasConfig = Boolean((floors as Record<string, unknown>).webster);

  const batchParam = one(searchParams.batch);
  const batch =
    batchParam && queue.batches.includes(batchParam) ? batchParam : (queue.batches[0] ?? "");
  const batchOrders = queue.orders.filter((o) => o.batch === batch);

  const routable: RoutableOrder[] = batchOrders.map((o) => ({
    id: o.name,
    designs: o.lines.filter((l) => !l.flag && l.slots.length > 0).map((l) => l.slots),
  }));
  const loadouts = fleet ? roomLoadoutsFromFleet(fleet) : [];
  const result = routeOrders(loadouts, routable);
  const orderByName = new Map(batchOrders.map((o) => [o.name, o]));

  const rooms: BoardRoom[] = (fleet?.rooms ?? []).map((r) => {
    const assigned = result.byRoom[r.id] ?? [];
    return {
      id: r.id,
      name: r.name,
      active: r.active,
      headCount: (fleet?.machines ?? []).filter((m) => m.roomId === r.id).length,
      heads: (fleet?.machines ?? [])
        .filter((m) => m.roomId === r.id && m.active && m.slots.length > 0)
        .map((m) => ({ id: m.id, slots: m.slots, offColor: m.offColor })),
      orders: assigned.length,
      changeFree: assigned.filter((a) => a.status === "change-free").length,
      swaps: assigned.filter((a) => a.status === "swap").length,
    };
  });

  const metaLine = [
    `${batchOrders.length} orders`,
    `${result.stats.changeFree} change-free`,
    result.stats.swap ? `${result.stats.swap} need a swap` : null,
    result.stats.review ? `${result.stats.review} for review` : null,
    queue.updatedAt ? `queue updated ${queue.updatedAt}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3 border-b border-cream-200 pb-4">
        <div>
          <div className="font-ui mb-1">
            <Link href="/machines" className="text-xs text-ink-muted hover:text-espresso">
              ← Thread Config
            </Link>
            <span className="mx-2 text-xs text-ink-muted">·</span>
            <Link href="/machines/daysheet" className="text-xs text-ink-muted hover:text-espresso">
              Day sheet
            </Link>
          </div>
          <h1 className="font-display text-2xl text-espresso md:text-3xl">Webster Day Board</h1>
          <p className="font-ui mt-1 text-sm text-ink-soft">
            {batch ? `Batch — ${prettyBatch(batch)}` : "No open batch"}
          </p>
          {batch ? <p className="font-ui text-xs text-ink-muted">{metaLine}</p> : null}
        </div>
      </div>

      {/* ── Empty states ─────────────────────────────────────────────────── */}
      {!queue.tabFound ? (
        <div className="rounded-xl border border-cream-200 bg-cream-50 p-5">
          <h2 className="font-display text-lg text-espresso">The queue hasn&rsquo;t been written yet</h2>
          <p className="font-ui mt-2 text-sm text-ink-soft">
            This board reads the WEBSTER_QUEUE tab that the <span className="font-semibold">Webster order queue</span>{" "}
            GitHub Action maintains (repo → Actions → Webster order queue → Run workflow). Once a run completes,
            refresh this page.
          </p>
        </div>
      ) : (
        <>
          {queue.batches.length > 1 ? (
            <nav className="font-ui mb-5 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="text-ink-muted">Batches:</span>
              {queue.batches.map((b) => (
                <Link
                  key={b}
                  href={`/machines/routing?batch=${b}`}
                  className={`rounded-full px-2.5 py-1 transition-colors ${
                    b === batch ? "bg-plum font-semibold text-porcelain" : "bg-parchment text-ink-soft hover:text-espresso"
                  }`}
                >
                  {b}
                </Link>
              ))}
            </nav>
          ) : null}

          <WebsterDayBoard rooms={rooms} batch={batch} hasConfig={hasConfig} />

          {queue.orders.length === 0 ? (
            <div className="mt-5 rounded-xl border border-cream-200 bg-cream-50 p-5">
              <p className="font-ui text-sm text-ink-soft">
                Queue is empty — no open <span className="font-semibold">webster-live</span> orders in the last pull
                {queue.updatedAt ? ` (updated ${queue.updatedAt})` : ""}. Re-run the Webster order queue workflow for a
                fresh pull.
              </p>
            </div>
          ) : null}

          {result.review.length > 0 ? (
            <section className="mt-8">
              <div className="mb-2 border-b-2 border-cherry/30 pb-1">
                <h2 className="font-display text-xl text-cherry">
                  Review pile
                  <span className="font-ui ml-2 text-xs font-normal text-ink-muted">
                    needs a human call — nothing derivable to route on
                  </span>
                </h2>
              </div>
              {result.review.map((a) => {
                const order = orderByName.get(a.orderId);
                if (!order) return null;
                const reasons = [...new Set(order.lines.map((l) => l.flag).filter(Boolean))].join(", ");
                return (
                  <div key={a.orderId} className="border-b border-cream-200/70 py-2 last:border-b-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-ui text-sm font-semibold tabular-nums text-espresso">{order.name}</span>
                      <span className="font-ui rounded-full bg-pink-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cherry">
                        {reasons || "no stitchable lines"}
                      </span>
                    </div>
                    <div className="mt-1 space-y-0.5">
                      {order.lines.map((l, i) => (
                        <div key={i} className="font-ui text-[11.5px] text-ink-soft">
                          {l.product}
                          {l.quantity > 1 ? ` ×${l.quantity}` : ""}
                          {l.icons ? ` — ${l.icons}` : ""}
                          {l.text ? ` — "${l.text}"` : ""}
                          {l.preview ? (
                            <>
                              {" "}
                              <a
                                href={l.preview}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-ink-muted underline decoration-cream-200 hover:text-espresso"
                              >
                                proof
                              </a>
                            </>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          ) : null}

          <p className="font-ui mt-8 text-[11px] text-ink-muted">
            Generate re-solves the thread loadouts across the open rooms (on the same order history as Thread Config)
            and saves them as the active configuration — the day sheet and room pages follow automatically. An order is
            change-free in a room when every design on it fits a head already threaded there; the rest go to the room
            needing the fewest swaps. Batches follow the order&rsquo;s created date (America/New_York).
          </p>
        </>
      )}
    </main>
  );
}
