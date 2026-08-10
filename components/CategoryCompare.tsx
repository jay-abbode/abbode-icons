"use client";

import { useMemo, useState } from "react";

/**
 * The interactive half of /reports/icons/compare: one click generates the
 * suggested category — intersection icons first (already on the site AND in
 * the report), then the report-only newcomers — plus a SUGGESTED CUTS block
 * underneath: the website-only icons the data says to drop, each with a
 * "Keep" button for the ones staying on brand-identity grounds. The list is
 * fully editable after that: remove, reorder, or swap in any icon from the
 * ranked pool. "Copy list" puts the final names on the clipboard for updating
 * the metaobject in Shopify admin.
 */

export type SlimIcon = {
  icon: string;
  category: string;
  /** Order count in the compare window. */
  count: number;
  hexes: string[];
  /** 1-based rank in the compare window, 0 = unranked (no orders). */
  rank: number;
  /** Image URL (/api/image/<fileId>) when the catalog has a PNG. */
  img?: string;
  /** Position in the current website category (cuts only). */
  sitePos?: number;
};

type Tag = "both" | "new" | "added" | "brand";
type Tagged = SlimIcon & { tag: Tag };

type EditEntry =
  | { kind: "keep"; icon: string; rank: number; count: number }
  | { kind: "add"; icon: string; rank: number; count: number }
  | { kind: "remove"; icon: string; tag: Tag }
  | { kind: "move"; icon: string; from: number; to: number };

function editText(e: EditEntry): string {
  switch (e.kind) {
    case "keep":
      return `Kept "${e.icon}" — was a suggested cut${
        e.rank > 0 ? ` (#${e.rank} · ${e.count.toLocaleString()} orders this window)` : " (no orders this window)"
      }`;
    case "add":
      return `Added "${e.icon}"${e.rank > 0 ? ` (#${e.rank} · ${e.count.toLocaleString()} orders)` : ""}`;
    case "remove":
      return `Removed "${e.icon}" (was tagged ${TAG_STYLES[e.tag].label})`;
    case "move":
      return `Moved "${e.icon}" from #${e.from} to #${e.to}`;
  }
}

const TAG_STYLES: Record<Tag, { label: string; cls: string }> = {
  both: { label: "match", cls: "bg-parchment text-ink-soft" },
  new: { label: "new", cls: "bg-pink-soft text-cherry" },
  added: { label: "added", cls: "bg-plum/10 text-plum" },
  brand: { label: "kept", cls: "bg-espresso/10 text-espresso" },
};

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

function Thumb({ item, size = "h-9 w-9" }: { item: SlimIcon; size?: string }) {
  if (!item.img) {
    return (
      <span className={`flex ${size} flex-none items-center justify-center rounded-md border border-parchment bg-white`}>
        <Swatches hexes={item.hexes} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={item.img}
      alt={item.icon}
      loading="lazy"
      className={`${size} flex-none rounded-md border border-parchment bg-white object-contain p-0.5`}
    />
  );
}

export default function CategoryCompare({
  matches,
  reportOnly,
  cuts,
  pool,
  months,
  top,
  categoryTitle,
  dataUpdatedAt,
}: {
  /** Icons in both the website category and the report, in report-rank order. */
  matches: SlimIcon[];
  /** Icons in the report but not on the website, in report-rank order. */
  reportOnly: SlimIcon[];
  /** Website-only icons — the suggested cuts, in site-position order. */
  cuts: SlimIcon[];
  /** Every ranked icon in the window — the swap-in pool. */
  pool: SlimIcon[];
  months: number;
  /** Report depth the comparison ran against (top N) — printed on the PDF. */
  top: number;
  categoryTitle: string;
  /** When the order data was last written — printed on the PDF. */
  dataUpdatedAt?: string | null;
}) {
  const [list, setList] = useState<Tagged[] | null>(null);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [edits, setEdits] = useState<EditEntry[]>([]);

  const inList = useMemo(() => new Set((list ?? []).map((i) => i.icon.toLowerCase())), [list]);

  /** Cuts still cut: anything kept (or re-added) drops out of this block. */
  const pendingCuts = useMemo(
    () => cuts.filter((c) => !inList.has(c.icon.toLowerCase())),
    [cuts, inList]
  );

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
    setEdits([]);
    setCopied(false);
  }

  function remove(icon: string) {
    setList((l) => {
      if (!l) return l;
      const hit = l.find((i) => i.icon === icon);
      if (hit) setEdits((e) => [...e, { kind: "remove", icon, tag: hit.tag }]);
      return l.filter((i) => i.icon !== icon);
    });
    setCopied(false);
  }

  function move(icon: string, dir: -1 | 1) {
    setList((l) => {
      if (!l) return l;
      const idx = l.findIndex((i) => i.icon === icon);
      const to = idx + dir;
      if (idx < 0 || to < 0 || to >= l.length) return l;
      // Coalesce a run of arrow clicks on the same icon into one log entry;
      // a move that returns to its start drops out of the log entirely.
      setEdits((e) => {
        const last = e[e.length - 1];
        if (last && last.kind === "move" && last.icon === icon) {
          if (last.from === to + 1) return e.slice(0, -1);
          return [...e.slice(0, -1), { ...last, to: to + 1 }];
        }
        return [...e, { kind: "move", icon, from: idx + 1, to: to + 1 }];
      });
      const next = [...l];
      [next[idx], next[to]] = [next[to], next[idx]];
      return next;
    });
    setCopied(false);
  }

  function add(item: SlimIcon, tag: Tag = "added") {
    setList((l) => (l ? [...l, { ...item, tag }] : l));
    setEdits((e) => [
      ...e,
      tag === "brand"
        ? { kind: "keep", icon: item.icon, rank: item.rank, count: item.count }
        : { kind: "add", icon: item.icon, rank: item.rank, count: item.count },
    ]);
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

  async function downloadPdf() {
    if (!list || downloading) return;
    setDownloading(true);
    try {
      const res = await fetch("/api/category-export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: categoryTitle,
          months,
          top,
          updatedAt: dataUpdatedAt ?? null,
          items: list,
          cuts: pendingCuts,
          edits: edits.map(editText),
        }),
      });
      if (!res.ok) throw new Error(`export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const slug = categoryTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "category";
      a.href = url;
      a.download = `abbode-suggested-category-${slug}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      // Keep it quiet but visible: flip the button label briefly via copied=false noop.
      alert("PDF export failed — try again, and if it keeps failing send me the /api/category-export log line.");
    } finally {
      setDownloading(false);
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
          {reportOnly.length}). The {cuts.length} website-only icon{cuts.length === 1 ? "" : "s"} appear underneath as
          suggested cuts — keep any of them with one click, and swap anything else in or out after.
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
            onClick={downloadPdf}
            disabled={downloading}
            className="font-ui rounded-full bg-plum px-3.5 py-1.5 text-[11px] font-semibold text-porcelain transition-colors hover:bg-cherry focus-ring disabled:opacity-60"
          >
            {downloading ? "Building PDF…" : "Download PDF"}
          </button>
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
            <Thumb item={i} />
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

      {pendingCuts.length > 0 ? (
        <div className="mt-4 rounded-lg border border-cherry/25 bg-pink-soft/40 p-3">
          <p className="font-ui mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-cherry">
            Suggested cuts — {pendingCuts.length}
          </p>
          <p className="font-ui mb-2 text-[11px] text-ink-muted">
            On the website today, outside the report.
          </p>
          <ul className="divide-y divide-cherry/10">
            {pendingCuts.map((c) => (
              <li key={c.icon} className="flex items-center gap-2.5 py-1.5">
                <Thumb item={c} />
                <span className="font-ui min-w-0 flex-1 truncate text-xs">
                  <span className="font-semibold text-espresso">{c.icon}</span>
                  {c.category ? <span className="text-ink-muted"> · {c.category}</span> : null}
                </span>
                <span className="font-ui text-right text-xs tabular-nums text-ink-soft">
                  {c.rank > 0 ? `#${c.rank} · ${c.count.toLocaleString()} orders` : "no orders this window"}
                  {c.sitePos ? ` · site pos ${c.sitePos}` : ""}
                </span>
                <button
                  type="button"
                  onClick={() => add(c, "brand")}
                  className="font-ui ml-1 rounded-full border border-espresso/30 bg-white px-2.5 py-1 text-[10px] font-semibold text-espresso transition-colors hover:bg-parchment focus-ring"
                >
                  Keep
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="font-ui mt-4 text-[11px] text-ink-muted">
          All website-only icons have been kept or there were none to cut.
        </p>
      )}

      {edits.length > 0 ? (
        <div className="mt-3 rounded-lg border border-parchment bg-cream-50 p-3">
          <p className="font-ui mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft">
            Edit log — {edits.length} (prints on the PDF)
          </p>
          <ol className="list-decimal space-y-0.5 pl-5">
            {edits.map((e, i) => (
              <li key={i} className="font-ui text-[11px] text-ink-soft">
                {editText(e)}
              </li>
            ))}
          </ol>
        </div>
      ) : null}

      <div className="relative mt-3">
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Swap an icon in — search the ranked list…"
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
                  <Thumb item={p} size="h-8 w-8" />
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
