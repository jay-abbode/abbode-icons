"use client";

import Link from "next/link";

/**
 * Top bar for the printable day sheet: what this sheet covers, today's date in
 * the operator's local time, and a Print / Save-as-PDF button. The button and
 * the back link are hidden when actually printing (print:hidden) so only the
 * document itself ends up on paper / in the PDF.
 */
export default function DaySheetHeader({
  windowLabel,
  jobCount,
  updatedAt,
  scopeLabel,
  configName,
}: {
  windowLabel: string;
  jobCount: number;
  updatedAt: string | null;
  /** e.g. "Webster · Room 3" when the sheet is scoped to one room. */
  scopeLabel?: string;
  /** Set when printing a specific saved configuration rather than the active one. */
  configName?: string | null;
}) {
  const today = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const meta = [
    windowLabel || null,
    jobCount ? `${jobCount} designs` : null,
    updatedAt ? `data updated ${updatedAt}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-cream-200 pb-4">
      <div>
        <div className="font-ui mb-1 print:hidden">
          <Link href="/machines" className="text-xs text-ink-muted hover:text-espresso">
            ← Machines
          </Link>
        </div>
        <h1 className="font-display text-2xl text-espresso md:text-3xl">
          Thread allocations
          {scopeLabel ? <span className="font-ui text-base font-normal text-ink-soft"> — {scopeLabel}</span> : null}
        </h1>
        <p className="font-ui mt-1 text-sm text-ink-soft">{today}</p>
        {meta ? <p className="font-ui text-xs text-ink-muted">{meta}</p> : null}
        {configName ? (
          <p className="font-ui text-xs text-ink-muted">Configuration: {configName}</p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => window.print()}
        className="font-ui rounded-full bg-plum px-4 py-2 text-sm font-semibold text-porcelain transition-colors hover:bg-cherry focus-ring print:hidden"
      >
        Print / Save as PDF
      </button>
    </div>
  );
}
