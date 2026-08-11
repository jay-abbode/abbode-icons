import Link from "next/link";
import RoutingSheetHeader from "@/components/RoutingSheetHeader";
import { getMachineJobs } from "@/lib/threadAllocationData";
import { getActiveFloors } from "@/lib/machineConfigs";
import { computeAllocation } from "@/lib/threadAllocation";
import { readWebsterQueue } from "@/lib/websterQueue";
import { roomLoadoutsFromFleet, routeOrders, type RoutableOrder } from "@/lib/orderRouting";
import { HeadStrip, OrderRow } from "@/components/RoutingParts";

/**
 * One room's list: every OUTSTANDING order the board routed here, oldest to
 * newest, with what's on the room's heads at the top. This is the sheet an
 * embroiderer works from (or, for now, the one Jay presents) — the Print
 * button makes the handout.
 *
 *   /machines/routing/room/3
 */
export const dynamic = "force-dynamic";

export default async function RoomDayPage({ params }: { params: { id: string } }) {
  let jobsData, floors, queue;
  try {
    [jobsData, floors, queue] = await Promise.all([
      getMachineJobs({ source: "queue" }),
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

  const orders = queue.orders;

  const routable: RoutableOrder[] = orders.map((o) => ({
    id: o.name,
    designs: o.lines.filter((l) => !l.flag && l.slots.length > 0).map((l) => l.slots),
  }));
  const loadouts = fleet ? roomLoadoutsFromFleet(fleet) : [];
  const result = routeOrders(loadouts, routable);
  const orderByName = new Map(orders.map((o) => [o.name, o]));

  const room = (fleet?.rooms ?? []).find((r) => r.id === params.id);
  const roomLive = loadouts.some((r) => r.id === params.id);

  if (!room) {
    return (
      <main className="mx-auto max-w-3xl px-6 py-10">
        <RoutingSheetHeader batchLabel="Unknown room" backHref="/machines" backLabel="← Machines" />
        <p className="font-ui text-sm text-ink-soft">
          No Webster room &ldquo;{params.id}&rdquo;. Head back to the{" "}
          <Link href="/machines" className="underline">
            board
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
        batchLabel="All outstanding orders"
        scopeLabel={room.name}
        metaLine={metaLine}
        configLine={
          hasConfig
            ? "Loadouts pinned by the last Generate."
            : "No configuration yet — Generate one on the board."
        }
        backHref="/machines"
        backLabel="← Machines"
      />

      {!room.active ? (
        <div className="rounded-xl border border-cream-200 bg-cream-50 p-5">
          <p className="font-ui text-sm text-ink-soft">
            {room.name} is off. Turn it on from the{" "}
            <Link href="/machines" className="underline">
              board
            </Link>{" "}
            and Generate to route orders here.
          </p>
        </div>
      ) : !roomLive ? (
        <div className="rounded-xl border border-cream-200 bg-cream-50 p-5">
          <p className="font-ui text-sm text-ink-soft">
            No threaded heads in {room.name} — hit Generate on the board first.
          </p>
        </div>
      ) : (
        <>
          {fleet ? <HeadStrip fleet={fleet} roomId={room.id} /> : null}
          {assigned.length === 0 ? (
            <p className="font-ui py-3 text-sm text-ink-muted">No outstanding orders routed here.</p>
          ) : (
            assigned.map((a) => {
              const order = orderByName.get(a.orderId);
              return order ? <OrderRow key={a.orderId} order={order} a={a} showTime /> : null;
            })
          )}
          <p className="font-ui mt-6 text-[11px] text-ink-muted">
            Every outstanding order routed to this room, oldest first by the time it was placed (New York time).
            Change-free means every design on the order fits a head already threaded here; swap orders list the colors
            to swap in.
          </p>
        </>
      )}
    </main>
  );
}
