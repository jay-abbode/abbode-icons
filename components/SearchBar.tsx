"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition, useEffect, FormEvent } from "react";

export default function SearchBar({
  initialQuery = "",
  compact = false,
  autoFocus = false,
}: {
  initialQuery?: string;
  compact?: boolean;
  autoFocus?: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(initialQuery);
  const [, startTransition] = useTransition();

  useEffect(() => { setValue(initialQuery); }, [initialQuery]);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    const next = new URLSearchParams(searchParams?.toString());
    if (trimmed) next.set("q", trimmed);
    else next.delete("q");
    startTransition(() => { router.push(`/browse?${next.toString()}`); });
  }

  return (
    <form onSubmit={handleSubmit} role="search" className="relative w-full">
      <SearchIcon
        className={`pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-muted ${
          compact ? "h-4 w-4" : "h-5 w-5"
        }`}
      />
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        autoFocus={autoFocus}
        placeholder={compact ? "Search name, theme, color…" : "Search 700+ icons by name, theme, or color…"}
        className={`font-ui w-full rounded-full border border-parchment bg-white pl-11 pr-4 text-espresso placeholder:text-ink-muted shadow-sm transition-all focus:border-berry focus:outline-none focus:ring-2 focus:ring-berry/20 ${
          compact ? "py-2 text-sm" : "py-3.5 text-base"
        }`}
      />
    </form>
  );
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      viewBox="0 0 24 24"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" strokeLinecap="round" />
    </svg>
  );
}
