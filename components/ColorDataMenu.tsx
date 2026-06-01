"use client";

import { useEffect, useRef, useState } from "react";
import type { ColorStat } from "@/lib/colorStats";

// Re-export so existing import sites that pull the type from this component
// keep working without churn.
export type { ColorStat };

/**
 * Header dropdown showing how many icons in the catalog use each thread color.
 * Stats are passed in pre-sorted by count (most-used first). The first 15
 * entries are visually emphasized; the remaining 9 (the rest of the 24-spool
 * palette) are shown faded.
 */
export default function ColorDataMenu({ stats }: { stats: ColorStat[] }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return;

    function onClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
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

  const totalUsages = stats.reduce((sum, s) => sum + s.count, 0);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="font-ui flex items-center gap-1.5 rounded-full border border-parchment bg-white px-3 py-1.5 text-xs font-semibold text-espresso transition-colors hover:border-pink hover:bg-pink-soft focus-ring"
      >
        Color Data
        <ChevronIcon
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Thread color usage across all icons"
          className="absolute right-0 top-full z-30 mt-2 w-80 overflow-hidden rounded-xl border border-parchment bg-white shadow-lg"
        >
          <div className="border-b border-parchment px-4 py-3">
            <p className="font-ui text-[10px] font-semibold uppercase tracking-[0.16em] text-berry">
              Thread usage
            </p>
            <p className="font-display mt-0.5 text-base text-espresso">
              Spools across all icons
            </p>
            <p className="font-ui mt-1 text-[11px] text-ink-muted">
              Top 15 highlighted · {totalUsages.toLocaleString()} total uses
            </p>
            <a
              href="/api/color-data"
              download
              className="font-ui mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-pink bg-white px-3 py-1 text-[11px] font-semibold text-cherry transition-colors hover:bg-pink-soft focus-ring"
            >
              <DownloadIcon className="h-3 w-3" />
              Download PDF
            </a>
          </div>

          <ul className="max-h-[420px] overflow-y-auto py-1">
            {stats.map((stat, idx) => {
              const isTop = idx < 15;
              return (
                <li
                  key={stat.slot}
                  className={`flex items-center gap-2.5 px-4 py-1.5 ${
                    isTop ? "bg-pink-soft/40" : "opacity-60"
                  }`}
                >
                  <span
                    className="h-3.5 w-3.5 flex-none rounded-full ring-1 ring-black/10"
                    style={{ backgroundColor: stat.hex }}
                    aria-hidden
                  />
                  <span className="font-ui flex-1 truncate text-xs">
                    <span className="font-semibold text-espresso">
                      {stat.slot}
                    </span>{" "}
                    <span className="text-ink-soft">{stat.name}</span>
                  </span>
                  <span
                    className={`font-ui tabular-nums text-xs ${
                      isTop
                        ? "font-semibold text-cherry"
                        : "text-ink-muted"
                    }`}
                  >
                    {stat.count.toLocaleString()}
                  </span>
                </li>
              );
            })}
          </ul>

          {stats.length === 0 && (
            <p className="font-ui px-4 py-8 text-center text-xs text-ink-muted">
              No thread data yet. Fill in the &ldquo;Thread Colors&rdquo; column in
              the sheet to populate this view.
            </p>
          )}
        </div>
      )}
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
