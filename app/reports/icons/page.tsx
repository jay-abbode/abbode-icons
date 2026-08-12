import Link from "next/link";
import Header from "@/components/Header";
import ReportCategorySelect from "@/components/ReportCategorySelect";
import { getIconWindows, sortForWindow, ALL_WINDOWS, type WindowMonths } from "@/lib/iconWindows";
import { orderCategories } from "@/lib/categories";

export const dynamic = "force-dynamic";

/**
 * /reports/icons — the Icon Data dropdown, grown into a full report.
 *
 * Pick a rolling window (3 / 6 / 12 months), a depth (top 10–100 or the whole
 * list), and optionally a category; the ranked table re-filters and re-sorts,
 * and the Export button downloads the same view as a branded PDF
 * (/api/icon-data-export, which honors the same ?category= param).
 *
 * Data: the ICON_WINDOWS tab (all three windows side by side, written by the
 * order-stats script). Until that tab exists, the page stitches 3- and
 * 12-month numbers from ORDER_STATS + THREAD_STATS and greys the 6-month pill.
 */

const TOP_CHOICES = [10, 20, 30, 50, 100] as const;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseMonths(v: string | undefined): WindowMonths {
  return v === "3" ? 3 : v === "6" ? 6 : 12;
}

/** Case/space-insensitive form for category matching (same spirit as lib/categories). */
function canon(s: string): string {
  return (s || "").trim().toLowerCase();
}

function href(months: WindowMonths, top: number, category: string): string {
  return `/reports/icons?months=${months}${top > 0 ? `&top=${top}` : ""}${
    category ? `&category=${encodeURIComponent(category)}` : ""
  }`;
}

export default async function IconReportPage({
  searchParams,
}: {
  searchParams: { months?: string | string[]; top?: string | string[]; category?: string | string[] };
}) {
  let snap;
  try {
    snap = await getIconWindows();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return (
      <>
        <Header showSearch={false} />
        <main className="mx-auto max-w-3xl p-10">
          <h1 className="font-display text-3xl text-tomato">Failed to load icon data</h1>
          <pre className="mt-4 rounded-lg bg-pink-soft p-4 text-xs text-cherry">{message}</pre>
        </main>
      </>
    );
  }

  const wanted = parseMonths(one(searchParams.months));
  const months: WindowMonths = snap.available.includes(wanted)
    ? wanted
    : snap.available.includes(12)
      ? 12
      : (snap.available[0] ?? 12);

  const topParam = parseInt(one(searchParams.top) ?? "30", 10);
  const top = Number.isFinite(topParam) && topParam > 0 ? topParam : 0; // 0 = all

  // Category list is derived live from the stats rows (same convention as the
  // catalog: alphabetical, Premade Designs pinned last). The param is matched
  // case/space-insensitively; an unknown value just means "no filter".
  const categories = orderCategories(
    Array.from(new Set(snap.stats.map((s) => s.category).filter(Boolean)))
  );
  const catParam = one(searchParams.category) ?? "";
  const category = categories.find((c) => canon(c) === canon(catParam)) ?? "";

  const rankedAll = sortForWindow(snap.stats, months).filter((s) => s.counts[months] > 0);
  const ranked = category ? rankedAll.filter((s) => canon(s.category) === canon(category)) : rankedAll;
  const shown = top > 0 ? ranked.slice(0, top) : ranked;
  const maxCount = Math.max(1, ...shown.map((s) => s.counts[months]));
  const total = category
    ? ranked.reduce((sum, s) => sum + s.counts[months], 0)
    : snap.totals[months];

  const pillOn = "bg-plum font-semibold text-porcelain";
  const pillOff = "bg-parchment text-ink-soft hover:text-espresso";

  return (
    <>
      <Header showSearch={false} />
      <main className="mx-auto max-w-5xl px-6 py-12 lg:px-10 lg:py-16">
        <div className="mb-6">
          <p className="font-ui mb-2 text-xs uppercase tracking-[0.25em] text-berry">Icon report</p>
          <h1 className="font-display text-4xl font-medium tracking-tight text-espresso md:text-5xl">
            Most-ordered icons
          </h1>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft">
            Every ordered icon ranked by how often customers pick it, with its catalog thread colors. Choose the
            rolling window and how deep to go, then export the same view as a PDF.
          </p>
          <p className="font-ui mt-3 text-xs text-ink-muted">
            {total.toLocaleString()} icon orders · rolling {months} months
            {category ? ` · ${category}` : ""}
            {snap.updatedAt ? ` · data updated ${snap.updatedAt}` : ""}
          </p>
        </div>

        {snap.stats.length === 0 ? (
          <div className="rounded-xl border border-cream-200 bg-cream-50 p-5">
            <p className="font-ui text-sm text-ink-soft">
              No order data yet — run the <span className="font-semibold">Icon order stats</span> workflow (repo →
              Actions) to populate the sheet, then refresh.
            </p>
          </div>
        ) : (
          <>
            <div className="font-ui mb-5 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-ink-muted">Window:</span>
                {ALL_WINDOWS.map((w) =>
                  snap.available.includes(w) ? (
                    <Link
                      key={w}
                      href={href(w, top, category)}
                      className={`rounded-full px-2.5 py-1 transition-colors ${w === months ? pillOn : pillOff}`}
                    >
                      {w} months
                    </Link>
                  ) : (
                    <span
                      key={w}
                      title="Populates on the next run of the Icon order stats workflow."
                      className="cursor-not-allowed rounded-full bg-parchment px-2.5 py-1 text-ink-muted/50"
                    >
                      {w} months
                    </span>
                  )
                )}
              </span>

              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-ink-muted">Show:</span>
                {TOP_CHOICES.map((n) => (
                  <Link
                    key={n}
                    href={href(months, n, category)}
                    className={`rounded-full px-2.5 py-1 transition-colors ${top === n ? pillOn : pillOff}`}
                  >
                    Top {n}
                  </Link>
                ))}
                <Link
                  href={href(months, 0, category)}
                  className={`rounded-full px-2.5 py-1 transition-colors ${top === 0 ? pillOn : pillOff}`}
                >
                  All {ranked.length.toLocaleString()}
                </Link>
              </span>

              <span className="flex flex-wrap items-center gap-1.5">
                <span className="text-ink-muted">Category:</span>
                <ReportCategorySelect categories={categories} current={category} />
              </span>

              <a
                href={`/api/icon-data-export?months=${months}${top > 0 ? `&top=${top}` : ""}${
                  category ? `&category=${encodeURIComponent(category)}` : ""
                }`}
                download
                className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-pink bg-white px-3.5 py-1.5 text-[11px] font-semibold text-cherry transition-colors hover:bg-pink-soft focus-ring"
              >
                <svg
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-3 w-3"
                  aria-hidden
                >
                  <path d="M8 2v8m0 0 3-3m-3 3-3-3" />
                  <path d="M3 12v1.5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5V12" />
                </svg>
                Export PDF — {top > 0 ? `top ${Math.min(top, ranked.length)}` : "full list"} · {months}mo
              </a>

              <Link
                href="/reports/icons/compare"
                className="inline-flex items-center gap-1.5 rounded-full bg-plum px-3.5 py-1.5 text-[11px] font-semibold text-porcelain transition-colors hover:bg-cherry focus-ring"
              >
                Generate comparison report →
              </Link>
            </div>

            <div className="overflow-hidden rounded-xl border border-parchment bg-white">
              <table className="font-ui w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-parchment text-left text-[10px] uppercase tracking-wide text-ink-muted">
                    <th className="w-10 py-2 pl-4 pr-2 text-right font-semibold">#</th>
                    <th className="w-16 px-2 py-2 font-semibold">Colors</th>
                    <th className="px-2 py-2 font-semibold">Icon</th>
                    <th className="hidden px-2 py-2 font-semibold sm:table-cell">Category</th>
                    <th className="w-20 px-2 py-2 text-right font-semibold">Orders</th>
                    <th className="hidden w-40 py-2 pl-2 pr-4 font-semibold md:table-cell">Frequency</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-6 text-center text-xs text-ink-muted">
                        No {category ? `${category} ` : ""}orders in the last {months} months — try a longer
                        window or another category.
                      </td>
                    </tr>
                  )}
                  {shown.map((s, i) => (
                    <tr
                      key={s.icon}
                      className={`border-b border-parchment/60 last:border-b-0 ${i % 2 === 1 ? "bg-cream-50" : ""}`}
                    >
                      <td className="py-1.5 pl-4 pr-2 text-right tabular-nums text-xs text-ink-muted">{i + 1}</td>
                      <td className="px-2 py-1.5">
                        <span className="flex -space-x-0.5" aria-hidden>
                          {s.hexes.length ? (
                            s.hexes.slice(0, 4).map((hex, k) => (
                              <span
                                key={k}
                                className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10"
                                style={{ backgroundColor: hex }}
                              />
                            ))
                          ) : (
                            <span className="h-3.5 w-3.5 rounded-full bg-parchment ring-1 ring-black/10" />
                          )}
                        </span>
                      </td>
                      <td
                        className={`px-2 py-1.5 text-xs ${i < 15 ? "font-semibold text-espresso" : "text-ink-soft"}`}
                      >
                        {s.icon}
                      </td>
                      <td className="hidden px-2 py-1.5 text-xs text-ink-muted sm:table-cell">{s.category}</td>
                      <td
                        className={`px-2 py-1.5 text-right tabular-nums text-xs ${
                          i < 15 ? "font-semibold text-espresso" : "text-ink-soft"
                        }`}
                      >
                        {s.counts[months].toLocaleString()}
                      </td>
                      <td className="hidden py-1.5 pl-2 pr-4 md:table-cell">
                        <span className="block h-1.5 w-full rounded-full bg-parchment">
                          <span
                            className={`block h-1.5 rounded-full ${i < 15 ? "bg-berry" : "bg-ink-muted/50"}`}
                            style={{ width: `${Math.max(2, (100 * s.counts[months]) / maxCount)}%` }}
                          />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="font-ui mt-4 text-[11px] text-ink-muted">
              Swatches show each icon&rsquo;s catalog thread colors. Windows are rolling from today; an icon&rsquo;s
              3-month orders are included in its 6- and 12-month counts.
              {!snap.available.includes(6)
                ? " The 6-month window appears after the next run of the Icon order stats workflow."
                : ""}
            </p>
          </>
        )}
      </main>
    </>
  );
}
