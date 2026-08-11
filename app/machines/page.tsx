import Link from "next/link";
import Header from "@/components/Header";
import WebsterDayBoard, { type BoardRoom } from "@/components/WebsterDayBoard";
import { getMachineJobs } from "@/lib/threadAllocationData";
import { getActiveFloors, listConfigs } from "@/lib/machineConfigs";
import { computeAllocation } from "@/lib/threadAllocation";
import { readWebsterQueue } from "@/lib/websterQueue";
import { roomLoadoutsFromFleet, routeOrders, type RoutableOrder } from "@/lib/orderRouting";

/**
 * /machines — the Webster board, and the only surface the floor team needs:
 * turn rooms on or off, hit GENERATE, open a room. The allocation solves
 * against every OUTSTANDING order (the open `webster-live` queue), and
 * Generate pins the solved loadouts so what got threaded stays what every
 * page shows until the next Generate.
 *
 * Everything else — per-head toggles, off-color heads, locks, scope, saved
 * configs, both fleets — lives under /machines/config (Advanced
 * configuration).
 */
export const dynamic = "force-dynamic";

function fmtWhen(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export default async function MachinesPage() {
  let jobsData, floors, queue, configs;
  try {
    [jobsData, floors, queue, configs] = await Promise.all([
      getMachineJobs({ source: "queue" }),
      getActiveFloors().catch(() => ({})),
      readWebsterQueue(),
      listConfigs("webster").catch(() => []),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return (
      <>
        <Header />
        <main className="mx-auto max-w-3xl p-10">
          <h1 className="font-display text-3xl text-tomato">Failed to load the board</h1>
          <pre className="mt-4 rounded-lg bg-pink-soft p-4 text-xs text-cherry">{message}</pre>
        </main>
      </>
    );
  }

  const alloc = computeAllocation(jobsData.jobs, floors, jobsData.meta);
  const fleet = alloc.fleets.find((f) => f.key === "webster");
  const hasConfig = Boolean((floors as Record<string, unknown>).webster);
  const active = configs.find((c) => c.kind === "active");
  const lastGenerated = active
    ? [fmtWhen(active.savedAt), active.savedBy ? `by ${active.savedBy}` : null].filter(Boolean).join(" ")
    : null;

  const orders = queue.orders;
  const routable: RoutableOrder[] = orders.map((o) => ({
    id: o.name,
    designs: o.lines.filter((l) => !l.flag && l.slots.length > 0).map((l) => l.slots),
  }));
  const loadouts = fleet ? roomLoadoutsFromFleet(fleet) : [];
  const result = routeOrders(loadouts, routable);
  const orderByName = new Map(orders.map((o) => [o.name, o]));

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

  const statLine = [
    `${orders.length} outstanding ${orders.length === 1 ? "order" : "orders"}`,
    `${result.stats.changeFree} change-free`,
    result.stats.swap ? `${result.stats.swap} need a swap` : null,
    result.stats.review ? `${result.stats.review} for review` : null,
    queue.updatedAt ? `queue updated ${queue.updatedAt}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <Header />
      <main className="mx-auto max-w-5xl px-5 pb-24 pt-6 lg:px-8">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl text-espresso md:text-4xl">Webster Machines</h1>
            <p className="font-ui mt-1 text-sm text-ink-soft">{statLine}</p>
          </div>
          <div className="font-ui flex items-center gap-4 text-xs">
            <Link href="/machines/daysheet" className="text-ink-muted transition-colors hover:text-espresso">
              Day sheet
            </Link>
            <Link href="/machines/config" className="text-ink-muted transition-colors hover:text-espresso">
              Advanced configuration →
            </Link>
          </div>
        </div>

        {!queue.tabFound ? (
          <div className="rounded-xl border border-cream-200 bg-cream-50 p-5">
            <h2 className="font-display text-lg text-espresso">The order queue hasn&rsquo;t been written yet</h2>
            <p className="font-ui mt-2 text-sm text-ink-soft">
              This board reads the WEBSTER_QUEUE tab that the{" "}
              <span className="font-semibold">Webster order queue</span> GitHub Action maintains (repo → Actions →
              Webster order queue → Run workflow). Once a run completes, refresh this page.
            </p>
          </div>
        ) : (
          <>
            <WebsterDayBoard rooms={rooms} hasConfig={hasConfig} lastGenerated={lastGenerated} />

            {orders.length === 0 ? (
              <div className="mt-5 rounded-xl border border-cream-200 bg-cream-50 p-5">
                <p className="font-ui text-sm text-ink-soft">
                  No outstanding <span className="font-semibold">webster-live</span> orders in the last pull
                  {queue.updatedAt ? ` (updated ${queue.updatedAt})` : ""}. Re-run the Webster order queue workflow for
                  a fresh pull.
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
              Generate solves the thread allocation across the open rooms against every outstanding order, then pins
              each head&rsquo;s loadout until the next Generate. An order is change-free in a room when every design on
              it fits a head threaded there; the rest go to the room needing the fewest spool swaps. Orders with
              nothing derivable land in the review pile.
            </p>
          </>
        )}
      </main>
    </>
  );
}
