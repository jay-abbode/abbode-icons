"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { THREAD_PALETTE, rgbToHex } from "@/lib/threadPalette";

/**
 * "Filters" button that lives next to the search bar. Lets you pick one or more
 * thread colors and "Apply" to see matching icons on the browse page as normal
 * clickable cards. Matching is COMPOUND (AND): an icon must use *every* selected
 * color to show up. Selection is read from / written to the `?colors=` query
 * param (comma-separated Madeira slot numbers), so the browse page can filter
 * server-side and the button reflects what's currently applied.
 */
export default function FiltersMenu() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const applied = parseColors(searchParams?.get("colors"));
  const [selected, setSelected] = useState<Set<number>>(new Set(applied));

  // Keep the picker in sync with the URL (e.g. after Apply, Clear, or nav).
  useEffect(() => {
    setSelected(new Set(parseColors(searchParams?.get("colors"))));
  }, [searchParams]);

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

  const appliedCount = applied.length;

  function toggle(slot: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(slot)) next.delete(slot);
      else next.add(slot);
      return next;
    });
  }

  function apply() {
    const params = new URLSearchParams(searchParams?.toString());
    if (selected.size > 0) {
      params.set("colors", [...selected].sort((a, b) => a - b).join(","));
    } else {
      params.delete("colors");
    }
    setOpen(false);
    router.push(`/browse?${params.toString()}`);
  }

  function clearAll() {
    setSelected(new Set());
    const params = new URLSearchParams(searchParams?.toString());
    params.delete("colors");
    setOpen(false);
    router.push(`/browse?${params.toString()}`);
  }

  return (
    <div ref={containerRef} className="relative flex-none">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="font-ui flex items-center gap-1.5 rounded-full border border-parchment bg-white px-3 py-1.5 text-xs font-semibold text-espresso transition-colors hover:border-pink hover:bg-pink-soft focus-ring"
      >
        <FunnelIcon className="h-3.5 w-3.5" />
        Filters
        {appliedCount > 0 && (
          <span className="ml-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-cherry px-1 text-[10px] font-bold leading-none text-porcelain tabular-nums">
            {appliedCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Filter icons by color"
          className="absolute right-0 top-full z-40 mt-2 w-80 overflow-hidden rounded-xl border border-parchment bg-white shadow-lg"
        >
          <div className="border-b border-parchment px-4 py-3">
            <p className="font-ui text-[10px] font-semibold uppercase tracking-[0.16em] text-berry">
              Filter by color
            </p>
            <p className="font-ui mt-0.5 text-[11px] text-ink-muted">
              Shows icons that use{" "}
              <span className="font-semibold text-ink-soft">all</span> selected
              colors. Tap to toggle, then Apply.
            </p>
          </div>

          <div className="max-h-[320px] overflow-y-auto px-3 py-2">
            {THREAD_PALETTE.map((t) => {
              const on = selected.has(t.slot);
              return (
                <button
                  key={t.slot}
                  type="button"
                  onClick={() => toggle(t.slot)}
                  aria-pressed={on}
                  className={`font-ui flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                    on ? "bg-pink-soft" : "hover:bg-parchment/60"
                  }`}
                >
                  <span
                    className={`h-4 w-4 flex-none rounded-full ring-1 ring-black/10 ${
                      on ? "ring-2 ring-cherry ring-offset-1" : ""
                    }`}
                    style={{ backgroundColor: rgbToHex(t.rgb) }}
                  />
                  <span className="flex-1 truncate">
                    <span className="font-semibold text-espresso">{t.slot}</span>{" "}
                    <span className="text-ink-soft">{t.name}</span>
                  </span>
                  {on && <CheckIcon className="h-3.5 w-3.5 flex-none text-cherry" />}
                </button>
              );
            })}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-parchment px-4 py-3">
            <button
              type="button"
              onClick={clearAll}
              className="font-ui text-xs font-semibold text-ink-soft transition-colors hover:text-cherry focus-ring"
            >
              Clear
            </button>
            <button
              type="button"
              onClick={apply}
              className="font-ui rounded-full bg-berry px-4 py-1.5 text-xs font-semibold text-porcelain transition-colors hover:bg-cherry focus-ring"
            >
              Apply filters{selected.size ? ` (${selected.size})` : ""}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function parseColors(raw: string | null | undefined): number[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => parseInt(s, 10))
    .filter((n) => !Number.isNaN(n));
}

function FunnelIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M2 3h12l-4.5 5.5V13L6.5 11.5V8.5L2 3Z" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="m3 8.5 3.5 3.5L13 4.5" />
    </svg>
  );
}
