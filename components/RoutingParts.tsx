import { getThreadBySlot, rgbToHex } from "@/lib/threadPalette";
import type { Fleet } from "@/lib/threadAllocation";
import type { QueueOrder } from "@/lib/websterQueue";
import type { Assignment } from "@/lib/orderRouting";

/**
 * Shared server-rendered pieces for the Webster day board and its room pages:
 * thread-color chips, order rows, per-room head strips. One rendering of an
 * order everywhere, so the board, the room lists, and the printouts can never
 * drift apart.
 */

export function Chip({ slot, size = "h-2.5 w-2.5" }: { slot: number; size?: string }) {
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

export function colorNames(slots: number[]): string {
  return slots
    .map((s) => getThreadBySlot(s)?.name)
    .filter(Boolean)
    .join(", ");
}

/** Order-received stamp in New York time, e.g. "Aug 8, 9:14 AM". */
export function fmtReceived(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}

export function StatusBadge({ a }: { a: Assignment }) {
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

export function OrderRow({
  order,
  a,
  showTime = false,
}: {
  order: QueueOrder;
  a: Assignment;
  showTime?: boolean;
}) {
  const stitchable = order.lines.filter((l) => !l.flag && l.slots.length > 0);
  const flagged = order.lines.filter((l) => l.flag);
  return (
    <div className="break-inside-avoid border-b border-cream-200/70 py-2 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-ui text-sm font-semibold tabular-nums text-espresso">{order.name}</span>
        {showTime && order.createdAt ? (
          <span className="font-ui text-[11px] tabular-nums text-ink-muted">received {fmtReceived(order.createdAt)}</span>
        ) : null}
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

export function HeadStrip({ fleet, roomId }: { fleet: Fleet; roomId: string }) {
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
