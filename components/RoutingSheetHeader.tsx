"use client";

import Link from "next/link";

/**
 * Top bar for the printable routing sheet — mirrors DaySheetHeader so the two
 * floor printouts feel like one system. Everything but the document itself is
 * print:hidden.
 */
export default function RoutingSheetHeader({
  batchLabel,
  scopeLabel,
  metaLine,
  configLine,
}: {
  /** e.g. "Batch — Thursday, July 17, 2026". */
  batchLabel: string;
  /** e.g. "Room 3" when the sheet is scoped to one room. */
  scopeLabel?: string;
  /** Orders / change-free / updated summary. */
  metaLine?: string;
  /** Which thread configuration the assignments assume. */
  configLine?: string;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 border-b border-cream-200 pb-4">
      <div>
        <div className="font-ui mb-1 print:hidden">
          <Link href="/machines" className="text-xs text-ink-muted hover:text-espresso">
            ← Back to Thread Config
          </Link>
        </div>
        <h1 className="font-display text-2xl text-espresso md:text-3xl">
          Order routing
          {scopeLabel ? <span className="font-ui text-base font-normal text-ink-soft"> — {scopeLabel}</span> : null}
        </h1>
        <p className="font-ui mt-1 text-sm text-ink-soft">{batchLabel}</p>
        {metaLine ? <p className="font-ui text-xs text-ink-muted">{metaLine}</p> : null}
        {configLine ? <p className="font-ui text-xs text-ink-muted">{configLine}</p> : null}
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
