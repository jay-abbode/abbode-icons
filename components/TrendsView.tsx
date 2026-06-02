"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import type { TrendsSnapshot, TrendItem } from "@/lib/trendStats";

type Direction = "rising" | "cooling";
const MAX_ICONS = 40;

/**
 * Trends page body. Two ranked lists — icons and text colors — showing what's
 * gaining (or losing) orders fastest, comparing the recent window to the one
 * before it. "New" = no orders last window; "Spiking" = real volume and at
 * least doubled. A Rising/Cooling toggle flips between climbers and fallers.
 */
export default function TrendsView({ snapshot }: { snapshot: TrendsSnapshot }) {
  const [dir, setDir] = useState<Direction>("rising");
  const hasAny = snapshot.icons.length > 0 || snapshot.colors.length > 0;

  if (!hasAny) {
    return (
      <p className="font-ui rounded-xl border border-parchment bg-white px-4 py-10 text-center text-sm text-ink-muted">
        No trend data yet. Run the order-stats script (it now also fills the
        &ldquo;ICON_TRENDS&rdquo; and &ldquo;COLOR_TRENDS&rdquo; tabs), then this
        page will populate within ~60s.
      </p>
    );
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div
          className="inline-flex rounded-full border border-parchment bg-white p-1"
          role="tablist"
          aria-label="Trend direction"
        >
          {(["rising", "cooling"] as Direction[]).map((d) => {
            const active = d === dir;
            return (
              <button
                key={d}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setDir(d)}
                className={`font-ui rounded-full px-4 py-1.5 text-xs font-semibold capitalize transition-colors focus-ring ${
                  active ? "bg-berry text-porcelain" : "text-ink-soft hover:text-espresso"
                }`}
              >
                {d === "rising" ? "On the rise" : "Cooling off"}
              </button>
            );
          })}
        </div>
        <p className="font-ui text-xs text-ink-muted">
          {snapshot.windowLabel || "Recent vs previous window"}
          {snapshot.updatedAt ? ` · updated ${snapshot.updatedAt}` : ""}
        </p>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <TrendList
          title="Trending icons"
          eyebrow="Icons"
          items={snapshot.icons}
          dir={dir}
          limit={MAX_ICONS}
          showSwatch={false}
        />
        <TrendList
          title="Trending text colors"
          eyebrow="Text colors"
          items={snapshot.colors}
          dir={dir}
          showSwatch
        />
      </div>

      <p className="font-ui mt-8 text-[11px] leading-relaxed text-ink-muted">
        Trend compares the recent window to the window just before it. &ldquo;New&rdquo;
        means it had no orders in the previous window; &ldquo;Spiking&rdquo; means real
        volume that at least doubled. Text colors are the thread color customers
        choose for their custom text (croc White → Tusk applied; retired colors
        dropped).
      </p>
    </div>
  );
}

function TrendList({
  title,
  eyebrow,
  items,
  dir,
  showSwatch,
  limit,
}: {
  title: string;
  eyebrow: string;
  items: TrendItem[];
  dir: Direction;
  showSwatch: boolean;
  limit?: number;
}) {
  const filtered = (dir === "rising"
    ? items.filter((i) => i.delta > 0)
    : items.filter((i) => i.delta < 0).sort((a, b) => a.delta - b.delta)
  ).slice(0, limit ?? items.length);

  const maxAbs = Math.max(1, ...filtered.map((i) => Math.abs(i.delta)));

  return (
    <section className="overflow-hidden rounded-xl border border-parchment bg-white">
      <div className="border-b border-parchment px-4 py-3">
        <p className="font-ui text-[10px] font-semibold uppercase tracking-[0.16em] text-berry">
          {eyebrow}
        </p>
        <p className="font-display mt-0.5 text-base text-espresso">{title}</p>
      </div>

      {filtered.length === 0 ? (
        <p className="font-ui px-4 py-10 text-center text-xs text-ink-muted">
          Nothing {dir === "rising" ? "rising" : "cooling"} in this window.
        </p>
      ) : (
        <ul>
          {filtered.map((item, idx) => {
            const fillPct = (Math.abs(item.delta) / maxAbs) * 100;
            return (
              <li
                key={`${item.label}-${idx}`}
                className="flex items-center gap-3 border-b border-parchment/60 px-4 py-2.5 last:border-b-0"
              >
                <span className="font-ui w-5 flex-none text-right text-xs tabular-nums text-ink-muted">
                  {idx + 1}
                </span>
                {showSwatch && (
                  <span
                    className="h-3.5 w-3.5 flex-none rounded-full ring-1 ring-black/10"
                    style={{ backgroundColor: item.hex }}
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1">
                  <span className="font-ui flex items-center gap-1.5 truncate text-xs">
                    <span className="font-semibold text-espresso">{item.label}</span>
                    {item.isNew && dir === "rising" && <Badge tone="cherry">New</Badge>}
                    {item.isSpiking && dir === "rising" && (
                      <Badge tone="berry">Spiking</Badge>
                    )}
                  </span>
                  {item.detail && (
                    <span className="font-ui block truncate text-[11px] text-ink-muted">
                      {item.detail}
                    </span>
                  )}
                  <span className="mt-1 block h-1.5 w-full overflow-hidden rounded-full bg-parchment">
                    <span
                      className={`block h-full rounded-full ${
                        dir === "rising" ? "bg-berry" : "bg-ink-muted"
                      }`}
                      style={{ width: `${Math.max(fillPct, 2)}%` }}
                    />
                  </span>
                </span>
                <span className="flex-none text-right">
                  <span
                    className={`font-ui block text-xs font-semibold tabular-nums ${
                      item.delta > 0 ? "text-cherry" : "text-ink-soft"
                    }`}
                  >
                    {item.delta > 0 ? "+" : ""}
                    {item.delta.toLocaleString()}
                  </span>
                  <span className="font-ui block text-[11px] tabular-nums text-ink-muted">
                    {item.previous.toLocaleString()} → {item.recent.toLocaleString()}
                    {item.growthPct !== null
                      ? ` · ${item.growthPct > 0 ? "+" : ""}${item.growthPct.toFixed(0)}%`
                      : ""}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Badge({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "cherry" | "berry";
}) {
  const bg = tone === "berry" ? "bg-berry" : "bg-cherry";
  return (
    <span
      className={`font-ui inline-flex flex-none items-center rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-porcelain ${bg}`}
    >
      {children}
    </span>
  );
}
