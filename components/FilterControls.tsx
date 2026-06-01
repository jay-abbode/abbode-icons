"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTransition } from "react";

interface Props {
  categories: string[];
  currentCategory: string;
  currentColorVar: boolean;
  currentQuery: string;
  /** Number of icons per category, used to show counts beside each name. */
  categoryCounts?: Record<string, number>;
  /** Total icon count, shown next to "All categories". */
  totalCount?: number;
  /**
   * Which status view we're currently on, or null for the default Active
   * view. Used to highlight the matching link below the category section.
   */
  currentStatusView: "DRAFT" | "ARCHIVED" | null;
  /** Catalog-wide draft/archived counts shown on the view links. */
  draftCount: number;
  archivedCount: number;
}

export default function FilterControls({
  categories,
  currentCategory,
  currentColorVar,
  currentQuery,
  categoryCounts,
  totalCount,
  currentStatusView,
  draftCount,
  archivedCount,
}: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams?.toString());
    if (value === null || value === "") params.delete(key);
    else params.set(key, value);
    startTransition(() => {
      router.push(`/browse?${params.toString()}`);
    });
  }

  // "Clear all filters" resets all the way to the default Active view —
  // including dropping the status param — so it's a true reset, not just a
  // sub-filter clear within the current view.
  const hasActiveFilters =
    currentCategory || currentColorVar || currentStatusView || currentQuery;

  return (
    <div className={`space-y-7 transition-opacity ${isPending ? "opacity-50" : ""}`}>
      <FilterGroup label="Category">
        <div className="space-y-0.5">
          <RadioRow
            label="All categories"
            checked={!currentCategory}
            count={totalCount}
            onSelect={() => setParam("category", null)}
          />
          {categories.map((cat) => (
            <RadioRow
              key={cat}
              label={cat}
              checked={currentCategory === cat}
              count={categoryCounts?.[cat]}
              onSelect={() => setParam("category", cat)}
            />
          ))}
        </div>
      </FilterGroup>

      <FilterGroup label="Attributes">
        <label className="font-ui flex cursor-pointer items-center gap-2.5 py-1.5 text-sm text-ink-soft hover:text-espresso">
          <input
            type="checkbox"
            checked={currentColorVar}
            onChange={(e) => setParam("colorVar", e.target.checked ? "1" : null)}
            className="h-4 w-4 rounded border-parchment text-berry focus:ring-berry/30"
          />
          Color variations only
        </label>
      </FilterGroup>

      <FilterGroup label="View">
        <div className="space-y-0.5">
          <ViewLinkRow
            label="Draft designs"
            count={draftCount}
            href="/browse?status=DRAFT"
            active={currentStatusView === "DRAFT"}
          />
          <ViewLinkRow
            label="Archived designs"
            count={archivedCount}
            href="/browse?status=ARCHIVED"
            active={currentStatusView === "ARCHIVED"}
          />
          {currentStatusView && (
            <Link
              href="/browse"
              className="font-ui mt-1.5 inline-flex items-center gap-1 px-1.5 py-1 text-xs text-ink-muted transition-colors hover:text-cherry"
            >
              <span aria-hidden>←</span> Back to active designs
            </Link>
          )}
        </div>
      </FilterGroup>

      {hasActiveFilters && (
        <Link
          href="/browse"
          className="font-ui inline-block text-xs font-medium text-berry underline decoration-pink underline-offset-4 hover:decoration-berry hover:text-cherry"
        >
          Clear all filters
        </Link>
      )}
    </div>
  );
}

function FilterGroup({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="font-ui mb-2.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-olive">
        {label}
      </h3>
      {children}
    </div>
  );
}

function ViewLinkRow({
  label,
  count,
  href,
  active,
}: {
  label: string;
  count: number;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`font-ui group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors ${
        active ? "text-espresso font-medium" : "text-ink-soft hover:text-espresso"
      }`}
    >
      <span className="flex-1 truncate">{label}</span>
      <span
        className={`tabular-nums text-xs transition-colors ${
          active ? "text-berry" : "text-ink-muted group-hover:text-ink-soft"
        }`}
      >
        {count}
      </span>
      {active && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-berry"
        />
      )}
    </Link>
  );
}

function RadioRow({
  label,
  checked,
  count,
  onSelect,
}: {
  label: string;
  checked: boolean;
  count?: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`font-ui group flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-sm transition-colors ${
        checked ? "text-espresso font-medium" : "text-ink-soft hover:text-espresso"
      }`}
    >
      <span className="flex-1 truncate">{label}</span>
      {typeof count === "number" && (
        <span
          className={`tabular-nums text-xs transition-colors ${
            checked ? "text-berry" : "text-ink-muted group-hover:text-ink-soft"
          }`}
        >
          {count}
        </span>
      )}
      {checked && (
        <span
          aria-hidden
          className="ml-0.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-berry"
        />
      )}
    </button>
  );
}
