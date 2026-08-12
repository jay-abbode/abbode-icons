"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";

/**
 * Category dropdown for /reports/icons. A tiny client island in an otherwise
 * server-rendered page: on change it rewrites only the `category` search param
 * (months/top ride along untouched) and lets the server component re-filter.
 * Styled to match the app's existing rounded-full selects (ProductTrends).
 */
export default function ReportCategorySelect({
  categories,
  current,
}: {
  categories: string[];
  /** The category currently applied, or "" for all. */
  current: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams?.toString());
    if (value) params.set("category", value);
    else params.delete("category");
    startTransition(() => {
      router.push(`/reports/icons${params.size ? `?${params.toString()}` : ""}`);
    });
  }

  return (
    <select
      value={current}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filter by category"
      className={`focus-ring font-ui rounded-full border px-3 py-1.5 text-xs transition-opacity ${
        current
          ? "border-plum bg-plum font-semibold text-porcelain"
          : "border-parchment bg-white text-espresso"
      } ${isPending ? "opacity-60" : ""}`}
    >
      <option value="">All categories</option>
      {categories.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </select>
  );
}
