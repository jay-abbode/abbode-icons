"use client";

import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useTransition } from "react";

interface Props {
  categories: string[];
  statuses: string[];
  currentCategory: string;
  currentColorVar: boolean;
  currentStatus: string;
  currentQuery: string;
}

export default function FilterControls({
  categories,
  statuses,
  currentCategory,
  currentColorVar,
  currentStatus,
  currentQuery,
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

  const hasActiveFilters =
    currentCategory || currentColorVar || currentStatus || currentQuery;

  return (
    <div className={`space-y-7 transition-opacity ${isPending ? "opacity-50" : ""}`}>
      <FilterGroup label="Category">
        <div className="space-y-0.5">
          <RadioRow
            label="All categories"
            checked={!currentCategory}
            onSelect={() => setParam("category", null)}
          />
          {categories.map((cat) => (
            <RadioRow
              key={cat}
              label={cat}
              checked={currentCategory === cat}
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

      {statuses.length > 1 && (
        <FilterGroup label="Status">
          <div className="space-y-0.5">
            <RadioRow
              label="Any status"
              checked={!currentStatus}
              onSelect={() => setParam("status", null)}
            />
            {statuses.map((s) => (
              <RadioRow
                key={s}
                label={s}
                checked={currentStatus === s}
                onSelect={() => setParam("status", s)}
              />
            ))}
          </div>
        </FilterGroup>
      )}

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

function RadioRow({
  label,
  checked,
  onSelect,
}: {
  label: string;
  checked: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`font-ui group flex w-full items-center justify-between rounded-md px-1.5 py-1 text-left text-sm transition-colors ${
        checked ? "text-espresso font-medium" : "text-ink-soft hover:text-espresso"
      }`}
    >
      <span className="truncate">{label}</span>
      {checked && (
        <span className="ml-2 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-berry" />
      )}
    </button>
  );
}
