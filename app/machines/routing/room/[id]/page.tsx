import Link from "next/link";
import RoutingSheetHeader from "@/components/RoutingSheetHeader";
import { getMachineJobs } from "@/lib/threadAllocationData";
import { getActiveFloors } from "@/lib/machineConfigs";
import { computeAllocation } from "@/lib/threadAllocation";
import { readWebsterQueue } from "@/lib/websterQueue";
import { roomLoadoutsFromFleet, routeOrders, type RoutableOrder } from "@/lib/orderRouting";
import { HeadStrip, OrderRow } from "@/components/RoutingParts";

/**
 * One room's day list: every order the board routed here for the batch,
 * oldest to newest, with what's on the room's heads at the top. This is the
 * sheet an embroiderer works from (or, for now, the one Jay presents) — the
 * Print button makes the handout.
 *
 *   /machines/routing/room/3?batch=YYYY-MM-DD
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

export default async function RoomDayPage({
  params,
  searchParams,
}: {
  params: { id: string };
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
        <h1 className="font-display text-2xl text-tomato">Failed to load the room list</h1>
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

  const room = (fleet?.rooms ?? []).find((r) => r.id === params.id);
  const roomLive = loadouts.some((r) => r.id === params.id);

  if (!room) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <RoutingSheetHeader batchLabel="Unknown room" backHref="/machines/routing" backLabel="← Day Board" />
        <p className="font-ui text-sm text-ink-soft">
          No Webster room &ldquo;{params.id}&rdquo;. Head back to the{" "}
          <Link href="/machines/routing" className="underline">
            day board
          </Link>
          .
        </p>
      </main>
    );
  }

  // Oldest to newest — the order they came in, the order they get worked.
  const assigned = [...(result.byRoom[room.id] ?? [])].sort((a, b) => {
    const ca = orderByName.get(a.orderId)?.createdAt ?? "";
    const cb = orderByName.get(b.orderId)?.createdAt ?? "";
    return ca.localeCompare(cb) || a.orderId.localeCompare(b.orderId);
  });
  const cf = assigned.filter((a) => a.status === "change-free").length;

  const metaLine = [
    `${assigned.length} ${assigned.length === 1 ? "order" : "orders"}`,
    assigned.length ? `${cf} change-free` : null,
    "oldest first",
    queue.updatedAt ? `queue updated ${queue.updatedAt}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <main className="mx-auto max-w-4xl px-6 py-8 print:px-0 print:py-0">
      <style>{`
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          @page { margin: 12mm; }
          body { background: #ffffff !important; }
        }
      `}</style>

      <RoutingSheetHeader
        batchLabel={batch ? `Batch — ${prettyBatch(batch)}` : "No open batch"}
        scopeLabel={room.name}
        metaLine={metaLine}
        configLine={
          hasConfig
            ? "Loadouts from the ACTIVE thread configuration."
            : "No active configuration — Generate one on the day board."
        }
        backHref="/machines/routing"
        backLabel="← Day Board"
      />

      {queue.batches.length > 1 ? (
        <nav className="font-ui mb-5 flex flex-wrap items-center gap-1.5 text-xs print:hidden">
          <span className="text-ink-muted">Batches:</span>
          {queue.batches.map((b) => (
            <Link
              key={b}
              href={`/machines/routing/room/${room.id}?batch=${b}`}
              className={`rounded-full px-2.5 py-1 transition-colors ${
                b === batch ? "bg-plum font-semibold text-porcelain" : "bg-parchment text-ink-soft hover:text-espresso"
              }`}
            >
              {b}
            </Link>
          ))}
        </nav>
      ) : null}

      {!room.active ? (
        <div className="rounded-xl border border-cream-200 bg-cream-50 p-5">
          <p className="font-ui text-sm text-ink-soft">
            {room.name} is blocked off for today. Unblock it on the{" "}
            <Link href="/machines/routing" className="underline">
              day board
            </Link>{" "}
            and Generate to route orders here.
          </p>
        </div>
      ) : !roomLive ? (
        <div className="rounded-xl border border-cream-200 bg-cream-50 p-5">
          <p className="font-ui text-sm text-ink-soft">
            No threaded heads in {room.name} — Generate a thread config on the day board first.
          </p>
        </div>
      ) : (
        <>
          {fleet ? <HeadStrip fleet={fleet} roomId={room.id} /> : null}
          {assigned.length === 0 ? (
            <p className="font-ui py-3 text-sm text-ink-muted">No orders routed here for this batch.</p>
          ) : (
            assigned.map((a) => {
              const order = orderByName.get(a.orderId);
              return order ? <OrderRow key={a.orderId} order={order} a={a} showTime /> : null;
            })
          )}
          <p className="font-ui mt-6 text-[11px] text-ink-muted">
            Orders run oldest to newest by the time they were placed (New York time). Change-free means every design
            on the order fits a head already threaded in this room; swap orders list the colors to swap in.
          </p>
        </>
      )}
    </main>
  );
}
