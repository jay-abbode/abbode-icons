"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { ProductTrendsSnapshot } from "@/lib/productTrends";
import type { UsageSnapshot, UsageType, UsageWindow } from "@/lib/usageStats";
import type { TrendsSnapshot, TrendItem } from "@/lib/trendStats";

type TabKey = "overview" | "ordered" | "colors" | "seasonality";
type ChannelFilter = "all" | "web" | "pos";
type WindowChoice = 3 | 6 | 12 | 0; // 0 = all available months
type ChannelOk = (c: "web" | "pos") => boolean;

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "ordered", label: "What's ordered" },
  { key: "colors", label: "Colors" },
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
      <TabNav tab={tab} onTab={setTab} />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Toggle options={CHANNELS} value={channel} onChange={(v) => setChannel(v)} label="Channel" />
          <Toggle options={WINDOWS} value={win} onChange={(v) => setWin(v)} label="Window" />
        </div>
        <p className="font-ui text-xs text-ink-muted">
          {sel.length > 0
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
        <OrderedTab cats={cats} topIcons={topIcons} topFonts={topFonts} topText={topText} useWin={useWin} />
      )}
      {tab === "colors" && <ColorsTab colors={colors} colorRisers={colorRisers} hasPrev={totals.hasPrev} />}
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
}: {
  cats: Ranked[];
  topIcons: Ranked[];
  topFonts: Ranked[];
  topText: Ranked[];
  useWin: UsageWindow;
}) {
  const winLabel = useWin === "3mo" ? "last 3 months" : useWin === "6mo" ? "last 6 months" : "all time";
  const hasUsage = topIcons.length + topFonts.length + topText.length > 0;
  return (
    <div className="space-y-6">
      <Card eyebrow="Product mix" title="Products & designs ordered" meta="units in window">
        <RankedList items={cats} unit="units" limit={12} />
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

function ColorsTab({ colors, colorRisers, hasPrev }: { colors: Ranked[]; colorRisers: Riser[]; hasPrev: boolean }) {
  if (colors.length === 0) {
    return <EmptyNote>No item-color data yet. Run the updated order-stats script to fill the &ldquo;TRENDS_ITEM_COLORS&rdquo; tab.</EmptyNote>;
  }
  const rising = colorRisers.filter((r) => r.delta > 0).slice(0, 6);
  const falling = colorRisers.filter((r) => r.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 6);
  return (
    <div className="space-y-6">
      <Card eyebrow="Item color" title="Most ordered colors" meta="share of units in window">
        <RankedList items={colors} unit="units" showSwatch limit={16} />
      </Card>
      {hasPrev && (rising.length > 0 || falling.length > 0) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card eyebrow="Colors" title="Gaining">
            <RiserRows items={rising} rising />
          </Card>
          <Card eyebrow="Colors" title="Fading">
            <RiserRows items={falling} />
          </Card>
        </div>
      )}
      <p className="font-ui text-[11px] leading-relaxed text-ink-muted">
        Item color is the garment/product color chosen at checkout — distinct from thread or text colors. Swatches are
        approximate.
      </p>
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
  title: string;
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
}: {
  items: Ranked[];
  unit?: string;
  showSwatch?: boolean;
  limit?: number;
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
        return (
          <li key={`${it.label}-${idx}`} className="flex items-center gap-3 border-b border-parchment/60 px-4 py-2.5 last:border-b-0">
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
