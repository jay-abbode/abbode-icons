"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  computeAllocation,
  defaultOffSelection,
  FLEET_BASES,
  type Fleet,
  type FleetKey,
  type Job,
  type Machine,
  type MachineJobsMeta,
  type OffSelection,
} from "@/lib/threadAllocation";
import { getThreadBySlot, rgbToHex } from "@/lib/threadPalette";

/**
 * Machines view — one thread-tree diagram per embroidery head showing which
 * spool color sits on each needle. Spool color = the thread itself, the number
 * = its color-menu #, hovering a spool shows the color name. Click a machine to
 * open it full-screen. You can also choose which heads are off-color (default:
 * the last 1–2); loadouts and the change-free % recompute in the browser.
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

function isMelco(needleCount: number) {
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
function pct(x: number): number {
  return Math.round(x * 100);
}

function Swatch({ rgb }: { rgb: [number, number, number] }) {
  return (
    <span
      className="inline-block h-3 w-3 flex-none rounded-[3px] ring-1 ring-black/10"
      style={{ backgroundColor: rgbToHex(rgb) }}
    />
  );
}

/** Colored spool diagram for one machine. No spool outline by request. */
function ThreadTree({
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
    <div className={`${widthClass ?? layout.widthClass} max-w-full flex-none`}>
      <svg viewBox={`0 0 ${layout.w} ${layout.h}`} className="block h-auto w-full" role="img" aria-label={`${machine.name} spool layout`}>
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

function NeedleTable({ machine, needleCount }: { machine: Machine; needleCount: number }) {
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
              <td className="border-b border-cream-200/70 py-1 pr-3 tabular-nums text-ink-soft">{color ? slot : "—"}</td>
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

function Tag({ off }: { off: boolean }) {
  return off ? (
    <span className="rounded-full bg-pink-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cherry">off-color</span>
  ) : (
    <span className="rounded-full bg-parchment px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">standard</span>
  );
}

/** Clickable grid card. role=button (not <button>) so the table stays valid HTML. */
function MachineCard({ machine, needleCount, onOpen }: { machine: Machine; needleCount: number; onOpen: () => void }) {
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

/** Enlarged machine shown inside the full-screen modal. */
function MachineDetail({ machine, needleCount }: { machine: Machine; needleCount: number }) {
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

function OffColorControl({
  fleet,
  onToggle,
  defaultCount,
}: {
  fleet: Fleet;
  onToggle: (index: number) => void;
  defaultCount: number;
}) {
  return (
    <div className="mb-5 rounded-2xl border border-cream-200 bg-white px-4 py-3.5 md:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-ui text-sm font-semibold text-espresso">Off-color heads:</span>
        <div className="flex flex-wrap gap-1.5">
          {fleet.machines.map((m, i) => (
            <button
              key={`${m.name}-${i}`}
              type="button"
              onClick={() => onToggle(i)}
              aria-pressed={m.offColor}
              className={`font-ui rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus-ring ${
                m.offColor
                  ? "border-berry bg-pink-soft text-cherry"
                  : "border-cream-200 bg-white text-ink-muted hover:border-pink"
              }`}
            >
              {m.offColor ? "✓ " : ""}
              {m.name}
            </button>
          ))}
        </div>
      </div>
      <p className="font-ui mt-2 text-xs text-ink-muted">
        Off-color heads carry the rarer colors so the standard heads can stay loaded with the popular ones.
        Default is the last {defaultCount} {defaultCount === 1 ? "head" : "heads"} of this fleet.
      </p>
    </div>
  );
}

function MachineCountControl({
  countable,
  value,
  onChange,
  fleetLabel,
}: {
  countable: { min: number; max: number; default: number };
  value: number;
  onChange: (count: number) => void;
  fleetLabel: string;
}) {
  const options: number[] = [];
  for (let n = countable.min; n <= countable.max; n++) options.push(n);
  return (
    <div className="mb-5 rounded-2xl border border-cream-200 bg-white px-4 py-3.5 md:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor="machines-in-use" className="font-ui text-sm font-semibold text-espresso">
          Machines in use:
        </label>
        <select
          id="machines-in-use"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="font-ui rounded-lg border border-cream-200 bg-white px-3 py-1.5 text-sm font-semibold text-espresso focus-ring"
        >
          {options.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
      <p className="font-ui mt-2 text-xs text-ink-muted">
        Set how many {fleetLabel} heads are running today — the layout and change-free math update to match.
      </p>
    </div>
  );
}

function FleetSection({
  fleet,
  defaultCount,
  countable,
  machineCount,
  onCountChange,
  onToggleOff,
  onOpenMachine,
}: {
  fleet: Fleet;
  defaultCount: number;
  countable: { min: number; max: number; default: number } | null;
  machineCount: number | undefined;
  onCountChange: (count: number) => void;
  onToggleOff: (index: number) => void;
  onOpenMachine: (index: number) => void;
}) {
  const offCount = fleet.machines.filter((m) => m.offColor).length;
  const delta = pct(fleet.changeFreeAll) - pct(fleet.changeFreeStandard);

  return (
    <div>
      {/* Prominent change-free callout */}
      <div className="mb-5 rounded-2xl border border-cream-200 bg-white px-5 py-5 md:px-7 md:py-6">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-display text-5xl leading-none text-plum md:text-6xl">{pct(fleet.changeFreeAll)}%</span>
          <span className="font-ui text-base text-espresso md:text-lg">
            of orders run <strong>change-free</strong> — no spool swaps — across the {fleet.label} fleet
          </span>
        </div>
        <p className="font-ui mt-2 text-xs text-ink-muted md:text-[13px]">
          {pct(fleet.changeFreeStandard)}% on the {fleet.machines.length - offCount} standard{" "}
          {fleet.machines.length - offCount === 1 ? "head" : "heads"} alone
          {offCount > 0 && delta > 0 ? (
            <> · +{delta} points from the {offCount === 1 ? "off-color head" : `${offCount} off-color heads`}</>
          ) : null}
        </p>
      </div>

      {countable ? (
        <MachineCountControl
          countable={countable}
          value={machineCount ?? countable.default}
          onChange={onCountChange}
          fleetLabel={fleet.label}
        />
      ) : null}

      <OffColorControl fleet={fleet} onToggle={onToggleOff} defaultCount={defaultCount} />

      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {fleet.machines.map((m, i) => (
          <MachineCard key={`${m.name}-${i}`} machine={m} needleCount={fleet.needleCount} onOpen={() => onOpenMachine(i)} />
        ))}
      </div>
    </div>
  );
}

// Initial machine counts for countable fleets (Webster). Abbode is fixed.
const INITIAL_COUNTS: Partial<Record<FleetKey, number>> = Object.fromEntries(
  FLEET_BASES.filter((b) => b.countable).map((b) => [b.key, b.countable!.default])
);

export default function MachinesView({ jobs, meta }: { jobs: Job[]; meta: MachineJobsMeta }) {
  const [machineCounts, setMachineCounts] = useState<Partial<Record<FleetKey, number>>>(() => ({
    ...INITIAL_COUNTS,
  }));
  const [offSel, setOffSel] = useState<OffSelection>(() => defaultOffSelection(INITIAL_COUNTS));
  const [active, setActive] = useState<Fleet["key"]>("abbode");
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const result = useMemo(
    () => computeAllocation(jobs, offSel, meta, machineCounts),
    [jobs, offSel, meta, machineCounts]
  );
  const fleet = result.fleets.find((f) => f.key === active) ?? result.fleets[0];
  const defaultCounts: Record<string, number> = { abbode: 1, webster: 2 };
  const activeCountable = FLEET_BASES.find((b) => b.key === active)?.countable ?? null;

  // Close the modal on Escape; lock body scroll while it's open.
  useEffect(() => {
    if (openIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenIndex(null);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [openIndex]);

  function toggleOff(index: number) {
    setOffSel((prev) => {
      const cur = new Set(prev[active] ?? []);
      if (cur.has(index)) cur.delete(index);
      else cur.add(index);
      return { ...prev, [active]: [...cur].sort((a, b) => a - b) };
    });
  }

  function switchFleet(key: Fleet["key"]) {
    setOpenIndex(null);
    setActive(key);
  }

  // Change how many heads a countable fleet (Webster) is running today, and
  // reset its off-color heads to the sensible default for the new size.
  function setFleetCount(key: FleetKey, count: number) {
    setOpenIndex(null);
    setMachineCounts((prev) => ({ ...prev, [key]: count }));
    setOffSel((prev) => ({ ...prev, [key]: defaultOffSelection({ [key]: count })[key] ?? [] }));
  }

  const usingFallback = result.source && result.source !== "THREAD_STATS";
  const daysheetHref = `/machines/daysheet?ab=${encodeURIComponent(
    (offSel.abbode ?? []).join(",")
  )}&wb=${encodeURIComponent((offSel.webster ?? []).join(","))}&wbn=${encodeURIComponent(
    String(machineCounts.webster ?? "")
  )}`;

  const openMachine = fleet && openIndex !== null ? fleet.machines[openIndex] : null;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-espresso">Machine thread allocation</h1>
          <p className="font-ui mt-1 max-w-2xl text-sm text-ink-muted">
            Which spool colors to load on each head so the most orders stitch without a thread change. Spool color is
            the thread itself; the number is its color-menu #; hover a spool for the name; click a machine to enlarge it.
          </p>
        </div>
        <Link
          href={daysheetHref}
          className="font-ui rounded-full border border-parchment bg-white px-3.5 py-2 text-xs font-semibold text-espresso transition-colors hover:border-pink hover:bg-pink-soft focus-ring"
        >
          Print day sheet →
        </Link>
      </div>

      {/* Fleet toggle */}
      <div className="mb-6 inline-flex flex-wrap gap-1 rounded-full bg-parchment p-1">
        {result.fleets.map((f) => {
          const on = f.key === active;
          const offN = f.machines.filter((m) => m.offColor).length;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => switchFleet(f.key)}
              aria-pressed={on}
              className={`font-ui rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-ring ${
                on ? "bg-white text-espresso shadow-sm" : "text-ink-muted hover:text-espresso"
              }`}
            >
              {f.label} · {f.machines.length} × {f.needleCount}-needle
              <span className="ml-1 hidden font-normal text-ink-muted sm:inline">
                ({f.machines.length - offN} standard + {offN} off-color)
              </span>
            </button>
          );
        })}
      </div>

      {fleet ? (
        <FleetSection
          fleet={fleet}
          defaultCount={defaultCounts[fleet.key] ?? 1}
          countable={activeCountable}
          machineCount={machineCounts[fleet.key] ?? activeCountable?.default}
          onCountChange={(n) => setFleetCount(fleet.key, n)}
          onToggleOff={toggleOff}
          onOpenMachine={(i) => setOpenIndex(i)}
        />
      ) : null}

      <p className="font-ui mt-8 text-xs text-ink-muted">
        Based on {result.window || "recent"} of orders · {result.jobCount} designs
        {result.updatedAt ? ` · data updated ${result.updatedAt}` : ""}
        {usingFallback ? " · showing 12-month data until the 3-month feed runs" : ""}. Loadouts re-tune automatically as
        ordering shifts.
      </p>

      {/* Full-screen machine modal */}
      {openMachine && fleet ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/60 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-label={`${openMachine.name} details`}
          onClick={() => setOpenIndex(null)}
        >
          <div
            className="relative max-h-[92vh] w-full max-w-4xl overflow-auto rounded-2xl border border-cream-200 bg-porcelain p-6 shadow-2xl md:p-8"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setOpenIndex(null)}
              aria-label="Close"
              className="font-ui absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full border border-cream-200 bg-white text-ink-soft transition-colors hover:bg-pink-soft hover:text-cherry focus-ring"
            >
              ✕
            </button>
            <MachineDetail machine={openMachine} needleCount={fleet.needleCount} />
          </div>
        </div>
      ) : null}
    </div>
  );
}
