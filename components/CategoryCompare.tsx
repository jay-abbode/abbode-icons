"use client";

import { useMemo, useState } from "react";

/**
 * The interactive half of /reports/icons/compare: one click generates the
 * suggested category — intersection icons first (already on the site AND in
 * the report), then the report-only newcomers, with website-only icons left
 * out — and then the list is fully editable: remove, reorder, or swap in any
 * icon from the full ranked pool (seasonality overrides welcome). "Copy list"
 * puts the final names on the clipboard for updating the metaobject in
 * Shopify admin.
 */

export type SlimIcon = {
  icon: string;
  category: string;
  /** Order count in the compare window. */
  count: number;
  hexes: string[];
  /** 1-based rank in the compare window, 0 = unranked (no orders). */
  rank: number;
};

type Tagged = SlimIcon & { tag: "both" | "new" | "added" };

function Swatches({ hexes }: { hexes: string[] }) {
  return (
    <span className="flex flex-none -space-x-0.5" aria-hidden>
      {hexes.length ? (
        hexes.slice(0, 4).map((hex, i) => (
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
  );
}

const TAG_STYLES: Record<Tagged["tag"], { label: string; cls: string }> = {
  both: { label: "kept", cls: "bg-parchment text-ink-soft" },
  new: { label: "new", cls: "bg-pink-soft text-cherry" },
  added: { label: "added", cls: "bg-plum/10 text-plum" },
};

export default function CategoryCompare({
  matches,
  reportOnly,
  pool,
  months,
  categoryTitle,
}: {
  /** Icons in both the website category and the report, in report-rank order. */
  matches: SlimIcon[];
  /** Icons in the report but not on the website, in report-rank order. */
  reportOnly: SlimIcon[];
  /** Every ranked icon in the window — the swap-in pool. */
  pool: SlimIcon[];
  months: number;
  categoryTitle: string;
}) {
  const [list, setList] = useState<Tagged[] | null>(null);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);

  const inList = useMemo(() => new Set((list ?? []).map((i) => i.icon.toLowerCase())), [list]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return pool
      .filter((p) => !inList.has(p.icon.toLowerCase()) && p.icon.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, pool, inList]);

  function generate() {
    setList([
      ...matches.map((i) => ({ ...i, tag: "both" as const })),
      ...reportOnly.map((i) => ({ ...i, tag: "new" as const })),
    ]);
    setCopied(false);
  }

  function remove(icon: string) {
    setList((l) => (l ? l.filter((i) => i.icon !== icon) : l));
    setCopied(false);
  }

  function move(icon: string, dir: -1 | 1) {
    setList((l) => {
      if (!l) return l;
      const idx = l.findIndex((i) => i.icon === icon);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= l.length) return l;
      const next = [...l];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
    setCopied(false);
  }

  function add(item: SlimIcon) {
    setList((l) => (l ? [...l, { ...item, tag: "added" as const }] : l));
    setQuery("");
    setCopied(false);
  }

  async function copy() {
    if (!list) return;
    try {
      await navigator.clipboard.writeText(list.map((i) => i.icon).join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      // Clipboard can be unavailable (permissions) — the list is still on screen.
    }
  }

  if (list === null) {
    return (
      <div className="rounded-xl border border-parchment bg-white p-5">
        <button
          type="button"
          onClick={generate}
          className="font-ui rounded-full bg-plum px-5 py-2.5 text-sm font-semibold text-porcelain transition-colors hover:bg-cherry focus-ring"
        >
          Generate Suggested Category
        </button>
        <p className="font-ui mt-2 text-xs text-ink-muted">
          Builds an ordered list favoring icons in both sets ({matches.length}), then the report-only newcomers (
          {reportOnly.length}); website-only icons are left out. You can swap anything in or out afterward.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-parchment bg-white p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-display text-lg text-espresso">
          Suggested &ldquo;{categoryTitle}&rdquo;
          <span className="font-ui ml-2 text-xs font-normal text-ink-muted">
            {list.length} icons · ordered by {months}-month rank
          </span>
        </h3>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copy}
            className="font-ui rounded-full border border-pink bg-white px-3.5 py-1.5 text-[11px] font-semibold text-cherry transition-colors hover:bg-pink-soft focus-ring"
          >
            {copied ? "Copied ✓" : "Copy list"}
          </button>
          <button
            type="button"
            onClick={generate}
            className="font-ui rounded-full bg-parchment px-3.5 py-1.5 text-[11px] font-semibold text-ink-soft transition-colors hover:text-espresso focus-ring"
          >
            Reset
          </button>
        </div>
      </div>

      <ol className="divide-y divide-parchment/70">
        {list.map((i, idx) => (
          <li key={i.icon} className="flex items-center gap-2.5 py-1.5">
            <span className="font-ui w-6 text-right text-xs tabular-nums text-ink-muted">{idx + 1}</span>
            <Swatches hexes={i.hexes} />
            <span className="font-ui min-w-0 flex-1 truncate text-xs">
              <span className="font-semibold text-espresso">{i.icon}</span>
              {i.category ? <span className="text-ink-muted"> · {i.category}</span> : null}
            </span>
            <span className={`font-ui rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${TAG_STYLES[i.tag].cls}`}>
              {TAG_STYLES[i.tag].label}
            </span>
            <span className="font-ui w-16 text-right text-xs tabular-nums text-ink-soft">
              {i.count.toLocaleString()}
            </span>
            <span className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => move(i.icon, -1)}
                disabled={idx === 0}
                aria-label={`Move ${i.icon} up`}
                className="font-ui rounded px-1 text-xs text-ink-muted transition-colors hover:text-espresso disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => move(i.icon, 1)}
                disabled={idx === list.length - 1}
                aria-label={`Move ${i.icon} down`}
                className="font-ui rounded px-1 text-xs text-ink-muted transition-colors hover:text-espresso disabled:opacity-30"
              >
                ↓
              </button>
              <button
                type="button"
                onClick={() => remove(i.icon)}
                aria-label={`Remove ${i.icon}`}
                className="font-ui ml-1 rounded px-1 text-sm text-ink-muted transition-colors hover:text-tomato"
              >
                ×
              </button>
            </span>
          </li>
        ))}
      </ol>

      <div className="relative mt-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Swap an icon in — search the ranked list (seasonality, trends, gut feel)…"
          className="font-ui w-full rounded-full border border-parchment bg-cream-50 px-4 py-2 text-xs text-espresso placeholder:text-ink-muted focus:border-pink focus:outline-none"
        />
        {results.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-parchment bg-white shadow-lg">
            {results.map((p) => (
              <li key={p.icon}>
                <button
                  type="button"
                  onClick={() => add(p)}
                  className="flex w-full items-center gap-2.5 px-4 py-1.5 text-left transition-colors hover:bg-cream-50"
                >
                  <Swatches hexes={p.hexes} />
                  <span className="font-ui min-w-0 flex-1 truncate text-xs">
                    <span className="font-semibold text-espresso">{p.icon}</span>
                    {p.category ? <span className="text-ink-muted"> · {p.category}</span> : null}
                  </span>
                  <span className="font-ui text-xs tabular-nums text-ink-soft">
                    {p.rank > 0 ? `#${p.rank} · ` : ""}
                    {p.count.toLocaleString()}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="font-ui mt-3 text-[11px] text-ink-muted">
        Apply it on Shopify: admin → Content → Metaobjects → Custom Icon Categories → {categoryTitle} — reorder the
        icon references to match this list. Counts shown are {months}-month orders.
      </p>
    </div>
  );
}
