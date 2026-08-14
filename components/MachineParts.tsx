"use client";

import { getThreadBySlot, rgbToHex } from "@/lib/threadPalette";
import type { Machine } from "@/lib/threadAllocation";

/**
 * The pieces both the fleet page and the isolated room page draw: the spool
 * diagram, the needle table, and the little status pills. Spool color is the
 * thread itself; the number inside is its color-menu #.
 */

type Pt = [number, number];
type Layout = { w: number; h: number; r: number; widthClass: string };

const MELCO: Layout = { w: 680, h: 380, r: 32, widthClass: "w-[21rem]" };
const BARUDAN: Layout = { w: 420, h: 470, r: 27, widthClass: "w-[13rem]" };

// Needle -> (x, y) within the SVG viewBox. Needle 1 = most-popular color.
const MELCO_POS: Record<number, Pt> = {
  16: [90, 190], 13: [190, 190], 10: [290, 190], 7: [390, 190], 4: [490, 190], 1: [590, 190],
  14: [140, 85], 11: [240, 85], 8: [340, 85], 5: [440, 85], 2: [540, 85],
  15: [140, 295], 12: [240, 295], 9: [340, 295], 6: [440, 295], 3: [540, 295],
};
const BARUDAN_POS: Record<number, Pt> = {
  1: [85, 65], 2: [85, 235], 3: [85, 405],
  4: [135, 150], 5: [135, 320],
  6: [185, 65], 7: [185, 235], 8: [185, 405],
  9: [235, 150], 10: [235, 320],
  11: [285, 65], 12: [285, 235], 13: [285, 405],
  14: [335, 150], 15: [335, 320],
};

export function isMelco(needleCount: number) {
  return needleCount === 16;
}
function layoutFor(needleCount: number): Layout {
  return isMelco(needleCount) ? MELCO : BARUDAN;
}
function posFor(needleCount: number): Record<number, Pt> {
  return isMelco(needleCount) ? MELCO_POS : BARUDAN_POS;
}

function textOn(rgb: [number, number, number]): string {
  const [r, g, b] = rgb;
  return 0.299 * r + 0.587 * g + 0.114 * b > 140 ? "#1b1b1b" : "#ffffff";
}

export function pct(x: number): number {
  return Math.round(x * 100);
}

export function Swatch({ rgb }: { rgb: [number, number, number] }) {
  return (
    <span
      className="inline-block h-3 w-3 flex-none rounded-[3px] ring-1 ring-black/10"
      style={{ backgroundColor: rgbToHex(rgb) }}
    />
  );
}

/** Colored spool diagram for one head. No spool outline, by request. */
export function ThreadTree({
  machine,
  needleCount,
  widthClass,
}: {
  machine: Machine;
  needleCount: number;
  widthClass?: string;
}) {
  const layout = layoutFor(needleCount);
  const pos = posFor(needleCount);
  const needles = Object.keys(pos)
    .map(Number)
    .sort((a, b) => a - b);
  return (
    // `max-w-full` is only a guard for the DEFAULT width. Appending it to a
    // caller-supplied widthClass silently beat any max-w-* in that class —
    // Tailwind emits .max-w-full after .max-w-[Nrem], so the last one wins and
    // the diagram grew to fill its container.
    <div className={`${widthClass ?? `${layout.widthClass} max-w-full`} flex-none`}>
      <svg
        viewBox={`0 0 ${layout.w} ${layout.h}`}
        className="block h-auto w-full"
        role="img"
        aria-label={`${machine.name} spool layout`}
      >
        <rect x={6} y={6} width={layout.w - 12} height={layout.h - 12} rx={34} fill="#CFC8BE" />
        {needles.map((n) => {
          const slot = machine.slots[n - 1];
          const p = pos[n];
          const color = getThreadBySlot(slot);
          if (!p || !color) return null;
          const [x, y] = p;
          return (
            <g key={n}>
              <title>{`Needle ${n} — ${color.name} (menu #${slot})`}</title>
              <circle cx={x} cy={y} r={layout.r} fill={rgbToHex(color.rgb)} />
              <text
                x={x}
                y={y}
                dy=".34em"
                textAnchor="middle"
                fontSize={Math.round(layout.r * 0.82)}
                fontWeight={700}
                fill={textOn(color.rgb)}
                style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}
              >
                {slot}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function NeedleTable({ machine, needleCount }: { machine: Machine; needleCount: number }) {
  const needles = Array.from({ length: needleCount }, (_, i) => i + 1);
  return (
    <table className="font-ui min-w-[11rem] flex-1 border-collapse self-start text-[12.5px]">
      <thead>
        <tr className="text-ink-muted">
          <th className="border-b border-cream-200 py-1 pr-3 text-left font-semibold">Needle</th>
          <th className="border-b border-cream-200 py-1 pr-3 text-left font-semibold">#</th>
          <th className="border-b border-cream-200 py-1 text-left font-semibold">Color</th>
        </tr>
      </thead>
      <tbody>
        {needles.map((n) => {
          const slot = machine.slots[n - 1];
          const color = getThreadBySlot(slot);
          return (
            <tr key={n}>
              <td className="border-b border-cream-200/70 py-1 pr-3 tabular-nums text-ink-soft">{n}</td>
              <td className="border-b border-cream-200/70 py-1 pr-3 tabular-nums text-ink-soft">
                {color ? slot : "—"}
              </td>
              <td className="border-b border-cream-200/70 py-1">
                <span className="flex items-center gap-1.5">
                  {color ? <Swatch rgb={color.rgb} /> : null}
                  <span className="text-espresso">{color ? color.name : "—"}</span>
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** Compact horizontal strip of a head's loaded colors — for room overviews,
 * where 25 full diagrams would be unreadable. */
export function ColorStrip({ slots }: { slots: number[] }) {
  if (!slots.length) {
    return <div className="h-2 w-full rounded-full bg-cream-200" aria-hidden />;
  }
  return (
    <div className="flex h-2 w-full overflow-hidden rounded-full ring-1 ring-black/5" aria-hidden>
      {slots.map((s, i) => {
        const color = getThreadBySlot(s);
        return (
          <span
            key={`${s}-${i}`}
            className="h-full flex-1"
            style={{ backgroundColor: color ? rgbToHex(color.rgb) : "#E6DDD2" }}
          />
        );
      })}
    </div>
  );
}

export function Tag({ off }: { off: boolean }) {
  return off ? (
    <span className="rounded-full bg-pink-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cherry">
      off-color
    </span>
  ) : (
    <span className="rounded-full bg-parchment px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
      standard
    </span>
  );
}

/** Clickable grid card. role=button (not <button>) so the table stays valid HTML. */
export function MachineCard({
  machine,
  needleCount,
  onOpen,
}: {
  machine: Machine;
  needleCount: number;
  onOpen: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      aria-label={`Open ${machine.name} full screen`}
      className="group relative cursor-pointer rounded-2xl border border-cream-200 bg-white p-4 transition-shadow hover:shadow-md focus-ring md:p-5"
    >
      <span className="font-ui pointer-events-none absolute right-3 top-3 rounded-full bg-parchment px-2 py-0.5 text-[10px] font-semibold text-ink-muted opacity-0 transition-opacity group-hover:opacity-100">
        Expand ⤢
      </span>
      <div className="mb-3 flex items-center gap-2">
        <h3 className="font-display text-lg text-espresso">{machine.name}</h3>
        <Tag off={machine.offColor} />
      </div>
      <div className="flex flex-wrap items-start gap-4 md:gap-6">
        <ThreadTree machine={machine} needleCount={needleCount} />
        <NeedleTable machine={machine} needleCount={needleCount} />
      </div>
    </div>
  );
}

/** Enlarged head shown inside the full-screen modal. */
export function MachineDetail({ machine, needleCount }: { machine: Machine; needleCount: number }) {
  const bigWidth = isMelco(needleCount) ? "w-full max-w-[40rem]" : "w-full max-w-[24rem]";
  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h2 className="font-display text-2xl text-espresso md:text-3xl">{machine.name}</h2>
        <Tag off={machine.offColor} />
      </div>
      <div className="flex flex-col items-start gap-6 lg:flex-row lg:gap-10">
        <ThreadTree machine={machine} needleCount={needleCount} widthClass={bigWidth} />
        <div className="w-full lg:w-auto">
          <NeedleTable machine={machine} needleCount={needleCount} />
        </div>
      </div>
    </div>
  );
}

/** Full-screen head modal. */
export function MachineModal({
  machine,
  needleCount,
  onClose,
}: {
  machine: Machine;
  needleCount: number;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={`${machine.name} details`}
      onClick={onClose}
    >
      <div
        className="relative max-h-[92vh] w-full max-w-4xl overflow-auto rounded-2xl border border-cream-200 bg-porcelain p-6 shadow-2xl md:p-8"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="font-ui absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-cream-200 bg-white text-ink-soft transition-colors hover:bg-pink-soft hover:text-cherry focus-ring"
        >
          ✕
        </button>
        <MachineDetail machine={machine} needleCount={needleCount} />
      </div>
    </div>
  );
}
