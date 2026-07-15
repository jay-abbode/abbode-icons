"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

/**
 * Header dropdown that groups the full-page report views (Composite Data,
 * Trends) under a single trigger. These used to be two separate always-visible
 * pills in the header; folding them into one menu keeps the top bar from
 * getting crowded while leaving every view one click away. Add future report
 * pages to the `links` array below and they'll slot in automatically.
 *
 * Trigger + panel styling intentionally mirrors ColorDataMenu / LiveOrderDataMenu
 * so the three analytics controls read as a matching set.
 */
const links: { href: string; label: string; blurb: string }[] = [
  {
    href: "/composite",
    label: "Composite Data",
    blurb: "Combined icon + color order totals",
  },
  {
    href: "/trends",
    label: "Trends",
    blurb: "What's rising and falling lately",
  },
  {
    href: "/reports/trends",
    label: "Product Trends",
    blurb: "Volume, item colors, product mix & seasonality (DTC)",
  },
  {
    href: "/reports/usage",
    label: "Product Usage",
    blurb: "Top icons, fonts & colors by product or template",
  },
];

export default function ReportsMenu() {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click or Escape — same pattern as the sibling menus.
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

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="true"
        className="font-ui flex items-center gap-1.5 rounded-full border border-parchment bg-white px-3 py-1.5 text-xs font-semibold text-espresso transition-colors hover:border-pink hover:bg-pink-soft focus-ring"
      >
        Reports
        <ChevronIcon
          className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Report views"
          className="absolute right-0 top-full z-30 mt-2 w-64 overflow-hidden rounded-xl border border-parchment bg-white p-1.5 shadow-lg"
        >
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2.5 transition-colors hover:bg-pink-soft focus-ring"
            >
              <span className="font-ui block text-sm font-semibold text-espresso">
                {l.label}
              </span>
              <span className="font-ui mt-0.5 block text-xs text-ink-muted">
                {l.blurb}
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
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
