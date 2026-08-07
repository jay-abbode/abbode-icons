/**
 * Order → room routing engine (pure — no sheet/network I/O, so it composes
 * with the allocation engine and is trivially testable).
 *
 * Webster batches a day's `webster-live` orders and each room's embroiderer
 * pulls their room's share. This module decides that share: which room stitches
 * which order, given what every head is actually threaded to.
 *
 * RULES
 * -----
 * An order may contain several designs (one per embroidered line item). A room
 * can take the order CHANGE-FREE when, for every design, at least one active
 * head in that room already carries every color the design uses. Designs within
 * an order may land on different heads — they're separate hoopings anyway.
 *
 *   1. Change-free first: an order goes to a room that needs no spool swap.
 *      Among capable rooms, pick the one with the fewest orders so far, so the
 *      day's work spreads evenly. Balancing can never cost change-free share:
 *      whether an order CAN run change-free doesn't depend on where the others
 *      went, only on the loadouts.
 *   2. No capable room: route to the room needing the fewest spool swaps
 *      (missing colors on the best head per design), ties broken by load.
 *   3. Nothing to stitch (no design resolved to any palette color): the order
 *      goes to the review pile for a human call.
 */

export type RoomLoadout = {
  id: string;
  name: string;
  /** Active heads only; `slots` is the loadout each head carries right now. */
  heads: { id: string; slots: number[] }[];
};

export type RoutableOrder = {
  /** Stable key — the Shopify order name (e.g. "#87479"). */
  id: string;
  /** One entry per embroidered line: the palette slots that design needs. */
  designs: number[][];
};

export type AssignmentStatus = "change-free" | "swap" | "review";

export type Assignment = {
  orderId: string;
  /** Null only for review orders. */
  roomId: string | null;
  status: AssignmentStatus;
  /** Spool swaps the assigned room needs for this order (0 when change-free). */
  swaps: number;
  /** The colors to swap in, in slot order. Empty when change-free / review. */
  missing: number[];
};

export type RoutingResult = {
  assignments: Assignment[];
  /** roomId -> that room's orders, in assignment order. Every room appears. */
  byRoom: Record<string, Assignment[]>;
  review: Assignment[];
  stats: {
    orders: number;
    /** Orders with at least one stitchable design. */
    routable: number;
    changeFree: number;
    swap: number;
    review: number;
    /** changeFree / routable (0 when nothing is routable). */
    changeFreeShare: number;
  };
};

function covers(head: Set<number>, design: number[]): boolean {
  for (const s of design) if (!head.has(s)) return false;
  return true;
}

/** Missing colors on the best head of `room` for each design, deduplicated. */
function roomGap(
  room: { heads: Set<number>[] },
  designs: number[][]
): { swaps: number; missing: number[] } {
  const missing = new Set<number>();
  for (const design of designs) {
    let best: number[] | null = null;
    for (const head of room.heads) {
      const gap = design.filter((s) => !head.has(s));
      if (best === null || gap.length < best.length) best = gap;
      if (best.length === 0) break;
    }
    for (const s of best ?? design) missing.add(s);
  }
  return { swaps: missing.size, missing: [...missing].sort((a, b) => a - b) };
}

/**
 * Assign every order to a room (or the review pile). Deterministic: same
 * inputs, same output — orders are processed in the given order, room ties
 * break toward the earlier room in `rooms`.
 */
export function routeOrders(rooms: RoomLoadout[], orders: RoutableOrder[]): RoutingResult {
  const live = rooms
    .filter((r) => r.heads.length > 0)
    .map((r) => ({ id: r.id, heads: r.heads.map((h) => new Set(h.slots)) }));

  const load = new Map<string, number>(live.map((r) => [r.id, 0]));
  const byRoom: Record<string, Assignment[]> = {};
  for (const r of rooms) byRoom[r.id] = [];

  const assignments: Assignment[] = [];
  const review: Assignment[] = [];
  let changeFree = 0;
  let swap = 0;
  let routable = 0;

  for (const order of orders) {
    const designs = order.designs.filter((d) => d.length > 0);

    if (designs.length === 0 || live.length === 0) {
      const a: Assignment = { orderId: order.id, roomId: null, status: "review", swaps: 0, missing: [] };
      assignments.push(a);
      review.push(a);
      continue;
    }
    routable++;

    // Change-free capable rooms, then least-loaded among them.
    let pick: (typeof live)[number] | null = null;
    for (const room of live) {
      if (!designs.every((d) => room.heads.some((h) => covers(h, d)))) continue;
      if (pick === null || load.get(room.id)! < load.get(pick.id)!) pick = room;
    }

    if (pick) {
      const a: Assignment = { orderId: order.id, roomId: pick.id, status: "change-free", swaps: 0, missing: [] };
      assignments.push(a);
      byRoom[pick.id].push(a);
      load.set(pick.id, load.get(pick.id)! + 1);
      changeFree++;
      continue;
    }

    // No room can take it change-free: fewest swaps, ties by load.
    let bestRoom = live[0];
    let bestGap = roomGap(live[0], designs);
    for (let i = 1; i < live.length; i++) {
      const gap = roomGap(live[i], designs);
      if (
        gap.swaps < bestGap.swaps ||
        (gap.swaps === bestGap.swaps && load.get(live[i].id)! < load.get(bestRoom.id)!)
      ) {
        bestRoom = live[i];
        bestGap = gap;
      }
    }
    const a: Assignment = {
      orderId: order.id,
      roomId: bestRoom.id,
      status: "swap",
      swaps: bestGap.swaps,
      missing: bestGap.missing,
    };
    assignments.push(a);
    byRoom[bestRoom.id].push(a);
    load.set(bestRoom.id, load.get(bestRoom.id)! + 1);
    swap++;
  }

  return {
    assignments,
    byRoom,
    review,
    stats: {
      orders: orders.length,
      routable,
      changeFree,
      swap,
      review: review.length,
      changeFreeShare: routable > 0 ? changeFree / routable : 0,
    },
  };
}

/**
 * The room loadouts implied by a solved fleet — what routeOrders consumes.
 * Only active rooms with at least one threaded head count; a switched-off room
 * can't be handed work.
 */
export function roomLoadoutsFromFleet(fleet: {
  rooms: { id: string; name: string; active: boolean; machines: { id: string; active: boolean; slots: number[] }[] }[] | null;
}): RoomLoadout[] {
  if (!fleet.rooms) return [];
  return fleet.rooms
    .filter((r) => r.active)
    .map((r) => ({
      id: r.id,
      name: r.name,
      heads: r.machines
        .filter((m) => m.active && m.slots.length > 0)
        .map((m) => ({ id: m.id, slots: m.slots })),
    }))
    .filter((r) => r.heads.length > 0);
}
