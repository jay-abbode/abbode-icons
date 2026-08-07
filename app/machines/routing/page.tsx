import Link from "next/link";
import RoutingSheetHeader from "@/components/RoutingSheetHeader";
import { getMachineJobs } from "@/lib/threadAllocationData";
import { getActiveFloors } from "@/lib/machineConfigs";
import { computeAllocation, type Fleet } from "@/lib/threadAllocation";
import { getThreadBySlot, rgbToHex } from "@/lib/threadPalette";
import { readWebsterQueue, type QueueOrder } from "@/lib/websterQueue";
import { roomLoadoutsFromFleet, routeOrders, type Assignment, type RoutableOrder } from "@/lib/orderRouting";

/**
 * The per-room pick sheet for Webster's daily batch.
 *
 * Reads the open `webster-live` queue (WEBSTER_QUEUE tab, written by
 * scripts/webster_queue) and the ACTIVE thread configuration, resolves every
 * head's loadout with the same engine the Thread Config page uses, and assigns
 * each order to a room that can stitch it change-free — spreading the day's
 * work evenly. Orders no room can take clean get the fewest-swaps room with the
 * colors to swap in; orders with nothing derivable go to the review pile.
 *
 *   ?batch=YYYY-MM-DD  a specific day's batch (default: the newest one)
 *   ?room=3            print just that room's list
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

function Chip({ slot, size = "h-2.5 w-2.5" }: { slot: number; size?: string }) {
  const color = getThreadBySlot(slot);
  if (!color) return null;
  return (
    <span
      title={`${slot} · ${color.name}`}
      className={`inline-block ${size} flex-none rounded-[2px] ring-1 ring-black/10`}
      style={{ backgroundColor: rgbToHex(color.rgb) }}
    />
  );
}

function colorNames(slots: number[]): string {
  return slots
    .map((s) => getThreadBySlot(s)?.name)
    .filter(Boolean)
    .join(", ");
}

function StatusBadge({ a }: { a: Assignment }) {
  if (a.status === "change-free") {
    return (
      <span className="font-ui rounded-full bg-parchment px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
        change-free
      </span>
    );
  }
  return (
    <span className="font-ui rounded-full bg-pink-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cherry">
      +{a.swaps} swap{a.swaps === 1 ? "" : "s"}
    </span>
  );
}

function OrderRow({ order, a }: { order: QueueOrder; a: Assignment }) {
  const stitchable = order.lines.filter((l) => !l.flag && l.slots.length > 0);
  const flagged = order.lines.filter((l) => l.flag);
  return (
    <div className="break-inside-avoid border-b border-cream-200/70 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-ui text-sm font-semibold tabular-nums text-espresso">{order.name}</span>
        <StatusBadge a={a} />
        {a.status === "swap" && a.missing.length ? (
          <span className="font-ui flex items-center gap-1 text-[11px] text-cherry">
            swap in:
            {a.missing.map((s) => (
              <Chip key={s} slot={s} size="h-2 w-2" />
            ))}
            <span>{colorNames(a.missing)}</span>
          </span>
        ) : null}
      </div>
      <div className="mt-1 space-y-0.5">
        {stitchable.map((l, i) => (
          <div key={i} className="font-ui flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11.5px] text-ink-soft">
            <span className="text-espresso">
              {l.product}
              {l.quantity > 1 ? ` ×${l.quantity}` : ""}
            </span>
            {l.icons ? <span>{l.icons}</span> : null}
            {l.text ? (
              <span className="text-ink-muted">
                &ldquo;{l.text}&rdquo;
                {l.textColor ? ` in ${l.textColor}` : ""}
              </span>
            ) : null}
            <span className="flex items-center gap-0.5">
              {l.slots.map((s) => (
                <Chip key={s} slot={s} size="h-2 w-2" />
              ))}
            </span>
            {l.preview ? (
              <a
                href={l.preview}
                target="_blank"
                rel="noreferrer"
                className="text-[10px] text-ink-muted underline decoration-cream-200 hover:text-espresso print:hidden"
              >
                proof
              </a>
            ) : null}
          </div>
        ))}
        {flagged.map((l, i) => (
          <div key={`f${i}`} className="font-ui text-[11px] text-ink-muted">
            {l.product}
            {l.quantity > 1 ? ` ×${l.quantity}` : ""} — {l.flag} (not routed on color)
          </div>
        ))}
      </div>
    </div>
  );
}

function HeadStrip({ fleet, roomId }: { fleet: Fleet; roomId: string }) {
  const heads = fleet.machines.filter((m) => m.roomId === roomId && m.active && m.slots.length > 0);
  if (!heads.length) return null;
  return (
    <div className="mb-2 rounded-lg border border-cream-200 bg-cream-50 px-3 py-2">
      <p className="font-ui mb-1 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
        Loaded on this room&rsquo;s heads
      </p>
      <div className="space-y-0.5">
        {heads.map((h) => (
          <div key={h.id} className="font-ui flex items-center gap-1.5 text-[10.5px] text-ink-soft">
            <span className="w-8 tabular-nums text-ink-muted">{h.id}</span>
            <span className="flex items-center gap-0.5">
              {h.slots.map((s) => (
                <Chip key={s} slot={s} size="h-2 w-2" />
              ))}
            </span>
            {h.offColor ? <span className="text-[9px] uppercase text-cherry">off-color</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function RoutingPage({
  searchParams,
}: {
  searchParams: { batch?: string | string[]; room?: string | string[] };
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
        <h1 className="font-display text-2xl text-tomato">Failed to load routing data</h1>
        <pre className="mt-4 rounded-lg bg-pink-soft p-4 text-xs text-cherry">{message}</pre>
      </main>
    );
  }

  const alloc = computeAllocation(jobsData.jobs, floors, jobsData.meta);
  const fleet = alloc.fleets.find((f) => f.key === "webster");
  const hasActiveConfig = Boolean((floors as Record<string, unknown>).webster);

  // ── Empty states ─────────────────────────────────────────────────────────
  if (!queue.tabFound || queue.orders.length === 0) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <RoutingSheetHeader batchLabel="No open batch" />
        {!queue.tabFound ? (
          <div className="rounded-xl border border-cream-200 bg-cream-50 p-5">
            <h2 className="font-display text-lg text-espresso">The queue hasn&rsquo;t been written yet</h2>
            <p className="font-ui mt-2 text-sm text-ink-soft">
              This page reads a WEBSTER_QUEUE tab that the <span className="font-semibold">Webster order queue</span>{" "}
              GitHub Action maintains (repo → Actions → Webster order queue → Run workflow). It uses the same five
              repository secrets as the order-stats workflow: GOOGLE_CREDENTIALS_JSON, GOOGLE_SHEET_ID, SHOPIFY_SHOP,
              SHOPIFY_CLIENT_ID, SHOPIFY_CLIENT_SECRET. Once a run completes, refresh this page.
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-cream-200 bg-cream-50 p-5">
            <h2 className="font-display text-lg text-espresso">Queue is empty</h2>
            <p className="font-ui mt-2 text-sm text-ink-soft">
              No open <span className="font-semibold">webster-live</span> orders in the last pull
              {queue.updatedAt ? ` (updated ${queue.updatedAt})` : ""}. Re-run the Webster order queue workflow for a
              fresh pull.
            </p>
          </div>
        )}
      </main>
    );
  }

  // ── Batch + room scoping ─────────────────────────────────────────────────
  const batchParam = one(searchParams.batch);
  const batch = batchParam && queue.batches.includes(batchParam) ? batchParam : queue.batches[0];
  const roomParam = one(searchParams.room);

  const batchOrders = queue.orders.filter((o) => o.batch === batch);
  const routable: RoutableOrder[] = batchOrders.map((o) => ({
    id: o.name,
    designs: o.lines.filter((l) => !l.flag && l.slots.length > 0).map((l) => l.slots),
  }));

  const rooms = fleet ? roomLoadoutsFromFleet(fleet) : [];
  const result = routeOrders(rooms, routable);
  const orderByName = new Map(batchOrders.map((o) => [o.name, o]));

  const scopedRooms = roomParam ? rooms.filter((r) => r.id === roomParam) : rooms;
  const scopeLabel = roomParam ? rooms.find((r) => r.id === roomParam)?.name : undefined;

  const metaLine = [
    `${batchOrders.length} orders`,
    `${result.stats.changeFree} change-free`,
    result.stats.swap ? `${result.stats.swap} need a swap` : null,
    result.stats.review ? `${result.stats.review} for review` : null,
    queue.updatedAt ? `queue updated ${queue.updatedAt}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const configLine = hasActiveConfig
    ? `Assignments assume the ACTIVE thread configuration (loadouts solved on ${alloc.window || "recent orders"}).`
    : "No active configuration saved — assignments assume the solver's default loadouts. Set one on Thread Config.";

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 print:px-0 print:py-0">
      <style>{`
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          @page { margin: 12mm; }
          body { background: #ffffff !important; }
        }
      `}</style>

      <RoutingSheetHeader
        batchLabel={`Batch — ${prettyBatch(batch)}`}
        scopeLabel={scopeLabel}
        metaLine={metaLine}
        configLine={configLine}
      />

      {queue.batches.length > 1 ? (
        <nav className="font-ui mb-5 flex flex-wrap items-center gap-1.5 text-xs print:hidden">
          <span className="text-ink-muted">Batches:</span>
          {queue.batches.map((b) => (
            <Link
              key={b}
              href={`/machines/routing?batch=${b}${roomParam ? `&room=${roomParam}` : ""}`}
              className={`rounded-full px-2.5 py-1 transition-colors ${
                b === batch ? "bg-plum font-semibold text-porcelain" : "bg-parchment text-ink-soft hover:text-espresso"
              }`}
            >
              {b}
            </Link>
          ))}
          {roomParam ? (
            <Link href={`/machines/routing?batch=${batch}`} className="ml-2 text-ink-muted underline hover:text-espresso">
              all rooms
            </Link>
          ) : null}
        </nav>
      ) : null}

      {!fleet || rooms.length === 0 ? (
        <div className="rounded-xl border border-cream-200 bg-pink-soft p-5">
          <p className="font-ui text-sm text-cherry">
            No active Webster rooms with threaded heads — check the Thread Config page (rooms or machines may be
            switched off, or the thread stats feed is empty).
          </p>
        </div>
      ) : (
        <>
          {scopedRooms.map((room) => {
            const assigned = result.byRoom[room.id] ?? [];
            const cf = assigned.filter((a) => a.status === "change-free").length;
            return (
              <section key={room.id} className="mb-6 break-inside-avoid-page">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-plum/25 pb-1">
                  <h2 className="font-display text-xl text-plum">
                    {room.name}
                    <span className="font-ui ml-2 text-xs font-normal text-ink-muted">
                      room {room.id} · {room.heads.length} {room.heads.length === 1 ? "head" : "heads"}
                    </span>
                  </h2>
                  <span className="font-ui text-xs text-ink-soft">
                    <strong className="text-espresso">{assigned.length}</strong>{" "}
                    {assigned.length === 1 ? "order" : "orders"}
                    {assigned.length ? ` · ${cf} change-free` : ""}
                    {!roomParam ? (
                      <Link
                        href={`/machines/routing?batch=${batch}&room=${room.id}`}
                        className="ml-2 text-ink-muted underline hover:text-espresso print:hidden"
                      >
                        print room
                      </Link>
                    ) : null}
                  </span>
                </div>
                {fleet ? <HeadStrip fleet={fleet} roomId={room.id} /> : null}
                {assigned.length === 0 ? (
                  <p className="font-ui py-2 text-xs text-ink-muted">No orders routed here for this batch.</p>
                ) : (
                  assigned.map((a) => {
                    const order = orderByName.get(a.orderId);
                    return order ? <OrderRow key={a.orderId} order={order} a={a} /> : null;
                  })
                )}
              </section>
            );
          })}

          {!roomParam && result.review.length > 0 ? (
            <section className="mb-6">
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
                                className="text-[10px] text-ink-muted underline decoration-cream-200 hover:text-espresso print:hidden"
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
        </>
      )}

      <p className="font-ui mt-6 text-[11px] text-ink-muted">
        An order is change-free in a room when every design on it fits a head already threaded there — no spool swaps.
        Change-free orders spread evenly across capable rooms; the rest go to the room needing the fewest swaps, with
        the colors to swap in listed. Batches follow the order&rsquo;s created date ({`America/New_York`}), matching how
        the 3PL cuts them.
      </p>
    </main>
  );
}
