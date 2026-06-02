"use client";

import { useState } from "react";
import type {
  CompositeSnapshot,
  WindowKey,
} from "@/lib/compositeStats";

const WINDOW_ORDER: WindowKey[] = ["3mo", "6mo", "12mo"];
const WINDOW_BUTTON_LABEL: Record<WindowKey, string> = {
  "3mo": "3 months",
  "6mo": "6 months",
  "12mo": "12 months",
};

const TOP_N = 15;

/**
 * Composite Data page body. Ranks the 24 Madeira spools by total real-world
 * usage (icon colors + chosen text colors) for the selected rolling window.
 * Top 15 are emphasized; a per-row breakdown shows how much came from icons
 * vs text. Export hits /api/composite-export for a PDF covering all three
 * windows, styled like the Color Data report.
 */
export default function CompositeView({
  snapshot,
}: {
  snapshot: CompositeSnapshot;
}) {
  const [windowKey, setWindowKey] = useState<WindowKey>("12mo");
  const win = snapshot.windows[windowKey];
  const colors = win.colors;
  const hasData = colors.some((c) => c.total > 0);
  const maxTotal = Math.max(1, ...colors.map((c) => c.total));

  return (
    <div>
      {/* Controls */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div
          className="inline-flex rounded-full border border-parchment bg-white p-1"
          role="tablist"
          aria-label="Rolling window"
        >
          {WINDOW_ORDER.map((key) => {
            const active = key === windowKey;
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setWindowKey(key)}
                className={`font-ui rounded-full px-4 py-1.5 text-xs font-semibold transition-colors focus-ring ${
                  active
                    ? "bg-berry text-porcelain"
                    : "text-ink-soft hover:text-espresso"
                }`}
              >
                {WINDOW_BUTTON_LABEL[key]}
              </button>
            );
          })}
        </div>

        <a
          href="/api/composite-export"
          download
          className="font-ui inline-flex items-center gap-1.5 rounded-full border border-pink bg-white px-4 py-2 text-xs font-semibold text-cherry transition-colors hover:bg-pink-soft focus-ring"
        >
          <DownloadIcon className="h-3.5 w-3.5" />
          Export PDF (3 / 6 / 12 mo)
        </a>
      </div>

      <p className="font-ui mb-4 text-xs text-ink-muted">
        Top {TOP_N} highlighted · {win.totalUses.toLocaleString()} total thread
        uses in the last {WINDOW_BUTTON_LABEL[windowKey]}
        {snapshot.updatedAt ? ` · updated ${snapshot.updatedAt}` : ""}
      </p>

      {!hasData ? (
        <p className="font-ui rounded-xl border border-parchment bg-white px-4 py-10 text-center text-sm text-ink-muted">
          No composite data yet. Run the order-stats script to populate the
          &ldquo;COMPOSITE&rdquo; tab in the sheet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-parchment bg-white">
          {/* Header row */}
          <div className="font-ui grid grid-cols-[2rem_1.25rem_minmax(7rem,1fr)_4rem_4rem_4rem_minmax(5rem,8rem)] items-center gap-3 border-b border-parchment px-4 py-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            <span className="text-right">#</span>
            <span />
            <span>Color</span>
            <span className="text-right">Icons</span>
            <span className="text-right">Text</span>
            <span className="text-right">Total</span>
            <span>Distribution</span>
          </div>

          <ul>
            {colors.map((c, idx) => {
              const isTop = idx < TOP_N;
              const fillPct = (c.total / maxTotal) * 100;
              return (
                <li
                  key={c.slot}
                  className={`grid grid-cols-[2rem_1.25rem_minmax(7rem,1fr)_4rem_4rem_4rem_minmax(5rem,8rem)] items-center gap-3 border-b border-parchment/60 px-4 py-2 last:border-b-0 ${
                    isTop ? "bg-pink-soft/40" : "opacity-60"
                  }`}
                >
                  <span className="font-ui text-right text-xs tabular-nums text-ink-muted">
                    {idx + 1}
                  </span>
                  <span
                    className="h-3.5 w-3.5 flex-none rounded-full ring-1 ring-black/10"
                    style={{ backgroundColor: c.hex }}
                    aria-hidden
                  />
                  <span className="font-ui truncate text-xs">
                    <span className="font-semibold text-espresso">{c.slot}</span>{" "}
                    <span className="text-ink-soft">{c.name}</span>{" "}
                    <span className="text-ink-muted">· {c.code}</span>
                  </span>
                  <span className="font-ui text-right text-xs tabular-nums text-ink-soft">
                    {c.icons.toLocaleString()}
                  </span>
                  <span className="font-ui text-right text-xs tabular-nums text-ink-soft">
                    {c.text.toLocaleString()}
                  </span>
                  <span
                    className={`font-ui text-right text-xs tabular-nums ${
                      isTop ? "font-semibold text-cherry" : "text-ink-muted"
                    }`}
                  >
                    {c.total.toLocaleString()}
                  </span>
                  <span className="h-2 w-full overflow-hidden rounded-full bg-parchment">
                    <span
                      className={`block h-full rounded-full ${
                        isTop ? "bg-berry" : "bg-ink-muted"
                      }`}
                      style={{ width: `${Math.max(fillPct, c.total > 0 ? 2 : 0)}%` }}
                    />
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      <p className="font-ui mt-4 text-[11px] leading-relaxed text-ink-muted">
        Total = thread colors that make up each ordered icon, plus the thread
        color chosen for the custom text, counted once per order. White → Tusk
        is applied on croc pouches; retired colors are dropped.
      </p>
    </div>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M8 2v8m0 0 3-3m-3 3-3-3" />
      <path d="M3 12v1.5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5V12" />
    </svg>
  );
}
