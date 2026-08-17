"use client";

import { useMemo, useState } from "react";
import type { CompositeDailySnapshot } from "@/lib/compositeDaily";
import {
  aggregateRange,
  compareRanges,
  formatRange,
  presetRange,
  shiftDate,
  PRESET_DAYS,
  PRESET_LABELS,
  PRESET_ORDER,
  TOP_N,
  type DateRange,
  type PresetKey,
  type RangeColor,
  type RankMove,
} from "@/lib/compositeRange";

/**
 * Range chart for the Composite Data page.
 *
 * Top: pick a range (1d / 1w / 1m / 3m / 6m / 9m / 12m / custom) and see all
 * 24 spools as a column chart — top 15 in their real thread color, the other
 * 9 faded. Bottom: compare any two ranges and see which colors entered or
 * left the top 15, and which rose or fell within it.
 *
 * All aggregation happens client-side over the sparse daily dataset, so
 * switching ranges and comparisons are instant.
 */

type RangePick = { preset: PresetKey; custom: DateRange };

export default function CompositeChartView({
  daily,
}: {
  daily: CompositeDailySnapshot;
}) {
  const anchorEnd = daily.maxDate ?? new Date().toISOString().slice(0, 10);
  const anchorStart = daily.minDate ?? anchorEnd;

  const defaultCustom: DateRange = {
    start: shiftDate(anchorEnd, -(PRESET_DAYS["1m"] - 1)),
    end: anchorEnd,
  };

  // Main chart range
  const [pick, setPick] = useState<RangePick>({
    preset: "1m",
    custom: defaultCustom,
  });

  // Comparison ranges — default: 1 month vs 3 months
  const [pickA, setPickA] = useState<RangePick>({
    preset: "1m",
    custom: defaultCustom,
  });
  const [pickB, setPickB] = useState<RangePick>({
    preset: "3m",
    custom: defaultCustom,
  });

  const resolve = (p: RangePick): DateRange =>
    p.preset === "custom" ? normalized(p.custom) : presetRange(p.preset, anchorEnd);

  const range = resolve(pick);
  const rangeA = resolve(pickA);
  const rangeB = resolve(pickB);

  const ranked = useMemo(
    () => aggregateRange(daily.days, range),
    [daily.days, range.start, range.end] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const rankedA = useMemo(
    () => aggregateRange(daily.days, rangeA),
    [daily.days, rangeA.start, rangeA.end] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const rankedB = useMemo(
    () => aggregateRange(daily.days, rangeB),
    [daily.days, rangeB.start, rangeB.end] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const comparison = useMemo(
    () => compareRanges(rankedA, rankedB),
    [rankedA, rankedB]
  );

  const totalUses = ranked.reduce((s, c) => s + c.total, 0);
  const hasDaily = daily.days.length > 0;

  if (!hasDaily) {
    return (
      <section className="mb-12">
        <SectionHeading />
        <p className="font-ui rounded-xl border border-parchment bg-white px-4 py-10 text-center text-sm text-ink-muted">
          No daily composite data yet. The next run of the order-stats action
          writes the &ldquo;COMPOSITE_DAILY&rdquo; tab and this chart lights up.
        </p>
      </section>
    );
  }

  return (
    <section className="mb-12">
      <SectionHeading />

      {/* Range picker */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div
          className="inline-flex flex-wrap rounded-full border border-parchment bg-white p-1"
          role="tablist"
          aria-label="Chart range"
        >
          {PRESET_ORDER.map((key) => (
            <PillButton
              key={key}
              active={pick.preset === key}
              onClick={() => setPick((p) => ({ ...p, preset: key }))}
            >
              {PRESET_LABELS[key]}
            </PillButton>
          ))}
          <PillButton
            active={pick.preset === "custom"}
            onClick={() => setPick((p) => ({ ...p, preset: "custom" }))}
          >
            Custom
          </PillButton>
        </div>
        {pick.preset === "custom" && (
          <CustomDates
            value={pick.custom}
            min={anchorStart}
            max={anchorEnd}
            onChange={(custom) => setPick((p) => ({ ...p, custom }))}
          />
        )}
      </div>

      <p className="font-ui mb-3 text-xs text-ink-muted">
        {formatRange(range)} · top {TOP_N} highlighted, other{" "}
        {ranked.length - TOP_N} faded · {totalUses.toLocaleString()} thread uses
      </p>

      <RangeChart ranked={ranked} />

      {/* ---------------- Comparison ---------------- */}
      <div className="mt-10">
        <h2 className="font-display text-2xl font-medium tracking-tight text-espresso">
          Compare ranges
        </h2>
        <p className="font-ui mt-1 text-xs text-ink-muted">
          Movement is read A → B: what changed in range B relative to range A.
        </p>

        <div className="mt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
          <RangeSelect
            label="Range A"
            pick={pickA}
            onChange={setPickA}
            min={anchorStart}
            max={anchorEnd}
          />
          <span className="font-ui pb-2 text-sm text-ink-muted">vs</span>
          <RangeSelect
            label="Range B"
            pick={pickB}
            onChange={setPickB}
            min={anchorStart}
            max={anchorEnd}
          />
        </div>

        <p className="font-ui mt-3 text-xs text-ink-muted">
          A: {formatRange(rangeA)} ({sumTotal(rankedA).toLocaleString()} uses) ·
          B: {formatRange(rangeB)} ({sumTotal(rankedB).toLocaleString()} uses)
        </p>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          <MoveCard
            title={`Entered top ${TOP_N}`}
            subtitle="In B's top 15, not A's"
            moves={comparison.entered}
            render={(m) => (
              <>
                <RankBadge muted>—</RankBadge>
                <Arrow />
                <RankBadge>#{m.rankB}</RankBadge>
              </>
            )}
            empty="Nothing entered."
          />
          <MoveCard
            title={`Dropped out of top ${TOP_N}`}
            subtitle="In A's top 15, not B's"
            moves={comparison.left}
            render={(m) => (
              <>
                <RankBadge>#{m.rankA}</RankBadge>
                <Arrow />
                <RankBadge muted>—</RankBadge>
              </>
            )}
            empty="Nothing dropped out."
          />
          <MoveCard
            title="Rose within top 15"
            moves={comparison.rose}
            render={(m) => (
              <>
                <RankBadge>#{m.rankA}</RankBadge>
                <Arrow />
                <RankBadge>#{m.rankB}</RankBadge>
                <span className="font-ui text-[11px] font-semibold text-emerald-700">
                  ▲{m.delta}
                </span>
              </>
            )}
            empty="No risers."
          />
          <MoveCard
            title="Fell within top 15"
            moves={comparison.fell}
            render={(m) => (
              <>
                <RankBadge>#{m.rankA}</RankBadge>
                <Arrow />
                <RankBadge>#{m.rankB}</RankBadge>
                <span className="font-ui text-[11px] font-semibold text-cherry">
                  ▼{Math.abs(m.delta)}
                </span>
              </>
            )}
            empty="No fallers."
          />
        </div>

        {comparison.steady.length > 0 && (
          <p className="font-ui mt-3 text-[11px] text-ink-muted">
            Held rank:{" "}
            {comparison.steady
              .map((m) => `${m.name} (#${m.rankB})`)
              .join(" · ")}
          </p>
        )}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Chart
// ---------------------------------------------------------------------------

function RangeChart({ ranked }: { ranked: RangeColor[] }) {
  const BAR_W = 26;
  const GAP = 10;
  const PAD_L = 40;
  const PAD_R = 8;
  const PAD_T = 18;
  const CHART_H = 240;
  const LABEL_H = 46;
  const width = PAD_L + ranked.length * (BAR_W + GAP) - GAP + PAD_R;
  const height = PAD_T + CHART_H + LABEL_H;
  const maxTotal = Math.max(1, ...ranked.map((c) => c.total));

  // Light y-axis: 0, half, max
  const ticks = [0, Math.round(maxTotal / 2), maxTotal];

  return (
    <div className="overflow-x-auto rounded-xl border border-parchment bg-white p-4">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        className="block"
        role="img"
        aria-label="Thread usage by spool for the selected range"
      >
        {ticks.map((t) => {
          const y = PAD_T + CHART_H - (t / maxTotal) * CHART_H;
          return (
            <g key={t}>
              <line
                x1={PAD_L - 4}
                x2={width - PAD_R}
                y1={y}
                y2={y}
                stroke="#432222"
                strokeOpacity={0.08}
              />
              <text
                x={PAD_L - 8}
                y={y + 3}
                textAnchor="end"
                fontSize="9"
                fill="#432222"
                fillOpacity={0.45}
              >
                {t.toLocaleString()}
              </text>
            </g>
          );
        })}

        {ranked.map((c, i) => {
          const isTop = i < TOP_N;
          const x = PAD_L + i * (BAR_W + GAP);
          const h = Math.max(
            c.total > 0 ? 2 : 0,
            (c.total / maxTotal) * CHART_H
          );
          const y = PAD_T + CHART_H - h;
          return (
            <g key={c.slot} opacity={isTop ? 1 : 0.28}>
              <title>
                {`#${i + 1} · Slot ${c.slot} ${c.name} (${c.code})\n` +
                  `${c.total.toLocaleString()} total — ${c.icons.toLocaleString()} icons, ` +
                  `${c.text.toLocaleString()} text`}
              </title>
              <rect
                x={x}
                y={y}
                width={BAR_W}
                height={h}
                rx={3}
                fill={c.hex}
                stroke="rgba(0,0,0,0.15)"
                strokeWidth={0.75}
              />
              {isTop && c.total > 0 && (
                <text
                  x={x + BAR_W / 2}
                  y={y - 4}
                  textAnchor="middle"
                  fontSize="8.5"
                  fill="#432222"
                  fillOpacity={0.75}
                >
                  {c.total.toLocaleString()}
                </text>
              )}
              {/* x labels: chip + slot number, rank under */}
              <circle
                cx={x + BAR_W / 2}
                cy={PAD_T + CHART_H + 12}
                r={5.5}
                fill={c.hex}
                stroke="rgba(0,0,0,0.18)"
                strokeWidth={0.75}
              />
              <text
                x={x + BAR_W / 2}
                y={PAD_T + CHART_H + 30}
                textAnchor="middle"
                fontSize="8.5"
                fill="#432222"
                fillOpacity={0.85}
                fontWeight={600}
              >
                {c.slot}
              </text>
              <text
                x={x + BAR_W / 2}
                y={PAD_T + CHART_H + 41}
                textAnchor="middle"
                fontSize="8"
                fill="#432222"
                fillOpacity={0.4}
              >
                #{i + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="font-ui mt-2 text-[11px] text-ink-muted">
        Bars are ranked left to right. Hover a bar for the icons / text split.
        Labels: slot number, then rank.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comparison UI bits
// ---------------------------------------------------------------------------

function MoveCard({
  title,
  subtitle,
  moves,
  render,
  empty,
}: {
  title: string;
  subtitle?: string;
  moves: RankMove[];
  render: (m: RankMove) => React.ReactNode;
  empty: string;
}) {
  return (
    <div className="rounded-xl border border-parchment bg-white p-4">
      <h3 className="font-ui text-xs font-semibold uppercase tracking-[0.12em] text-espresso">
        {title}
      </h3>
      {subtitle && (
        <p className="font-ui mt-0.5 text-[11px] text-ink-muted">{subtitle}</p>
      )}
      {moves.length === 0 ? (
        <p className="font-ui mt-3 text-xs text-ink-muted">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-1.5">
          {moves.map((m) => (
            <li key={m.slot} className="flex items-center gap-2">
              <span
                className="h-3.5 w-3.5 flex-none rounded-full ring-1 ring-black/10"
                style={{ backgroundColor: m.hex }}
                aria-hidden
              />
              <span className="font-ui min-w-0 flex-1 truncate text-xs">
                <span className="font-semibold text-espresso">{m.slot}</span>{" "}
                <span className="text-ink-soft">{m.name}</span>
              </span>
              <span className="font-ui flex items-center gap-1 text-xs tabular-nums text-ink-soft">
                {render(m)}
              </span>
              <span className="font-ui w-24 text-right text-[11px] tabular-nums text-ink-muted">
                {m.totalA.toLocaleString()} → {m.totalB.toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RangeSelect({
  label,
  pick,
  onChange,
  min,
  max,
}: {
  label: string;
  pick: RangePick;
  onChange: (p: RangePick) => void;
  min: string;
  max: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <label className="font-ui block">
        <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
          {label}
        </span>
        <select
          value={pick.preset}
          onChange={(e) =>
            onChange({ ...pick, preset: e.target.value as PresetKey })
          }
          className="font-ui rounded-lg border border-parchment bg-white px-3 py-1.5 text-xs text-espresso focus-ring"
        >
          {PRESET_ORDER.map((key) => (
            <option key={key} value={key}>
              {PRESET_LABELS[key]}
            </option>
          ))}
          <option value="custom">Custom</option>
        </select>
      </label>
      {pick.preset === "custom" && (
        <CustomDates
          value={pick.custom}
          min={min}
          max={max}
          onChange={(custom) => onChange({ ...pick, custom })}
        />
      )}
    </div>
  );
}

function CustomDates({
  value,
  min,
  max,
  onChange,
}: {
  value: DateRange;
  min: string;
  max: string;
  onChange: (r: DateRange) => void;
}) {
  return (
    <span className="font-ui inline-flex items-center gap-1.5 text-xs text-ink-soft">
      <input
        type="date"
        value={value.start}
        min={min}
        max={max}
        onChange={(e) => onChange({ ...value, start: e.target.value })}
        className="rounded-lg border border-parchment bg-white px-2 py-1.5 text-xs text-espresso focus-ring"
      />
      to
      <input
        type="date"
        value={value.end}
        min={min}
        max={max}
        onChange={(e) => onChange({ ...value, end: e.target.value })}
        className="rounded-lg border border-parchment bg-white px-2 py-1.5 text-xs text-espresso focus-ring"
      />
    </span>
  );
}

function PillButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`font-ui rounded-full px-3 py-1.5 text-xs font-semibold transition-colors focus-ring ${
        active ? "bg-berry text-porcelain" : "text-ink-soft hover:text-espresso"
      }`}
    >
      {children}
    </button>
  );
}

function RankBadge({
  children,
  muted,
}: {
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <span
      className={`inline-block min-w-[2rem] rounded-md px-1 py-0.5 text-center text-[11px] font-semibold ${
        muted ? "bg-parchment text-ink-muted" : "bg-pink-soft text-cherry"
      }`}
    >
      {children}
    </span>
  );
}

function Arrow() {
  return <span className="text-ink-muted">→</span>;
}

function SectionHeading() {
  return (
    <div className="mb-4">
      <h2 className="font-display text-2xl font-medium tracking-tight text-espresso">
        Usage by range
      </h2>
    </div>
  );
}

function sumTotal(ranked: RangeColor[]): number {
  return ranked.reduce((s, c) => s + c.total, 0);
}

function normalized(r: DateRange): DateRange {
  return r.start <= r.end ? r : { start: r.end, end: r.start };
}
