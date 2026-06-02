"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { OrderStat, OrderStatsSnapshot } from "@/lib/orderStats";
import { THREAD_PALETTE, rgbToHex } from "@/lib/threadPalette";

export type { OrderStat };

/**
 * Header dropdown showing how often each icon has been ordered (joined to its
 * catalog thread colors). Data comes precomputed from the ORDER_STATS sheet tab
 * via getOrderStats(). Includes:
 *   - a PDF export of the full ranked list (/api/icon-data-export), and
 *   - a multi-select color filter: pick one or more thread colors to show only
 *     icons whose design uses any of them.
 */
export default function LiveOrderDataMenu({
  snapshot,
}: {
  snapshot: OrderStatsSnapshot;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const { stats, window, updatedAt } = snapshot;

  // Only show palette colors that at least one icon actually uses, so the
  // filter row isn't cluttered with spools nothing in the list references.
  const usedSlots = useMemo(() => {
    const s = new Set<number>();
    for (const st of stats) for (const sl of st.slots) s.add(sl);
    return s;
  }, [stats]);

  const palette = useMemo(
    () => THREAD_PALETTE.filter((t) => usedSlots.has(t.slot)),
    [usedSlots]
  );

  const filtered = useMemo(() => {
    if (selected.size === 0) return stats;
    return stats.filter((st) => st.slots.some((sl) => selected.has(sl)));
  }, [stats, selected]);

  const filteredTotal = useMemo(
    () => filtered.reduce((sum, s) => sum + s.count, 0),
    [filtered]
  );

  function toggle(slot: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="font-ui flex items-center gap-1.5 rounded-full border border-parchment bg-white px-3 py-1.5 text-xs font-semibold text-espresso transition-colors hover:border-pink hover:bg-pink-soft focus-ring"
      >
        Icon Data
        <ChevronIcon
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Icon order frequency"
          className="absolute right-0 top-full z-30 mt-2 w-96 overflow-hidden rounded-xl border border-parchment bg-white shadow-lg"
        >
          <div className="border-b border-parchment px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-ui text-[10px] font-semibold uppercase tracking-[0.16em] text-berry">
                  Icon data
                </p>
                <p className="font-display mt-0.5 text-base text-espresso">
                  Most-ordered icons
                </p>
              </div>
              <a
                href="/api/icon-data-export"
                download
                className="font-ui inline-flex flex-none items-center gap-1.5 rounded-full border border-pink bg-white px-3 py-1.5 text-[11px] font-semibold text-cherry transition-colors hover:bg-pink-soft focus-ring"
              >
                <DownloadIcon className="h-3 w-3" />
                Export PDF
              </a>
            </div>
            <p className="font-ui mt-1 text-[11px] text-ink-muted">
              {window || "Recent orders"} · {filteredTotal.toLocaleString()} icon
              orders{selected.size > 0 ? ` · ${filtered.length} icons` : ""}
              {updatedAt ? ` · updated ${updatedAt}` : ""}
            </p>
          </div>

          {/* Color filter */}
          {palette.length > 0 && (
            <div className="border-b border-parchment px-4 py-2.5">
              <div className="mb-1.5 flex items-center justify-between">
                <p className="font-ui text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                  Filter by color
                </p>
                {selected.size > 0 && (
                  <button
                    type="button"
                    onClick={() => setSelected(new Set())}
                    className="font-ui text-[10px] font-semibold text-cherry hover:underline focus-ring"
                  >
                    Clear ({selected.size})
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {palette.map((t) => {
                  const on = selected.has(t.slot);
                  return (
                    <button
                      key={t.slot}
                      type="button"
                      onClick={() => toggle(t.slot)}
                      aria-pressed={on}
                      title={`${t.slot} · ${t.name}`}
                      className={`h-5 w-5 rounded-full ring-1 ring-black/10 transition-transform focus-ring ${
                        on
                          ? "scale-110 ring-2 ring-cherry ring-offset-1"
                          : "hover:scale-110"
                      }`}
                      style={{ backgroundColor: rgbToHex(t.rgb) }}
                    />
                  );
                })}
              </div>
            </div>
          )}

          <ul className="max-h-[380px] overflow-y-auto py-1">
            {filtered.map((stat, idx) => (
              <li
                key={`${stat.icon}-${idx}`}
                className="flex items-center gap-2.5 px-4 py-1.5"
              >
                <span className="flex flex-none -space-x-0.5" aria-hidden>
                  {stat.hexes.length > 0 ? (
                    stat.hexes.slice(0, 4).map((hex, i) => (
                      <span
                        key={i}
                        className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10"
                        style={{ backgroundColor: hex }}
                      />
                    ))
                  ) : (
                    <span className="h-3.5 w-3.5 rounded-full bg-parchment ring-1 ring-black/10" />
                  )}
                </span>
                <span className="font-ui flex-1 truncate text-xs">
                  <span className="font-semibold text-espresso">{stat.icon}</span>
                  {stat.category && (
                    <span className="text-ink-muted"> · {stat.category}</span>
                  )}
                </span>
                <span className="font-ui tabular-nums text-xs text-ink-soft">
                  {stat.count.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>

          {stats.length === 0 && (
            <p className="font-ui px-4 py-8 text-center text-xs text-ink-muted">
              No order data yet. Run the order-stats script to populate the
              &ldquo;ORDER_STATS&rdquo; tab in the sheet.
            </p>
          )}
          {stats.length > 0 && filtered.length === 0 && (
            <p className="font-ui px-4 py-8 text-center text-xs text-ink-muted">
              No icons use the selected color{selected.size === 1 ? "" : "s"}.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ className }: { className?: string }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
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
