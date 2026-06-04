"use client";

import { useMemo, useState } from "react";
import type {
  UsageRow,
  UsageSnapshot,
  UsageType,
  UsageWindow,
} from "@/lib/usageStats";

const WINDOW_LABELS: Record<UsageWindow, string> = {
  "3mo": "3 months",
  "6mo": "6 months",
  all: "All time",
};

/**
 * Product Usage report — two ways to walk the same (base product × template)
 * matrix of what customers actually ordered, with a time-window switcher:
 *
 *   By product:  Base product (e.g. "Waffle Pouch") → template (e.g. "Dog Mom") → leaf
 *   By template: Template (e.g. "Dog Mom") → base product (e.g. "Waffle Pouch") → leaf
 *
 * At each parent level there's an "All …" option that aggregates across the
 * other dimension. The leaf shows the most common icons, fonts, and text colors
 * for the selection, ranked by order count. Selection tiles are ordered by
 * popularity (busiest first).
 */

type Route = "product" | "template";
const ALL = "__ALL__";
const TOP = 50; // cap each leaf list

type Ranked = { value: string; count: number };

function summarize(
  rows: UsageRow[],
  base: string | undefined,
  template: string | undefined
): Record<UsageType, Ranked[]> {
  const acc: Record<UsageType, Map<string, number>> = {
    icon: new Map(),
    font: new Map(),
    color: new Map(),
  };
  for (const r of rows) {
    if (base && r.base !== base) continue;
    if (template && r.template !== template) continue;
    acc[r.type].set(r.value, (acc[r.type].get(r.value) || 0) + r.count);
  }
  const rank = (m: Map<string, number>): Ranked[] =>
    [...m.entries()]
      .map(([value, count]) => ({ value, count }))
      .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
  return { icon: rank(acc.icon), font: rank(acc.font), color: rank(acc.color) };
}

export default function UsageReport({ snapshot }: { snapshot: UsageSnapshot }) {
  const [route, setRoute] = useState<Route>("product");
  const [win, setWin] = useState<UsageWindow>(
    snapshot.windows.includes("all")
      ? "all"
      : snapshot.windows[snapshot.windows.length - 1] || "all"
  );
  const [sel1, setSel1] = useState<string | null>(null);
  const [sel2, setSel2] = useState<string | null>(null);

  // Rows for the selected window only — everything below works off this.
  const rows = useMemo(
    () => snapshot.rows.filter((r) => r.window === win),
    [snapshot.rows, win]
  );

  // Popularity weight per parent = total recorded usage in that node.
  const parentWeight = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const p = route === "product" ? r.base : r.template;
      m.set(p, (m.get(p) || 0) + r.count);
    }
    return m;
  }, [rows, route]);

  // Distinct children per parent.
  const childrenByParent = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const r of rows) {
      const parent = route === "product" ? r.base : r.template;
      const child = route === "product" ? r.template : r.base;
      if (!m.has(parent)) m.set(parent, new Set());
      m.get(parent)!.add(child);
    }
    return m;
  }, [rows, route]);

  const level1Items = useMemo(
    () =>
      [...parentWeight.keys()].sort(
        (a, b) =>
          (parentWeight.get(b) || 0) - (parentWeight.get(a) || 0) ||
          a.localeCompare(b)
      ),
    [parentWeight]
  );

  function chooseRoute(next: Route) {
    setRoute(next);
    setSel1(null);
    setSel2(null);
  }
  function chooseWindow(next: UsageWindow) {
    setWin(next);
    setSel1(null);
    setSel2(null);
  }

  const switcher = (
    <WindowSwitcher windows={snapshot.windows} active={win} onChange={chooseWindow} />
  );

  if (snapshot.rows.length === 0) {
    return (
      <div className="rounded-2xl border border-parchment bg-white p-8 text-center">
        <p className="font-ui text-sm text-ink-soft">
          No usage data yet. Run the order stats script to populate the{" "}
          <span className="font-semibold text-espresso">PRODUCT_USAGE</span> tab,
          and this report will fill in.
        </p>
      </div>
    );
  }

  // ----- leaf view -----
  if (sel1 && sel2) {
    const base = route === "product" ? sel1 : sel2 === ALL ? undefined : sel2;
    const template = route === "product" ? (sel2 === ALL ? undefined : sel2) : sel1;
    const summary = summarize(rows, base, template);
    const otherLabel =
      route === "product"
        ? sel2 === ALL
          ? "All templates"
          : sel2
        : sel2 === ALL
        ? "All products"
        : sel2;

    return (
      <div className="flex flex-col gap-6">
        {switcher}
        <Breadcrumb
          route={route}
          onRoot={() => chooseRoute(route)}
          sel1={sel1}
          onSel1={() => setSel2(null)}
          sel2={otherLabel}
        />
        <div className="grid gap-5 md:grid-cols-3">
          <RankCard title="Top icons" items={summary.icon} />
          <RankCard title="Top fonts" items={summary.font} />
          <RankCard title="Top text colors" items={summary.color} />
        </div>
      </div>
    );
  }

  // ----- level 2 (pick the other dimension, or aggregate) -----
  if (sel1) {
    const childWeight = new Map<string, number>();
    for (const r of rows) {
      const p = route === "product" ? r.base : r.template;
      if (p !== sel1) continue;
      const c = route === "product" ? r.template : r.base;
      childWeight.set(c, (childWeight.get(c) || 0) + r.count);
    }
    const kids = [...(childrenByParent.get(sel1) || [])].sort(
      (a, b) =>
        (childWeight.get(b) || 0) - (childWeight.get(a) || 0) ||
        a.localeCompare(b)
    );
    const allLabel = route === "product" ? "All templates" : "All products";
    const childNoun = route === "product" ? "template" : "product";

    return (
      <div className="flex flex-col gap-6">
        {switcher}
        <Breadcrumb route={route} onRoot={() => chooseRoute(route)} sel1={sel1} />
        <div>
          <p className="font-ui mb-3 text-sm text-ink-muted">
            Pick a {childNoun}, or see {sel1} across all{" "}
            {route === "product" ? "templates" : "products"}.
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            <SelectTile label={allLabel} accent onClick={() => setSel2(ALL)} />
            {kids.map((k) => (
              <SelectTile key={k} label={k} onClick={() => setSel2(k)} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ----- level 1 (root): route toggle + window switch + parent list -----
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex w-fit rounded-full border border-parchment bg-white p-1">
          <ToggleButton
            active={route === "product"}
            onClick={() => chooseRoute("product")}
            label="By product"
          />
          <ToggleButton
            active={route === "template"}
            onClick={() => chooseRoute("template")}
            label="By template"
          />
        </div>
        {switcher}
      </div>

      <div>
        <p className="font-ui mb-3 text-sm text-ink-muted">
          {route === "product"
            ? "Pick a base product to drill into its templates."
            : "Pick a template to drill into the products it's used on."}
        </p>
        {level1Items.length === 0 ? (
          <p className="font-ui text-sm text-ink-muted">
            No orders in this window.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {level1Items.map((item) => {
              const n = childrenByParent.get(item)?.size || 0;
              const sub =
                route === "product"
                  ? `${n} template${n === 1 ? "" : "s"}`
                  : `${n} product${n === 1 ? "" : "s"}`;
              return (
                <SelectTile
                  key={item}
                  label={item}
                  sublabel={sub}
                  onClick={() => {
                    setSel1(item);
                    setSel2(null);
                  }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function WindowSwitcher({
  windows,
  active,
  onChange,
}: {
  windows: UsageWindow[];
  active: UsageWindow;
  onChange: (w: UsageWindow) => void;
}) {
  if (windows.length < 2) return null;
  return (
    <div className="inline-flex w-fit rounded-full border border-parchment bg-white p-1">
      {windows.map((w) => (
        <button
          key={w}
          type="button"
          onClick={() => onChange(w)}
          className={`font-ui rounded-full px-3.5 py-1.5 text-sm font-semibold transition-colors focus-ring ${
            active === w ? "bg-espresso text-white" : "text-ink-soft hover:text-espresso"
          }`}
        >
          {WINDOW_LABELS[w]}
        </button>
      ))}
    </div>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`font-ui rounded-full px-4 py-1.5 text-sm font-semibold transition-colors focus-ring ${
        active ? "bg-berry text-white" : "text-ink-soft hover:text-espresso"
      }`}
    >
      {label}
    </button>
  );
}

function SelectTile({
  label,
  sublabel,
  accent,
  onClick,
}: {
  label: string;
  sublabel?: string;
  accent?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-col items-start rounded-xl border bg-white px-4 py-3 text-left transition-colors focus-ring hover:border-pink hover:bg-pink-soft ${
        accent ? "border-berry/40" : "border-parchment"
      }`}
    >
      <span className="font-ui text-sm font-semibold text-espresso">{label}</span>
      {sublabel && (
        <span className="font-ui mt-0.5 text-xs text-ink-muted">{sublabel}</span>
      )}
    </button>
  );
}

function RankCard({ title, items }: { title: string; items: Ranked[] }) {
  const total = items.reduce((s, i) => s + i.count, 0);
  const shown = items.slice(0, TOP);
  return (
    <div className="rounded-2xl border border-parchment bg-white p-5">
      <div className="mb-3 flex items-baseline justify-between">
        <h3 className="font-display text-base text-espresso">{title}</h3>
        <span className="font-ui text-xs text-ink-muted">
          {total.toLocaleString()} total
        </span>
      </div>
      {shown.length === 0 ? (
        <p className="font-ui text-xs text-ink-muted">None recorded.</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {shown.map((it, i) => {
            const pct = total ? Math.round((it.count / total) * 100) : 0;
            return (
              <li key={it.value} className="font-ui flex items-center gap-2 text-sm">
                <span className="w-5 shrink-0 text-right text-xs tabular-nums text-ink-muted">
                  {i + 1}
                </span>
                <span className="flex-1 truncate text-espresso" title={it.value}>
                  {it.value}
                </span>
                <span className="shrink-0 tabular-nums text-ink-soft">
                  {it.count.toLocaleString()}
                </span>
                <span className="w-9 shrink-0 text-right text-xs tabular-nums text-ink-muted">
                  {pct}%
                </span>
              </li>
            );
          })}
        </ol>
      )}
      {items.length > TOP && (
        <p className="font-ui mt-2 text-xs text-ink-muted">
          +{(items.length - TOP).toLocaleString()} more
        </p>
      )}
    </div>
  );
}

function Breadcrumb({
  route,
  onRoot,
  sel1,
  onSel1,
  sel2,
}: {
  route: Route;
  onRoot: () => void;
  sel1: string;
  onSel1?: () => void;
  sel2?: string;
}) {
  return (
    <nav className="font-ui flex flex-wrap items-center gap-1.5 text-sm">
      <button
        type="button"
        onClick={onRoot}
        className="text-berry hover:underline focus-ring"
      >
        {route === "product" ? "By product" : "By template"}
      </button>
      <span className="text-ink-muted">/</span>
      {onSel1 ? (
        <button
          type="button"
          onClick={onSel1}
          className="text-berry hover:underline focus-ring"
        >
          {sel1}
        </button>
      ) : (
        <span className="font-semibold text-espresso">{sel1}</span>
      )}
      {sel2 && (
        <>
          <span className="text-ink-muted">/</span>
          <span className="font-semibold text-espresso">{sel2}</span>
        </>
      )}
    </nav>
  );
}
