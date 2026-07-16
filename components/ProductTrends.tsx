"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ProductTrendsSnapshot, ColorRow, CatRow } from "@/lib/productTrends";
import type { UsageSnapshot, UsageType, UsageWindow } from "@/lib/usageStats";
import type { TrendsSnapshot, TrendItem } from "@/lib/trendStats";

type TabKey = "overview" | "ordered" | "products" | "forecast" | "seasonality";
type ChannelFilter = "all" | "web" | "pos";
type WindowChoice = 3 | 6 | 12 | 0; // 0 = all available months
type ChannelOk = (c: "web" | "pos") => boolean;

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "ordered", label: "What's ordered" },
  { key: "products", label: "Products" },
  { key: "forecast", label: "Forecast" },
  { key: "seasonality", label: "Seasonality" },
];

const CHANNELS: { key: ChannelFilter; label: string }[] = [
  { key: "all", label: "All DTC" },
  { key: "web", label: "Online" },
  { key: "pos", label: "In-store" },
];

const WINDOWS: { key: WindowChoice; label: string }[] = [
  { key: 3, label: "3 mo" },
  { key: 6, label: "6 mo" },
  { key: 12, label: "12 mo" },
  { key: 0, label: "All" },
];

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Best-effort swatch for common Abbode garment colors; unknown -> hollow chip. */
const GARMENT_HEX: Record<string, string> = {
  black: "#1A1A1A", noir: "#1E1E1E", white: "#F7F4EE", cloud: "#E7E4DC", linen: "#E7DFCF",
  blush: "#F2C9C4", pink: "#F2B2AE", bonbon: "#F0B7C4", cherry: "#9E2A2B", red: "#BF3333",
  burgundy: "#671E30", butter: "#F1E3A6", "dark yellow": "#C9A227", navy: "#26324D",
  blueberry: "#46588A", azure: "#7FB2D6", "light blue": "#A9C9E6", poolside: "#79C0C6",
  olive: "#7D6E35", sage: "#D1C68F", chocolate: "#4B3A2E", fig: "#6E5A6B", chartreuse: "#E7E57E",
  tusk: "#D8CFC0", bone: "#E9E2D4", oatmeal: "#DED4C0", stone: "#C9BFB0", chrome: "#C7C9CB",
};

type Ranked = { label: string; value: number };
type ColorGroup = { product: string; total: number; colors: Ranked[] };
type Riser = { label: string; recent: number; previous: number; delta: number; growth: number | null };
type Signal = { text: string; tone: "up" | "alert" | "spark" };
type MonthPoint = { month: string; units: number; orders: number };

function fmtMonth(m: string, withYear = false): string {
  const [y, mo] = m.split("-");
  const name = MONTH_NAMES[(parseInt(mo, 10) || 1) - 1] || mo;
  return withYear ? `${name} '${(y || "").slice(2)}` : name;
}

function pct(n: number): string {
  return `${n >= 0 ? "+" : ""}${Math.round(n)}%`;
}

// ---------------------------------------------------------------------------
// Pure aggregation helpers
// ---------------------------------------------------------------------------
function monthlyUnits(
  trends: ProductTrendsSnapshot,
  monthList: string[],
  channelOk: ChannelOk,
): MonthPoint[] {
  const byMonth = new Map<string, { units: number; orders: number }>();
  for (const m of monthList) byMonth.set(m, { units: 0, orders: 0 });
  for (const r of trends.timeseries) {
    if (!channelOk(r.channel)) continue;
    const e = byMonth.get(r.month);
    if (e) {
      e.units += r.units;
      e.orders += r.orders;
    }
  }
  return monthList.map((m) => {
    const e = byMonth.get(m) || { units: 0, orders: 0 };
    return { month: m, units: e.units, orders: e.orders };
  });
}

function rankBy<T extends { month: string; channel: "web" | "pos"; units: number }>(
  rows: T[],
  labelOf: (r: T) => string,
  monthSet: Set<string>,
  channelOk: ChannelOk,
): Ranked[] {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (!monthSet.has(r.month) || !channelOk(r.channel)) continue;
    const label = labelOf(r).trim();
    if (!label) continue;
    m.set(label, (m.get(label) || 0) + r.units);
  }
  return [...m.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
}

function risers(now: Ranked[], prev: Ranked[]): Riser[] {
  const prevMap = new Map(prev.map((p) => [p.label, p.value]));
  return now
    .map((n) => {
      const previous = prevMap.get(n.label) || 0;
      const delta = n.value - previous;
      const growth = previous > 0 ? (delta / previous) * 100 : null;
      return { label: n.label, recent: n.value, previous, delta, growth };
    })
    .sort((a, b) => b.delta - a.delta);
}

/** Group garment-color demand by product, each product's colors ranked by units. */
function groupColorsByProduct(
  rows: ColorRow[],
  monthSet: Set<string>,
  channelOk: ChannelOk,
): ColorGroup[] {
  const byProd = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (!monthSet.has(r.month) || !channelOk(r.channel)) continue;
    const product = (r.product || "").trim() || "Unspecified";
    const color = r.color.trim();
    if (!color) continue;
    let cm = byProd.get(product);
    if (!cm) {
      cm = new Map();
      byProd.set(product, cm);
    }
    cm.set(color, (cm.get(color) || 0) + r.units);
    totals.set(product, (totals.get(product) || 0) + r.units);
  }
  const groups: ColorGroup[] = [];
  for (const [product, cm] of byProd.entries()) {
    const colors = [...cm.entries()]
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);
    groups.push({ product, total: totals.get(product) || 0, colors });
  }
  return groups.sort((a, b) => b.total - a.total);
}

function topUsage(usage: UsageSnapshot, win: UsageWindow, type: UsageType, limit = 10): Ranked[] {
  const m = new Map<string, number>();
  for (const r of usage.rows) {
    if (r.window !== win || r.type !== type) continue;
    m.set(r.value, (m.get(r.value) || 0) + r.count);
  }
  return [...m.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value)
    .slice(0, limit);
}

function buildSignals(args: {
  volume: MonthPoint[];
  colorRisers: Riser[];
  cats: Ranked[];
  rising: TrendItem[];
  hasPrev: boolean;
}): Signal[] {
  const { volume, colorRisers, cats, rising, hasPrev } = args;
  const out: Signal[] = [];
  if (hasPrev && colorRisers.length && colorRisers[0].delta > 0) {
    const t = colorRisers[0];
    out.push({
      tone: "up",
      text: `${t.label} is the fastest-rising item color (${t.previous.toLocaleString()} → ${t.recent.toLocaleString()}${t.growth !== null ? `, ${pct(t.growth)}` : ""})`,
    });
  }
  if (cats.length) {
    out.push({ tone: "spark", text: `${cats[0].label} leads the product mix this window (${cats[0].value.toLocaleString()} units)` });
  }
  if (volume.length >= 2) {
    let peak = volume[0];
    for (const v of volume) if (v.units > peak.units) peak = v;
    out.push({ tone: "up", text: `Busiest month was ${fmtMonth(peak.month, true)} (${peak.units.toLocaleString()} units)` });
  }
  if (rising[0] && rising[0].delta > 0) {
    const t = rising[0];
    out.push({ tone: "spark", text: `${t.label} is the fastest-climbing icon lately (${t.previous.toLocaleString()} → ${t.recent.toLocaleString()})` });
  }
  return out.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function ProductTrends({
  trends,
  usage,
  momentum,
}: {
  trends: ProductTrendsSnapshot;
  usage: UsageSnapshot;
  momentum: TrendsSnapshot;
}) {
  const [tab, setTab] = useState<TabKey>("overview");
  const [jumpProduct, setJumpProduct] = useState<string | null>(null);
  const [channel, setChannel] = useState<ChannelFilter>("all");
  const [win, setWin] = useState<WindowChoice>(6);

  const months = trends.months;
  const hasVolume = trends.timeseries.length > 0;
  const channelOk: ChannelOk = (c) => channel === "all" || c === channel;

  const { sel, prev } = useMemo(() => {
    if (win <= 0 || win >= months.length) return { sel: months, prev: [] as string[] };
    return {
      sel: months.slice(-win),
      prev: months.slice(Math.max(0, months.length - 2 * win), months.length - win),
    };
  }, [months, win]);

  const selSet = useMemo(() => new Set(sel), [sel]);
  const prevSet = useMemo(() => new Set(prev), [prev]);

  const totals = useMemo(() => {
    let orders = 0, units = 0, pOrders = 0, pUnits = 0;
    for (const r of trends.timeseries) {
      if (!(channel === "all" || r.channel === channel)) continue;
      if (selSet.has(r.month)) {
        orders += r.orders;
        units += r.units;
      } else if (prevSet.has(r.month)) {
        pOrders += r.orders;
        pUnits += r.units;
      }
    }
    const ipo = orders ? units / orders : 0;
    const pIpo = pOrders ? pUnits / pOrders : 0;
    const growth = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
    return {
      orders,
      units,
      ipo,
      ordersGrowth: growth(orders, pOrders),
      unitsGrowth: growth(units, pUnits),
      ipoGrowth: growth(ipo, pIpo),
      hasPrev: prev.length > 0,
    };
  }, [trends.timeseries, selSet, prevSet, channel, prev.length]);

  const volume = useMemo(() => monthlyUnits(trends, sel, channelOk), [trends, sel, channel]);
  const seasonVolume = useMemo(() => monthlyUnits(trends, months, channelOk), [trends, months, channel]);

  const colors = useMemo(() => rankBy(trends.colors, (r) => r.color, selSet, channelOk), [trends.colors, selSet, channel]);
  const colorsPrev = useMemo(() => rankBy(trends.colors, (r) => r.color, prevSet, channelOk), [trends.colors, prevSet, channel]);
  const colorRisers = useMemo(() => risers(colors, colorsPrev), [colors, colorsPrev]);
  const colorsByProduct = useMemo(
    () => groupColorsByProduct(trends.colors, selSet, channelOk),
    [trends.colors, selSet, channel],
  );

  const cats = useMemo(() => rankBy(trends.categories, (r) => r.category, selSet, channelOk), [trends.categories, selSet, channel]);

  const useWin = useMemo<UsageWindow>(() => {
    const want: UsageWindow = win > 0 && win <= 3 ? "3mo" : win > 0 && win <= 6 ? "6mo" : "all";
    if (usage.windows.includes(want)) return want;
    if (usage.windows.includes("all")) return "all";
    return usage.windows[usage.windows.length - 1] ?? "all";
  }, [win, usage.windows]);

  const topIcons = useMemo(() => topUsage(usage, useWin, "icon"), [usage, useWin]);
  const topFonts = useMemo(() => topUsage(usage, useWin, "font"), [usage, useWin]);
  const topText = useMemo(() => topUsage(usage, useWin, "color"), [usage, useWin]);

  const rising = momentum.icons.filter((i) => i.delta > 0).slice(0, 6);
  const cooling = momentum.icons.filter((i) => i.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 4);

  const signals = useMemo(
    () => buildSignals({ volume, colorRisers, cats, rising, hasPrev: totals.hasPrev }),
    [volume, colorRisers, cats, rising, totals.hasPrev],
  );

  const nothingYet =
    !hasVolume && trends.colors.length === 0 && usage.rows.length === 0 && momentum.icons.length === 0;
  if (nothingYet) {
    return (
      <EmptyNote>
        No trend data yet. Run the order-stats script (it now also fills the
        &ldquo;TRENDS_TIMESERIES&rdquo;, &ldquo;TRENDS_ITEM_COLORS&rdquo; and
        &ldquo;TRENDS_CATEGORIES&rdquo; tabs), then this page populates within ~60s.
      </EmptyNote>
    );
  }

  return (
    <div>
      <TabNav
        tab={tab}
        onTab={(t) => {
          setJumpProduct(null);
          setTab(t);
        }}
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Toggle options={CHANNELS} value={channel} onChange={(v) => setChannel(v)} label="Channel" />
          {tab !== "forecast" && <Toggle options={WINDOWS} value={win} onChange={(v) => setWin(v)} label="Window" />}
        </div>
        <p className="font-ui text-xs text-ink-muted">
          {tab === "forecast"
            ? "range set below"
            : sel.length > 0
            ? `${fmtMonth(sel[0], true)} – ${fmtMonth(sel[sel.length - 1], true)}`
            : win === 0
              ? "all available months"
              : `last ${win} months`}
        </p>
      </div>

      {tab === "overview" && (
        <OverviewTab
          totals={totals}
          volume={volume}
          signals={signals}
          rising={rising}
          cooling={cooling}
          momentumLabel={momentum.windowLabel}
          hasVolume={hasVolume}
        />
      )}
      {tab === "ordered" && (
        <OrderedTab
          cats={cats}
          topIcons={topIcons}
          topFonts={topFonts}
          topText={topText}
          useWin={useWin}
          onProductSelect={(label) => {
            setJumpProduct(label);
            setTab("products");
          }}
        />
      )}
      {tab === "products" && (
        <ProductsTab
          byProduct={colorsByProduct}
          colorRows={trends.colors}
          catRows={trends.categories}
          monthList={sel}
          prevList={prev}
          channel={channel}
          initialProduct={jumpProduct}
        />
      )}
      {tab === "forecast" && (
        <ForecastTab catRows={trends.categories} colorRows={trends.colors} months={months} channel={channel} />
      )}
      {tab === "seasonality" && <SeasonalityTab seasonVolume={seasonVolume} months={months} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab bodies
// ---------------------------------------------------------------------------
function OverviewTab({
  totals,
  volume,
  signals,
  rising,
  cooling,
  momentumLabel,
  hasVolume,
}: {
  totals: {
    orders: number;
    units: number;
    ipo: number;
    ordersGrowth: number | null;
    unitsGrowth: number | null;
    ipoGrowth: number | null;
    hasPrev: boolean;
  };
  volume: MonthPoint[];
  signals: Signal[];
  rising: TrendItem[];
  cooling: TrendItem[];
  momentumLabel: string;
  hasVolume: boolean;
}) {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Orders" value={totals.orders.toLocaleString()} growth={totals.hasPrev ? totals.ordersGrowth : undefined} sub={!totals.hasPrev ? "this window" : undefined} />
        <StatTile label="Units" value={totals.units.toLocaleString()} growth={totals.hasPrev ? totals.unitsGrowth : undefined} sub={!totals.hasPrev ? "line items" : undefined} />
        <StatTile label="Items / order" value={totals.ipo ? totals.ipo.toFixed(2) : "—"} growth={totals.hasPrev ? totals.ipoGrowth : undefined} sub={!totals.hasPrev ? "avg basket" : undefined} />
        <StatTile label="Active months" value={String(volume.length)} sub="in window" />
      </div>

      {hasVolume ? (
        <Card eyebrow="Volume" title="Orders over time" meta="units per month">
          <VolumeBars data={volume} />
        </Card>
      ) : (
        <EmptyNote>
          Run the updated order-stats script to populate volume, colors, and seasonality. The{" "}
          <span className="font-semibold">What&rsquo;s ordered</span> tab already works from existing data.
        </EmptyNote>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card eyebrow="Signals" title="What stands out">
          <Signals signals={signals} />
        </Card>
        <Card eyebrow="Momentum" title="Top movers" meta={momentumLabel || "recent vs prior"}>
          {rising.length === 0 && cooling.length === 0 ? (
            <p className="font-ui px-4 py-8 text-center text-xs text-ink-muted">No movement data yet.</p>
          ) : (
            <div className="px-4 py-3">
              <p className="font-ui mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-berry">Rising</p>
              <MoverRows items={rising} rising />
              {cooling.length > 0 && (
                <>
                  <p className="font-ui mb-1.5 mt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-muted">Cooling</p>
                  <MoverRows items={cooling} />
                </>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function OrderedTab({
  cats,
  topIcons,
  topFonts,
  topText,
  useWin,
  onProductSelect,
}: {
  cats: Ranked[];
  topIcons: Ranked[];
  topFonts: Ranked[];
  topText: Ranked[];
  useWin: UsageWindow;
  onProductSelect: (label: string) => void;
}) {
  const winLabel = useWin === "3mo" ? "last 3 months" : useWin === "6mo" ? "last 6 months" : "all time";
  const hasUsage = topIcons.length + topFonts.length + topText.length > 0;
  return (
    <div className="space-y-6">
      <Card eyebrow="Product mix" title="Products & designs ordered" meta="click a product for colors & volume">
        <RankedList items={cats} unit="units" limit={12} onSelect={onProductSelect} />
      </Card>
      {hasUsage ? (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card eyebrow="Icons" title="Most chosen" meta={winLabel}>
            <RankedList items={topIcons} unit="picks" limit={10} />
          </Card>
          <Card eyebrow="Fonts" title="Most chosen" meta={winLabel}>
            <RankedList items={topFonts} unit="picks" limit={10} />
          </Card>
          <Card eyebrow="Text colors" title="Most chosen" meta={winLabel}>
            <RankedList items={topText} unit="picks" limit={10} />
          </Card>
        </div>
      ) : (
        <EmptyNote>No product-usage data found. Run the order-stats script to populate icon, font, and text-color picks.</EmptyNote>
      )}
      <p className="font-ui text-[11px] leading-relaxed text-ink-muted">
        Product mix counts line items by base product (online + in-store). Icon, font, and text-color picks come from
        customized online orders.
      </p>
    </div>
  );
}

type TrendRowT = {
  label: string;
  value: number;
  share: number;
  previous: number;
  delta: number;
  growth: number | null;
  spark: number[];
  preview?: (string | null)[];
  swatch?: string | null;
};

/** Tiny inline trend line — the shape is the "why" (seasonal, growing, dying). */
function Spark({ values }: { values: number[] }) {
  if (values.length < 2) return null;
  const max = Math.max(1, ...values);
  const w = 64;
  const h = 22;
  const step = w / (values.length - 1);
  const pts = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`)
    .join(" ");
  const flat = values.every((v) => v === 0);
  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="hidden flex-none sm:block" aria-hidden>
      <polyline
        points={pts}
        fill="none"
        stroke={flat ? "rgba(67,34,34,0.18)" : "#BB3767"}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DeltaChip({ growth, delta }: { growth: number | null; delta: number }) {
  if (delta === 0) return <span className="font-ui text-[11px] tabular-nums text-ink-muted">&ndash;</span>;
  if (growth === null) return <span className="font-ui text-[11px] font-semibold text-cherry">new</span>;
  const up = growth >= 0;
  return (
    <span className={`font-ui text-[11px] font-semibold tabular-nums ${up ? "text-cherry" : "text-ink-muted"}`}>
      {up ? "\u25B2" : "\u25BC"} {Math.abs(growth).toFixed(0)}%
    </span>
  );
}

function SignalTile({
  label,
  value,
  sub,
  swatch,
}: {
  label: string;
  value: string;
  sub?: string;
  swatch?: string | null;
}) {
  return (
    <div className="rounded-xl border border-parchment bg-white p-4">
      <p className="font-ui text-xs text-ink-soft">{label}</p>
      <p className="font-display mt-1 flex items-center gap-2 text-base text-espresso">
        {swatch !== undefined && (
          <span
            className="h-3 w-3 flex-none rounded-full ring-1 ring-black/10"
            style={swatch ? { backgroundColor: swatch } : { boxShadow: "inset 0 0 0 1px rgba(67,34,34,0.25)" }}
            aria-hidden
          />
        )}
        <span className="truncate">{value}</span>
      </p>
      <p className="font-ui mt-1 text-[11px] tabular-nums text-ink-muted">{sub || "\u00a0"}</p>
    </div>
  );
}

/** One ranked row style for products and colors: name → sparkline → units + momentum. */
function TrendRows({
  items,
  unit = "units",
  onSelect,
  showDelta,
}: {
  items: TrendRowT[];
  unit?: string;
  onSelect?: (label: string) => void;
  showDelta: boolean;
}) {
  if (items.length === 0) {
    return <p className="font-ui px-4 py-8 text-center text-xs text-ink-muted">Nothing here in this window.</p>;
  }
  return (
    <ul>
      {items.map((it, idx) => {
        const inner = (
          <>
            <span className="font-ui w-5 flex-none text-right text-xs tabular-nums text-ink-muted">{idx + 1}</span>
            {it.swatch !== undefined && (
              <span
                className="h-3.5 w-3.5 flex-none rounded-full ring-1 ring-black/10"
                style={it.swatch ? { backgroundColor: it.swatch } : { boxShadow: "inset 0 0 0 1px rgba(67,34,34,0.25)" }}
                aria-hidden
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="font-ui truncate text-xs font-semibold text-espresso">{it.label}</span>
                {it.preview && it.preview.length > 0 && (
                  <span className="flex flex-none items-center gap-1" aria-hidden>
                    {it.preview.map((hex, i) => (
                      <span
                        key={i}
                        className="h-2.5 w-2.5 rounded-full ring-1 ring-black/10"
                        style={hex ? { backgroundColor: hex } : { boxShadow: "inset 0 0 0 1px rgba(67,34,34,0.25)" }}
                      />
                    ))}
                  </span>
                )}
              </span>
              <span className="font-ui mt-0.5 block text-[11px] tabular-nums text-ink-muted">
                {it.share.toFixed(0)}% of {unit} this window
              </span>
            </span>
            <Spark values={it.spark} />
            <span className="w-16 flex-none text-right">
              <span className="font-ui block text-xs font-semibold tabular-nums text-espresso">
                {it.value.toLocaleString()}
              </span>
              {showDelta && (
                <span className="block">
                  <DeltaChip growth={it.growth} delta={it.delta} />
                </span>
              )}
            </span>
            {onSelect && (
              <span className="font-ui flex-none text-sm text-ink-muted" aria-hidden>
                &rsaquo;
              </span>
            )}
          </>
        );
        return (
          <li key={`${it.label}-${idx}`} className="border-b border-parchment/60 last:border-b-0">
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(it.label)}
                className="focus-ring flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-pink-soft/30"
              >
                {inner}
              </button>
            ) : (
              <div className="flex items-center gap-3 px-4 py-2.5">{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MiniBars({ points }: { points: { month: string; units: number }[] }) {
  const max = Math.max(1, ...points.map((p) => p.units));
  return (
    <div className="flex items-stretch gap-1.5 px-4 py-4" style={{ height: 130 }}>
      {points.map((p) => (
        <div
          key={p.month}
          className="flex flex-1 flex-col items-center gap-1"
          title={`${fmtMonth(p.month, true)} · ${p.units.toLocaleString()} units`}
        >
          <div className="flex w-full flex-1 items-end">
            <span className="w-full rounded-t bg-berry" style={{ height: `${Math.max(2, (p.units / max) * 100)}%` }} />
          </div>
          <span className="font-ui text-[10px] text-ink-muted">{fmtMonth(p.month)}</span>
        </div>
      ))}
    </div>
  );
}

function ColorSplitRows({
  items,
  deltas,
  showDelta,
}: {
  items: Ranked[];
  deltas: Map<string, { delta: number; growth: number | null }>;
  showDelta: boolean;
}) {
  const max = Math.max(1, ...items.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  return (
    <ul>
      {items.map((it, idx) => {
        const hex = GARMENT_HEX[it.label.toLowerCase()];
        const d = deltas.get(it.label);
        return (
          <li
            key={`${it.label}-${idx}`}
            className="flex items-center gap-3 border-b border-parchment/60 px-4 py-2.5 last:border-b-0"
          >
            <span
              className="h-3.5 w-3.5 flex-none rounded-full ring-1 ring-black/10"
              style={hex ? { backgroundColor: hex } : { boxShadow: "inset 0 0 0 1px rgba(67,34,34,0.25)" }}
              aria-hidden
            />
            <span className="min-w-0 flex-1">
              <span className="font-ui block truncate text-xs font-semibold text-espresso">{it.label}</span>
              <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-parchment">
                <span className="block h-full rounded-full bg-berry" style={{ width: `${Math.max((it.value / max) * 100, 2)}%` }} />
              </span>
            </span>
            <span className="w-20 flex-none text-right">
              <span className="font-ui block text-xs font-semibold tabular-nums text-espresso">
                {it.value.toLocaleString()} · {Math.round((it.value / total) * 100)}%
              </span>
              {showDelta && d && (
                <span className="block">
                  <DeltaChip growth={d.growth} delta={d.delta} />
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function ChannelSplitBlock({ web, pos }: { web: number; pos: number }) {
  const total = web + pos;
  if (!total) return null;
  const wp = Math.round((web / total) * 100);
  return (
    <div className="rounded-xl border border-parchment bg-white p-4">
      <p className="font-ui text-xs text-ink-soft">Channel</p>
      <div className="mt-2 flex h-2 w-full overflow-hidden rounded-full bg-parchment">
        <span className="h-full bg-berry" style={{ width: `${wp}%` }} />
        <span className="h-full" style={{ width: `${100 - wp}%`, backgroundColor: "#F2B2AE" }} />
      </div>
      <p className="font-ui mt-2 text-[11px] tabular-nums text-ink-muted">
        Online {wp}% · In-store {100 - wp}%
      </p>
    </div>
  );
}

function ProductsTab({
  byProduct,
  colorRows,
  catRows,
  monthList,
  prevList,
  channel,
  initialProduct = null,
}: {
  byProduct: ColorGroup[];
  colorRows: ColorRow[];
  catRows: CatRow[];
  monthList: string[];
  prevList: string[];
  channel: "all" | ColorRow["channel"];
  initialProduct?: string | null;
}) {
  const [view, setView] = useState<"products" | "colors">("products");
  const [selected, setSelected] = useState<string | null>(initialProduct);
  const [selectedColor, setSelectedColor] = useState<string | null>(null);

  const model = useMemo(() => {
    const monthSet = new Set(monthList);
    const prevSet = new Set(prevList);
    const chOk = (c: ColorRow["channel"]) => channel === "all" || c === channel;

    const groupMap = new Map<string, ColorGroup>();
    for (const g of byProduct) groupMap.set(g.product, g);
    const hasUnattached = groupMap.has("Unspecified");

    // True per-product volume (every non-noise line, colored or not) from the categories tab.
    const catCur = new Map<string, number>();
    const catPrev = new Map<string, number>();
    const catMonthly = new Map<string, Map<string, number>>();
    const catChan = new Map<string, { web: number; pos: number }>();
    for (const r of catRows) {
      const label = r.category.trim();
      if (!label) continue;
      if (monthSet.has(r.month)) {
        const ch = catChan.get(label) || { web: 0, pos: 0 };
        ch[r.channel] += r.units;
        catChan.set(label, ch);
      }
      if (!chOk(r.channel)) continue;
      if (monthSet.has(r.month)) {
        catCur.set(label, (catCur.get(label) || 0) + r.units);
        let mm = catMonthly.get(label);
        if (!mm) {
          mm = new Map();
          catMonthly.set(label, mm);
        }
        mm.set(r.month, (mm.get(r.month) || 0) + r.units);
      } else if (prevSet.has(r.month)) {
        catPrev.set(label, (catPrev.get(label) || 0) + r.units);
      }
    }

    // Color rows: per-product fallback series + per-product color momentum + cross-product colors.
    const colCur = new Map<string, number>();
    const colPrev = new Map<string, number>();
    const colMonthly = new Map<string, Map<string, number>>();
    const colChan = new Map<string, { web: number; pos: number }>();
    const prodColorPrev = new Map<string, Map<string, number>>();
    const colorCur = new Map<string, number>();
    const colorPrev = new Map<string, number>();
    const colorMonthlyAll = new Map<string, Map<string, number>>();
    const colorProds = new Map<string, Map<string, number>>();
    for (const r of colorRows) {
      const label = (r.product || "").trim() || "Unspecified";
      const color = r.color.trim();
      if (monthSet.has(r.month)) {
        const ch = colChan.get(label) || { web: 0, pos: 0 };
        ch[r.channel] += r.units;
        colChan.set(label, ch);
      }
      if (!chOk(r.channel)) continue;
      if (monthSet.has(r.month)) {
        colCur.set(label, (colCur.get(label) || 0) + r.units);
        let mm = colMonthly.get(label);
        if (!mm) {
          mm = new Map();
          colMonthly.set(label, mm);
        }
        mm.set(r.month, (mm.get(r.month) || 0) + r.units);
        if (color) {
          colorCur.set(color, (colorCur.get(color) || 0) + r.units);
          let cm = colorMonthlyAll.get(color);
          if (!cm) {
            cm = new Map();
            colorMonthlyAll.set(color, cm);
          }
          cm.set(r.month, (cm.get(r.month) || 0) + r.units);
          if (label !== "Unspecified") {
            let pm2 = colorProds.get(color);
            if (!pm2) {
              pm2 = new Map();
              colorProds.set(color, pm2);
            }
            pm2.set(label, (pm2.get(label) || 0) + r.units);
          }
        }
      } else if (prevSet.has(r.month)) {
        colPrev.set(label, (colPrev.get(label) || 0) + r.units);
        if (color) {
          colorPrev.set(color, (colorPrev.get(color) || 0) + r.units);
          let pm = prodColorPrev.get(label);
          if (!pm) {
            pm = new Map();
            prodColorPrev.set(label, pm);
          }
          pm.set(color, (pm.get(color) || 0) + r.units);
        }
      }
    }

    // Whether a product's numbers come from the categories tab or its color rows — keep cur/prev consistent.
    const fromCat = (label: string) => catCur.has(label) || catPrev.has(label);

    const labels = new Set<string>([...catCur.keys(), ...groupMap.keys()]);
    labels.delete("Unspecified");
    const totalCur =
      [...labels].reduce((s, l) => s + (fromCat(l) ? catCur.get(l) || 0 : colCur.get(l) || 0), 0) || 1;

    const products: TrendRowT[] = [...labels]
      .map((label) => {
        const cat = fromCat(label);
        const value = (cat ? catCur.get(label) : colCur.get(label)) || 0;
        const previous = (cat ? catPrev.get(label) : colPrev.get(label)) || 0;
        const mm = (cat ? catMonthly.get(label) : colMonthly.get(label)) || new Map<string, number>();
        const g = groupMap.get(label);
        return {
          label,
          value,
          share: (value / totalCur) * 100,
          previous,
          delta: value - previous,
          growth: previous > 0 ? ((value - previous) / previous) * 100 : null,
          spark: monthList.map((mo) => mm.get(mo) || 0),
          preview: g ? g.colors.slice(0, 5).map((c) => GARMENT_HEX[c.label.toLowerCase()] ?? null) : undefined,
        };
      })
      .filter((it) => it.value > 0)
      .sort((a, b) => b.value - a.value);

    const colorTotal = [...colorCur.values()].reduce((s, v) => s + v, 0) || 1;
    const colorItems: TrendRowT[] = [...colorCur.entries()]
      .map(([label, value]) => {
        const previous = colorPrev.get(label) || 0;
        const mm = colorMonthlyAll.get(label) || new Map<string, number>();
        return {
          label,
          value,
          share: (value / colorTotal) * 100,
          previous,
          delta: value - previous,
          growth: previous > 0 ? ((value - previous) / previous) * 100 : null,
          spark: monthList.map((mo) => mm.get(mo) || 0),
          swatch: GARMENT_HEX[label.toLowerCase()] ?? null,
        };
      })
      .sort((a, b) => b.value - a.value);

    const colorRiserList = risers(
      colorItems.map((c) => ({ label: c.label, value: c.value })),
      [...colorPrev.entries()].map(([label, value]) => ({ label, value })),
    );

    const hasPrev = prevList.length > 0;
    const bestRiser = (arr: TrendRowT[]) =>
      arr
        .filter((x) => x.previous > 0 && x.value >= 3 && (x.growth ?? 0) > 0)
        .sort((a, b) => (b.growth ?? 0) - (a.growth ?? 0))[0];

    return {
      groupMap,
      hasUnattached,
      products,
      colorItems,
      colorRiserList,
      hasPrev,
      totalCur,
      risingProduct: hasPrev ? bestRiser(products) : undefined,
      risingColor: hasPrev ? bestRiser(colorItems) : undefined,
      chanOf: (label: string) => (fromCat(label) ? catChan.get(label) : colChan.get(label)),
      monthlyOf: (label: string) =>
        (fromCat(label) ? catMonthly.get(label) : colMonthly.get(label)) || new Map<string, number>(),
      colorMonthlyOf: (label: string) => colorMonthlyAll.get(label) || new Map<string, number>(),
      colorProdsOf: (label: string) =>
        [...(colorProds.get(label) || new Map<string, number>()).entries()]
          .map(([l, v]) => ({ label: l, value: v }))
          .sort((a, b) => b.value - a.value),
      prodColorPrev,
    };
  }, [byProduct, colorRows, catRows, monthList, prevList, channel]);

  const {
    groupMap,
    hasUnattached,
    products,
    colorItems,
    colorRiserList,
    hasPrev,
    risingProduct,
    risingColor,
  } = model;

  const unattachedNote = hasUnattached ? (
    <p className="font-ui rounded-xl border border-parchment bg-pink-soft/40 px-4 py-3 text-[11px] leading-relaxed text-ink-soft">
      Some colors aren&rsquo;t attached to products yet — the sheet&rsquo;s color tab predates this update. Run{" "}
      <span className="font-semibold">Actions → Icon order stats</span> once and every product picks up its color split
      automatically.
    </p>
  ) : null;

  if (products.length === 0) {
    const flat = groupMap.get("Unspecified");
    if (flat) {
      return (
        <div className="space-y-6">
          {unattachedNote}
          <Card eyebrow="Garment colors" title="All products" meta={`${flat.total.toLocaleString()} units`}>
            <RankedList items={flat.colors} unit="units" showSwatch />
          </Card>
        </div>
      );
    }
    return (
      <EmptyNote>
        No product data yet. Run the order-stats workflow once — it fills the &ldquo;TRENDS_ITEM_COLORS&rdquo; and
        &ldquo;TRENDS_CATEGORIES&rdquo; tabs this page reads.
      </EmptyNote>
    );
  }

  // ----- Product detail -----
  const detail = selected ? products.find((p) => p.label === selected) : undefined;
  if (selected && detail) {
    const group = groupMap.get(selected) ?? null;
    const mm = model.monthlyOf(selected);
    const points = monthList.map((mo) => ({ month: mo, units: mm.get(mo) || 0 }));
    const activeMonths = points.filter((p) => p.units > 0).length;
    const top = group?.colors[0];
    const chan = channel === "all" ? model.chanOf(selected) : undefined;
    const deltas = new Map<string, { delta: number; growth: number | null }>();
    if (group) {
      const pm = model.prodColorPrev.get(selected);
      for (const c of group.colors) {
        const prevU = pm?.get(c.label) || 0;
        deltas.set(c.label, {
          delta: c.value - prevU,
          growth: prevU > 0 ? ((c.value - prevU) / prevU) * 100 : null,
        });
      }
    }
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => setSelected(null)}
          className="focus-ring font-ui inline-flex items-center gap-1.5 rounded text-xs font-semibold text-berry transition-colors hover:text-cherry"
        >
          <span aria-hidden>←</span> All products
        </button>
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="font-display text-xl text-espresso">{selected}</h3>
          {hasPrev && <DeltaChip growth={detail.growth} delta={detail.delta} />}
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Units"
            value={detail.value.toLocaleString()}
            growth={hasPrev ? detail.growth : undefined}
            sub="this window"
          />
          <StatTile label="Share of window" value={`${detail.share.toFixed(0)}%`} sub="of all units" />
          <StatTile
            label="Top color"
            value={top ? top.label : "—"}
            sub={top ? `${top.value.toLocaleString()} units` : "no color option"}
          />
          <StatTile label="Active months" value={String(activeMonths)} sub={`of ${monthList.length} in window`} />
        </div>
        {chan && <ChannelSplitBlock web={chan.web} pos={chan.pos} />}
        {monthList.length > 1 && (
          <Card eyebrow="Volume" title="Monthly units">
            <MiniBars points={points} />
          </Card>
        )}
        {group ? (
          <Card eyebrow="Color split" title="Colors" meta={`${group.total.toLocaleString()} units with a color`}>
            <ColorSplitRows items={group.colors} deltas={deltas} showDelta={hasPrev} />
          </Card>
        ) : (
          <Card eyebrow="Color split" title="Colors">
            <p className="font-ui px-4 py-6 text-xs text-ink-muted">
              {hasUnattached
                ? "Colors for this product aren\u2019t attached yet — run the order-stats workflow once."
                : "This product has no color option at checkout."}
            </p>
          </Card>
        )}
        <p className="font-ui text-[11px] leading-relaxed text-ink-muted">
          Momentum compares this window to the {prevList.length} months before it. Item color is the garment color chosen
          at checkout — distinct from thread or text colors. Swatches are approximate.
        </p>
      </div>
    );
  }

  // ----- Color detail -----
  const cDetail = selectedColor ? colorItems.find((c) => c.label === selectedColor) : undefined;
  if (selectedColor && cDetail) {
    const mm = model.colorMonthlyOf(selectedColor);
    const points = monthList.map((mo) => ({ month: mo, units: mm.get(mo) || 0 }));
    const activeMonths = points.filter((p) => p.units > 0).length;
    const prods = model.colorProdsOf(selectedColor);
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => setSelectedColor(null)}
          className="focus-ring font-ui inline-flex items-center gap-1.5 rounded text-xs font-semibold text-berry transition-colors hover:text-cherry"
        >
          <span aria-hidden>←</span> All colors
        </button>
        <div className="flex flex-wrap items-baseline gap-3">
          <h3 className="font-display flex items-center gap-2.5 text-xl text-espresso">
            <span
              className="h-4 w-4 flex-none rounded-full ring-1 ring-black/10"
              style={cDetail.swatch ? { backgroundColor: cDetail.swatch } : { boxShadow: "inset 0 0 0 1px rgba(67,34,34,0.25)" }}
              aria-hidden
            />
            {selectedColor}
          </h3>
          {hasPrev && <DeltaChip growth={cDetail.growth} delta={cDetail.delta} />}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatTile
            label="Color picks"
            value={cDetail.value.toLocaleString()}
            growth={hasPrev ? cDetail.growth : undefined}
            sub="this window"
          />
          <StatTile label="Share of picks" value={`${cDetail.share.toFixed(0)}%`} sub="of all color picks" />
          <StatTile label="Active months" value={String(activeMonths)} sub={`of ${monthList.length} in window`} />
        </div>
        {monthList.length > 1 && (
          <Card eyebrow="Popularity" title="Picks over time">
            <MiniBars points={points} />
          </Card>
        )}
        {prods.length > 0 && (
          <Card eyebrow="Sells on" title="Products" meta={`${prods.length} product${prods.length === 1 ? "" : "s"}`}>
            <RankedList items={prods} unit="units" limit={8} />
          </Card>
        )}
        <p className="font-ui text-[11px] leading-relaxed text-ink-muted">
          Momentum compares this window to the {prevList.length} months before it. Item color is the garment color chosen
          at checkout — distinct from thread or text colors. Swatches are approximate.
        </p>
      </div>
    );
  }

  // ----- Signals + list / color trends -----
  const topProduct = products[0];
  const topColor = colorItems[0];
  const signals: { label: string; value: string; sub?: string; swatch?: string | null }[] = [
    {
      label: "Top product",
      value: topProduct.label,
      sub: `${topProduct.value.toLocaleString()} units · ${topProduct.share.toFixed(0)}% of window`,
    },
  ];
  if (risingProduct) {
    signals.push({
      label: "Rising product",
      value: risingProduct.label,
      sub: `\u25B2 ${(risingProduct.growth ?? 0).toFixed(0)}% vs prior ${prevList.length} mo`,
    });
  } else if (topColor) {
    signals.push({
      label: "Top color",
      value: topColor.label,
      sub: `${topColor.value.toLocaleString()} units across products`,
      swatch: topColor.swatch,
    });
  }
  if (risingColor) {
    signals.push({
      label: "Rising color",
      value: risingColor.label,
      sub: `\u25B2 ${(risingColor.growth ?? 0).toFixed(0)}% vs prior ${prevList.length} mo`,
      swatch: risingColor.swatch,
    });
  } else if (signals.length < 3 && topColor && signals[1]?.label !== "Top color") {
    signals.push({
      label: "Top color",
      value: topColor.label,
      sub: `${topColor.value.toLocaleString()} units across products`,
      swatch: topColor.swatch,
    });
  }
  if (signals.length < 3) {
    signals.push({ label: "Products selling", value: String(products.length), sub: "this window" });
  }

  return (
    <div className="space-y-6">
      {unattachedNote}
      <div className="grid gap-4 sm:grid-cols-3">
        {signals.slice(0, 3).map((s) => (
          <SignalTile key={s.label} label={s.label} value={s.value} sub={s.sub} swatch={s.swatch} />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Toggle
          options={[
            { key: "products", label: "Products" },
            { key: "colors", label: "Color trends" },
          ]}
          value={view}
          onChange={(v) => setView(v)}
          label="Trends view"
        />
        <p className="font-ui text-[11px] text-ink-muted">
          {view === "products" ? "Click into a product for its colors & volume" : "Garment colors across all products"}
        </p>
      </div>

      {view === "products" ? (
        <Card eyebrow="Forecast" title="Products" meta="ranked by units this window">
          <TrendRows items={products} unit="units" onSelect={setSelected} showDelta={hasPrev} />
        </Card>
      ) : (
        <>
          {hasPrev && (
            <div className="grid gap-6 lg:grid-cols-2">
              <Card eyebrow="Colors" title="Gaining">
                <RiserRows items={colorRiserList.filter((r) => r.delta > 0).slice(0, 6)} rising />
              </Card>
              <Card eyebrow="Colors" title="Fading">
                <RiserRows
                  items={colorRiserList.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 6)}
                />
              </Card>
            </div>
          )}
          <Card eyebrow="Forecast" title="All colors" meta="click a color for its history">
            <TrendRows items={colorItems} unit="color picks" onSelect={setSelectedColor} showDelta={hasPrev} />
          </Card>
        </>
      )}

      <p className="font-ui text-[11px] leading-relaxed text-ink-muted">
        Sparklines show monthly units across the window — the shape is the story. {"\u25B2"}/{"\u25BC"} compare this
        window to the equal window before it.
      </p>
    </div>
  );
}

// ---------- Forecast pane: line chart with selectable series and projections ----------

const LINE_PALETTE = ["#BB3767", "#3D5A80", "#8A8A46", "#B87333", "#432222", "#5B8A72", "#671E30", "#6E6E6E"];

function nextMonths(last: string, n: number): string[] {
  const out: string[] = [];
  let y = parseInt(last.slice(0, 4), 10);
  let m = parseInt(last.slice(5, 7), 10);
  for (let i = 0; i < n; i++) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

/** Straight-line fit of the recent trend (last ≤6 points), projected `horizon` months, floored at 0. */
function projectLinear(vals: number[], horizon: number): number[] {
  const n = vals.length;
  if (n < 2) return [];
  const k = Math.min(n, 6);
  const ys = vals.slice(n - k);
  const mx = (k - 1) / 2;
  const my = ys.reduce((a, b) => a + b, 0) / k;
  let num = 0;
  let den = 0;
  for (let i = 0; i < k; i++) {
    num += (i - mx) * (ys[i] - my);
    den += (i - mx) * (i - mx);
  }
  const slope = den ? num / den : 0;
  const out: number[] = [];
  for (let h = 1; h <= horizon; h++) out.push(Math.max(0, my + slope * (k - 1 - mx + h)));
  return out;
}

function niceCeil(v: number): number {
  if (v <= 5) return 5;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) {
    if (v <= m * pow) return m * pow;
  }
  return 10 * pow;
}

function hexToRgb(h: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Pale garment colors (Butter, Cloud, Linen…) get blended toward espresso so the line reads on porcelain. */
function lineSafe(hex: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return hex;
  const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
  if (lum <= 0.72) return hex;
  const esp = [67, 34, 34];
  const t = 0.45;
  return `#${rgb.map((c, i) => Math.round(c * (1 - t) + esp[i] * t).toString(16).padStart(2, "0")).join("")}`;
}

type ChartSeries = { label: string; color: string; actual: number[]; projected: number[] };

function LineChart({
  series,
  axis,
  actualCount,
  hover,
  onHover,
}: {
  series: ChartSeries[];
  axis: string[];
  actualCount: number;
  hover: string | null;
  onHover: (label: string | null) => void;
}) {
  const W = 720;
  const H = 260;
  const padL = 40;
  const padR = 104;
  const padT = 12;
  const padB = 26;
  const maxVal = niceCeil(Math.max(1, ...series.flatMap((s) => [...s.actual, ...s.projected])));
  const x = (i: number) => padL + (i * (W - padL - padR)) / Math.max(1, axis.length - 1);
  const y = (v: number) => padT + (1 - v / maxVal) * (H - padT - padB);
  const labelEvery = axis.length > 10 ? 2 : 1;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxVal * f));
  const lastActualX = x(actualCount - 1);
  const endX = x(axis.length - 1);

  // End-of-line label positions, staggered so converging lines stay readable.
  const ends = series
    .map((s) => {
      const v = s.projected.length ? s.projected[s.projected.length - 1] : s.actual[s.actual.length - 1] ?? 0;
      return { label: s.label, color: s.color, y: y(v) };
    })
    .sort((a, b) => a.y - b.y);
  for (let i = 1; i < ends.length; i++) {
    if (ends[i].y - ends[i - 1].y < 11) ends[i].y = ends[i - 1].y + 11;
  }
  for (let i = ends.length - 1; i >= 0; i--) {
    const maxY = H - padB - 2 - (ends.length - 1 - i) * 11;
    if (ends[i].y > maxY) ends[i].y = maxY;
  }
  const endYof = new Map(ends.map((e) => [e.label, e.y]));

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-auto w-full"
      role="img"
      aria-label="Trend lines with projections"
      onPointerLeave={() => onHover(null)}
    >
      {axis.length > actualCount && (
        <>
          <rect x={lastActualX} y={padT} width={endX - lastActualX} height={H - padT - padB} fill="#FBE3E1" opacity="0.35" />
          <line x1={lastActualX} y1={padT} x2={lastActualX} y2={H - padB} stroke="#BB3767" strokeOpacity="0.35" strokeDasharray="3 4" />
        </>
      )}
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} y1={y(t)} x2={W - padR} y2={y(t)} stroke="#F5F0EB" />
          <text x={padL - 6} y={y(t) + 3} textAnchor="end" fontSize="9" fill="#A39A93">
            {t.toLocaleString()}
          </text>
        </g>
      ))}
      {axis.map((m, i) =>
        i % labelEvery === 0 ? (
          <text key={m} x={x(i)} y={H - 8} textAnchor="middle" fontSize="9" fill={i >= actualCount ? "#BB3767" : "#A39A93"}>
            {fmtMonth(m)}
          </text>
        ) : null,
      )}
      {series.map((s) => {
        const isHover = hover === s.label;
        const dim = hover !== null && !isHover;
        const solid = s.actual.map((v, i) => `${x(i)},${y(v)}`).join(" ");
        const projPts = s.projected.length
          ? [`${x(s.actual.length - 1)},${y(s.actual[s.actual.length - 1] ?? 0)}`]
              .concat(s.projected.map((v, j) => `${x(s.actual.length + j)},${y(v)}`))
              .join(" ")
          : "";
        const allPts = s.actual
          .map((v, i) => `${x(i)},${y(v)}`)
          .concat(s.projected.map((v, j) => `${x(s.actual.length + j)},${y(v)}`))
          .join(" ");
        const lw = isHover ? 3 : 2;
        return (
          <g key={s.label} opacity={dim ? 0.16 : 1} style={{ transition: "opacity 120ms" }}>
            {s.actual.length > 1 && (
              <>
                <polyline points={solid} fill="none" stroke="#432222" strokeOpacity="0.14" strokeWidth={lw + 1.5} strokeLinejoin="round" strokeLinecap="round" />
                <polyline points={solid} fill="none" stroke={s.color} strokeWidth={lw} strokeLinejoin="round" strokeLinecap="round" />
              </>
            )}
            {projPts && (
              <polyline
                points={projPts}
                fill="none"
                stroke={s.color}
                strokeWidth={lw}
                strokeDasharray="4 4"
                strokeOpacity="0.85"
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            )}
            {s.actual.map((v, i) => (
              <circle key={`a${i}`} cx={x(i)} cy={y(v)} r="2.6" fill={s.color} stroke="#FFFCF7" strokeWidth="1" onPointerEnter={() => onHover(s.label)}>
                <title>{`${s.label} — ${fmtMonth(axis[i], true)} · ${v.toLocaleString()} units`}</title>
              </circle>
            ))}
            {s.projected.map((v, j) => (
              <circle
                key={`p${j}`}
                cx={x(s.actual.length + j)}
                cy={y(v)}
                r="2.4"
                fill="#FFFCF7"
                stroke={s.color}
                strokeWidth="1.4"
                onPointerEnter={() => onHover(s.label)}
              >
                <title>{`${s.label} — ${fmtMonth(axis[s.actual.length + j], true)} · ~${Math.round(v).toLocaleString()} projected`}</title>
              </circle>
            ))}
            {/* invisible fat stroke: hover anywhere on the line to identify it */}
            <polyline
              points={allPts}
              fill="none"
              stroke="transparent"
              strokeWidth="14"
              style={{ pointerEvents: "stroke" }}
              onPointerEnter={() => onHover(s.label)}
            >
              <title>{s.label}</title>
            </polyline>
            <text
              x={endX + 6}
              y={(endYof.get(s.label) ?? padT) + 3}
              fontSize="9"
              fontWeight={isHover ? 700 : 600}
              fill={s.color}
              style={{ pointerEvents: "all", cursor: "default" }}
              onPointerEnter={() => onHover(s.label)}
            >
              {s.label.length > 17 ? `${s.label.slice(0, 16)}…` : s.label}
              <title>{s.label}</title>
            </text>
          </g>
        );
      })}
    </svg>
  );
}

type ForecastMode = "products" | "colors" | "productColors";

function ForecastTab({
  catRows,
  colorRows,
  months,
  channel,
}: {
  catRows: CatRow[];
  colorRows: ColorRow[];
  months: string[];
  channel: "all" | ColorRow["channel"];
}) {
  const [mode, setMode] = useState<ForecastMode>("products");
  const [granProduct, setGranProduct] = useState<string>("");
  const [fromM, setFromM] = useState<string>("");
  const [toM, setToM] = useState<string>("");
  const [picked, setPicked] = useState<string[] | null>(null); // null = auto top 5
  const [hover, setHover] = useState<string | null>(null);

  const chOk = (c: ColorRow["channel"]) => channel === "all" || c === channel;

  // Product options for the granular mode, ranked by total units.
  const productOptions = useMemo(() => {
    const totals = new Map<string, number>();
    for (const r of catRows) {
      const l = r.category.trim();
      if (l) totals.set(l, (totals.get(l) || 0) + r.units);
    }
    for (const r of colorRows) {
      const l = (r.product || "").trim();
      if (l && l !== "Unspecified" && !totals.has(l)) totals.set(l, (totals.get(l) || 0) + r.units);
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
  }, [catRows, colorRows]);

  const from = fromM || months[0] || "";
  const to = toM || months[months.length - 1] || "";
  const fromIdx = Math.max(0, months.indexOf(from));
  const toIdx = Math.min(months.length - 1, months.indexOf(to) === -1 ? months.length - 1 : months.indexOf(to));
  const rangeMonths = fromIdx <= toIdx ? months.slice(fromIdx, toIdx + 1) : months.slice(toIdx, fromIdx + 1);
  const granProd = granProduct || productOptions[0] || "";

  // Build monthly series for the chosen mode within the range.
  const built = useMemo(() => {
    const inRange = new Set(rangeMonths);
    const bucket = new Map<string, Map<string, number>>();
    const add = (label: string, month: string, units: number) => {
      let mm = bucket.get(label);
      if (!mm) {
        mm = new Map();
        bucket.set(label, mm);
      }
      mm.set(month, (mm.get(month) || 0) + units);
    };
    if (mode === "products") {
      for (const r of catRows) {
        const l = r.category.trim();
        if (l && inRange.has(r.month) && chOk(r.channel)) add(l, r.month, r.units);
      }
      // colors-only products (unmapped) still deserve a line
      const catLabels = new Set(bucket.keys());
      for (const r of colorRows) {
        const l = (r.product || "").trim();
        if (l && l !== "Unspecified" && !catLabels.has(l) && inRange.has(r.month) && chOk(r.channel)) {
          add(l, r.month, r.units);
        }
      }
    } else if (mode === "colors") {
      for (const r of colorRows) {
        const c = r.color.trim();
        if (c && inRange.has(r.month) && chOk(r.channel)) add(c, r.month, r.units);
      }
    } else {
      for (const r of colorRows) {
        const c = r.color.trim();
        const l = (r.product || "").trim();
        if (c && l === granProd && inRange.has(r.month) && chOk(r.channel)) add(c, r.month, r.units);
      }
    }
    const ranked = [...bucket.entries()]
      .map(([label, mm]) => ({
        label,
        total: rangeMonths.reduce((s, mo) => s + (mm.get(mo) || 0), 0),
        vals: rangeMonths.map((mo) => mm.get(mo) || 0),
      }))
      .filter((e) => e.total > 0)
      .sort((a, b) => b.total - a.total);
    return ranked;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, granProd, catRows, colorRows, rangeMonths.join(","), channel]);

  const candidates = built.slice(0, 10);
  const activeLabels = picked ?? candidates.slice(0, 5).map((c) => c.label);
  const shown = candidates.filter((c) => activeLabels.includes(c.label)).slice(0, 8);

  const HORIZON = 3;
  const canProject = rangeMonths.length >= 2;
  const axis = canProject ? [...rangeMonths, ...nextMonths(rangeMonths[rangeMonths.length - 1], HORIZON)] : rangeMonths;

  const series: ChartSeries[] = shown.map((c, i) => ({
    label: c.label,
    color:
      mode !== "products"
        ? lineSafe(GARMENT_HEX[c.label.toLowerCase()] ?? LINE_PALETTE[i % LINE_PALETTE.length])
        : LINE_PALETTE[i % LINE_PALETTE.length],
    actual: c.vals,
    projected: canProject ? projectLinear(c.vals, HORIZON) : [],
  }));

  const selCls =
    "focus-ring font-ui rounded-full border border-parchment bg-white px-3 py-1.5 text-xs text-espresso";

  if (months.length === 0) {
    return <EmptyNote>No monthly data yet. Run the order-stats workflow once to fill the trends tabs.</EmptyNote>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as ForecastMode);
            setPicked(null);
          }}
          className={selCls}
          aria-label="Series"
        >
          <option value="products">Products (overall)</option>
          <option value="colors">Colors (overall)</option>
          <option value="productColors">Colors of a product…</option>
        </select>
        {mode === "productColors" && (
          <select
            value={granProd}
            onChange={(e) => {
              setGranProduct(e.target.value);
              setPicked(null);
            }}
            className={selCls}
            aria-label="Product"
          >
            {productOptions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        )}
        <span className="font-ui text-xs text-ink-muted">from</span>
        <select value={from} onChange={(e) => setFromM(e.target.value)} className={selCls} aria-label="From month">
          {months.map((m) => (
            <option key={m} value={m}>
              {fmtMonth(m, true)}
            </option>
          ))}
        </select>
        <span className="font-ui text-xs text-ink-muted">to</span>
        <select value={to} onChange={(e) => setToM(e.target.value)} className={selCls} aria-label="To month">
          {months.map((m) => (
            <option key={m} value={m}>
              {fmtMonth(m, true)}
            </option>
          ))}
        </select>
      </div>

      {candidates.length === 0 ? (
        <EmptyNote>Nothing in this range for that selection — widen the range or switch series.</EmptyNote>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {candidates.map((c) => {
              const on = activeLabels.includes(c.label);
              const idx = shown.findIndex((s) => s.label === c.label);
              const dot =
                mode !== "products"
                  ? lineSafe(GARMENT_HEX[c.label.toLowerCase()] ?? LINE_PALETTE[Math.max(idx, 0) % LINE_PALETTE.length])
                  : LINE_PALETTE[Math.max(idx, 0) % LINE_PALETTE.length];
              return (
                <button
                  key={c.label}
                  type="button"
                  onMouseEnter={() => setHover(c.label)}
                  onMouseLeave={() => setHover(null)}
                  onClick={() => {
                    const next = on ? activeLabels.filter((l) => l !== c.label) : [...activeLabels, c.label];
                    setPicked(next);
                  }}
                  className={`focus-ring font-ui flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    on ? "border-espresso/30 bg-white text-espresso" : "border-parchment bg-porcelain text-ink-muted opacity-60"
                  }`}
                >
                  <span
                    className="h-2.5 w-2.5 flex-none rounded-full ring-1 ring-black/10"
                    style={{ backgroundColor: on ? dot : "#D8CFC7" }}
                    aria-hidden
                  />
                  {c.label}
                  <span className="tabular-nums text-ink-muted">{c.total.toLocaleString()}</span>
                </button>
              );
            })}
          </div>

          <Card
            eyebrow="Forecast"
            title="Units over time"
            meta={canProject ? `dotted = next ${HORIZON} months, projected` : "one month selected — no projection yet"}
          >
            <div className="px-4 py-4">
              <LineChart series={series} axis={axis} actualCount={rangeMonths.length} hover={hover} onHover={setHover} />
            </div>
          </Card>

          <p className="font-ui text-[11px] leading-relaxed text-ink-muted">
            Projections are a straight-line fit of the recent trend (up to the last 6 months), floored at zero — directional,
            not gospel. They sharpen as more months accrue{rangeMonths.length < 3 ? " — with this little history, treat them loosely" : ""}.
            Lines cap at 8 for readability; tap chips to swap lines in and out.
          </p>
        </>
      )}
    </div>
  );
}

function SeasonalityTab({ seasonVolume, months }: { seasonVolume: MonthPoint[]; months: string[] }) {
  if (seasonVolume.length === 0) {
    return <EmptyNote>No monthly data yet. Run the updated order-stats script; seasonality fills in as months accrue.</EmptyNote>;
  }
  const recent = seasonVolume.slice(-6);
  const mom = recent.map((v, i) => {
    const prev = i > 0 ? recent[i - 1].units : 0;
    const growth = prev > 0 ? ((v.units - prev) / prev) * 100 : null;
    return { ...v, growth };
  });
  const thin = months.length < 13;
  return (
    <div className="space-y-6">
      <Card eyebrow="Seasonality" title="Volume by month" meta={`${months.length} month${months.length === 1 ? "" : "s"} of data`}>
        <VolumeBars data={seasonVolume} height={150} />
      </Card>
      <Card eyebrow="Month over month" title="Recent momentum">
        <ul>
          {mom.map((m, i) => (
            <li key={m.month} className="flex items-center justify-between gap-3 border-b border-parchment/60 px-4 py-2.5 last:border-b-0">
              <span className="font-ui text-xs font-semibold text-espresso">{fmtMonth(m.month, true)}</span>
              <span className="font-ui flex items-center gap-3 text-xs tabular-nums">
                <span className="text-ink-soft">{m.units.toLocaleString()} units</span>
                {m.growth !== null && i > 0 ? (
                  <span className={m.growth >= 0 ? "text-cherry" : "text-ink-muted"}>{pct(m.growth)}</span>
                ) : (
                  <span className="text-ink-muted">—</span>
                )}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      {thin && (
        <p className="font-ui rounded-xl border border-parchment bg-pink-soft/40 px-4 py-3 text-[11px] leading-relaxed text-ink-soft">
          Year-over-year seasonality needs 13+ months of history. Shopify currently exposes only ~60 days of orders unless
          the <span className="font-semibold">read_all_orders</span> scope is approved for the app — once it is, and months
          accrue, this view fills in automatically with no code change.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared UI pieces (match TrendsView / UsageReport styling)
// ---------------------------------------------------------------------------
function TabNav({ tab, onTab }: { tab: TabKey; onTab: (t: TabKey) => void }) {
  return (
    <div className="mb-6 flex gap-5 overflow-x-auto border-b border-parchment scrollbar-hide" role="tablist" aria-label="Product trends views">
      {TABS.map((t) => {
        const active = t.key === tab;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onTab(t.key)}
            className={`font-ui -mb-px flex-none border-b-2 pb-2.5 text-sm transition-colors focus-ring ${
              active ? "border-berry font-semibold text-espresso" : "border-transparent text-ink-soft hover:text-espresso"
            }`}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="inline-flex rounded-full border border-parchment bg-white p-1" role="group" aria-label={label}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={String(o.key)}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.key)}
            className={`font-ui rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors focus-ring ${
              active ? "bg-berry text-porcelain" : "text-ink-soft hover:text-espresso"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Card({
  eyebrow,
  title,
  meta,
  children,
}: {
  eyebrow?: string;
  title: ReactNode;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-parchment bg-white">
      <div className="flex items-baseline justify-between gap-3 border-b border-parchment px-4 py-3">
        <div>
          {eyebrow && (
            <p className="font-ui text-[10px] font-semibold uppercase tracking-[0.16em] text-berry">{eyebrow}</p>
          )}
          <p className="font-display mt-0.5 text-base text-espresso">{title}</p>
        </div>
        {meta && <p className="font-ui flex-none text-[11px] text-ink-muted">{meta}</p>}
      </div>
      {children}
    </section>
  );
}

function StatTile({
  label,
  value,
  growth,
  sub,
}: {
  label: string;
  value: string;
  growth?: number | null;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-parchment bg-white p-4">
      <p className="font-ui text-xs text-ink-soft">{label}</p>
      <p className="font-display mt-1 text-2xl text-espresso tabular-nums">{value}</p>
      {growth !== undefined && growth !== null ? (
        <p className={`font-ui mt-1 text-[11px] tabular-nums ${growth >= 0 ? "text-cherry" : "text-ink-muted"}`}>
          {pct(growth)} vs prior
        </p>
      ) : (
        <p className="font-ui mt-1 text-[11px] text-ink-muted">{sub || "\u00a0"}</p>
      )}
    </div>
  );
}

function VolumeBars({ data, height = 120 }: { data: MonthPoint[]; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.units));
  return (
    <div className="flex items-stretch gap-1.5 px-4 py-4" style={{ height }}>
      {data.map((d) => {
        const h = Math.max(2, (d.units / max) * 100);
        return (
          <div
            key={d.month}
            className="flex flex-1 flex-col items-center gap-1"
            title={`${fmtMonth(d.month, true)} · ${d.units.toLocaleString()} units · ${d.orders.toLocaleString()} orders`}
          >
            <div className="flex w-full flex-1 items-end">
              <span className="w-full rounded-t bg-berry" style={{ height: `${h}%` }} />
            </div>
            <span className="font-ui text-[10px] text-ink-muted">{fmtMonth(d.month)}</span>
          </div>
        );
      })}
    </div>
  );
}

function RankedList({
  items,
  unit = "orders",
  showSwatch = false,
  limit,
  onSelect,
}: {
  items: Ranked[];
  unit?: string;
  showSwatch?: boolean;
  limit?: number;
  onSelect?: (label: string) => void;
}) {
  const shown = limit ? items.slice(0, limit) : items;
  const max = Math.max(1, ...shown.map((i) => i.value));
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  if (shown.length === 0) {
    return <p className="font-ui px-4 py-8 text-center text-xs text-ink-muted">Nothing here in this window.</p>;
  }
  return (
    <ul>
      {shown.map((it, idx) => {
        const fill = (it.value / max) * 100;
        const share = (it.value / total) * 100;
        const hex = showSwatch ? GARMENT_HEX[it.label.toLowerCase()] : undefined;
        const rowInner = (
          <>
            <span className="font-ui w-5 flex-none text-right text-xs tabular-nums text-ink-muted">{idx + 1}</span>
            {showSwatch && (
              <span
                className="h-3.5 w-3.5 flex-none rounded-full ring-1 ring-black/10"
                style={hex ? { backgroundColor: hex } : { boxShadow: "inset 0 0 0 1px rgba(67,34,34,0.25)" }}
                aria-hidden
              />
            )}
            <span className="min-w-0 flex-1">
              <span className="font-ui block truncate text-xs font-semibold text-espresso">{it.label}</span>
              <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-parchment">
                <span className="block h-full rounded-full bg-berry" style={{ width: `${Math.max(fill, 2)}%` }} />
              </span>
            </span>
            <span className="flex-none text-right">
              <span className="font-ui block text-xs font-semibold tabular-nums text-espresso">{it.value.toLocaleString()}</span>
              <span className="font-ui block text-[11px] tabular-nums text-ink-muted">
                {Math.round(share)}% · {unit}
              </span>
            </span>
            {onSelect && (
              <span className="font-ui flex-none text-sm text-ink-muted" aria-hidden>
                &rsaquo;
              </span>
            )}
          </>
        );
        return (
          <li key={`${it.label}-${idx}`} className="border-b border-parchment/60 last:border-b-0">
            {onSelect ? (
              <button
                type="button"
                onClick={() => onSelect(it.label)}
                className="focus-ring flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-pink-soft/30"
              >
                {rowInner}
              </button>
            ) : (
              <div className="flex items-center gap-3 px-4 py-2.5">{rowInner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function RiserRows({ items, rising = false }: { items: Riser[]; rising?: boolean }) {
  if (items.length === 0) {
    return (
      <p className="font-ui px-4 py-8 text-center text-xs text-ink-muted">
        Nothing {rising ? "gaining" : "fading"} this window.
      </p>
    );
  }
  return (
    <ul>
      {items.map((it, i) => {
        const hex = GARMENT_HEX[it.label.toLowerCase()];
        return (
          <li key={`${it.label}-${i}`} className="flex items-center gap-3 border-b border-parchment/60 px-4 py-2.5 last:border-b-0">
            <span
              className="h-3.5 w-3.5 flex-none rounded-full ring-1 ring-black/10"
              style={hex ? { backgroundColor: hex } : { boxShadow: "inset 0 0 0 1px rgba(67,34,34,0.25)" }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate font-ui text-xs font-semibold text-espresso">{it.label}</span>
            <span className="flex-none text-right">
              <span className={`font-ui block text-xs font-semibold tabular-nums ${rising ? "text-cherry" : "text-ink-soft"}`}>
                {it.delta > 0 ? "+" : ""}
                {it.delta.toLocaleString()}
              </span>
              <span className="font-ui block text-[11px] tabular-nums text-ink-muted">
                {it.previous.toLocaleString()} → {it.recent.toLocaleString()}
                {it.growth !== null ? ` · ${pct(it.growth)}` : ""}
              </span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MoverRows({ items, rising = false }: { items: TrendItem[]; rising?: boolean }) {
  return (
    <ul className="space-y-1">
      {items.map((it, i) => (
        <li key={`${it.label}-${i}`} className="flex items-center justify-between gap-2 text-xs">
          <span className="min-w-0 truncate font-ui text-espresso">{it.label}</span>
          <span className={`font-ui flex-none tabular-nums ${rising ? "text-cherry" : "text-ink-muted"}`}>
            {it.delta > 0 ? "+" : ""}
            {it.delta.toLocaleString()}
            {it.growthPct !== null ? ` · ${pct(it.growthPct)}` : it.isNew ? " · new" : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Signals({ signals }: { signals: Signal[] }) {
  if (signals.length === 0) {
    return (
      <p className="font-ui px-4 py-8 text-center text-xs text-ink-muted">
        Signals appear once there are two windows of data to compare.
      </p>
    );
  }
  const dot: Record<Signal["tone"], string> = { up: "bg-cherry", alert: "bg-tomato", spark: "bg-berry" };
  return (
    <ul className="px-4 py-2">
      {signals.map((s, i) => (
        <li key={i} className="flex items-start gap-2.5 py-2">
          <span className={`mt-1.5 h-2 w-2 flex-none rounded-full ${dot[s.tone]}`} aria-hidden />
          <span className="font-ui text-xs leading-relaxed text-ink-soft">{s.text}</span>
        </li>
      ))}
    </ul>
  );
}

function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <p className="font-ui rounded-xl border border-parchment bg-white px-4 py-10 text-center text-sm text-ink-muted">
      {children}
    </p>
  );
}
