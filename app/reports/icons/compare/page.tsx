import Link from "next/link";
import Header from "@/components/Header";
import CategoryCompare, { type SlimIcon } from "@/components/CategoryCompare";
import { getIconWindows, sortForWindow, type WindowMonths } from "@/lib/iconWindows";
import { getIconCategories } from "@/lib/iconCategories";
import { getIconCatalog } from "@/lib/sheets";
import { normIconName } from "@/lib/orderStats";

export const dynamic = "force-dynamic";

/**
 * /reports/icons/compare — the website's "Most Popular" category vs the order
 * data, side by side:
 *
 *   MATCHES        on the website AND in the top-N report      → earning their spot
 *   IN REPORT ONLY customers order them, site doesn't feature  → add candidates
 *   ON SITE ONLY   featured but not in the top-N               → drop candidates
 *
 * Then "Generate Suggested Category" builds the replacement list (matches
 * first, then report newcomers) with the website-only icons underneath as
 * SUGGESTED CUTS — each keepable in one click for brand-identity reasons —
 * and the whole list editable icon by icon before copying it out.
 *
 *   ?months=3&top=30   the report side (defaults: 3 months, top 30)
 *   ?category=handle   another synced website category (default most-popular)
 *
 * Website side comes from the ICON_CATEGORIES tab, refreshed by the
 * "Icon categories sync" workflow — as fresh as its last run. Icon images come
 * from the catalog's Drive PNGs via /api/image.
 */

const TOP_CHOICES = [10, 20, 30, 50] as const;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function parseMonths(v: string | undefined): WindowMonths {
  return v === "6" ? 6 : v === "12" ? 12 : 3;
}

function Swatches({ hexes }: { hexes: string[] }) {
  return (
    <span className="flex flex-none -space-x-0.5" aria-hidden>
      {hexes.length ? (
        hexes.slice(0, 4).map((hex, i) => (
          <span key={i} className="h-3.5 w-3.5 rounded-full ring-1 ring-black/10" style={{ backgroundColor: hex }} />
        ))
      ) : (
        <span className="h-3.5 w-3.5 rounded-full bg-parchment ring-1 ring-black/10" />
      )}
    </span>
  );
}

function RowVisual({ img, name, hexes }: { img?: string; name: string; hexes: string[] }) {
  if (img) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={img}
        alt={name}
        loading="lazy"
        className="h-9 w-9 flex-none rounded-md border border-parchment bg-white object-contain p-0.5"
      />
    );
  }
  return (
    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-md border border-parchment bg-white">
      <Swatches hexes={hexes} />
    </span>
  );
}

function Section({
  tone,
  title,
  note,
  rows,
}: {
  tone: "match" | "add" | "drop";
  title: string;
  note: string;
  rows: { key: string; hexes: string[]; name: string; category: string; detail: string; img?: string }[];
}) {
  const border = tone === "match" ? "border-plum/25" : tone === "add" ? "border-berry/30" : "border-cherry/30";
  const heading = tone === "match" ? "text-plum" : tone === "add" ? "text-berry" : "text-cherry";
  return (
    <section className="mb-6">
      <div className={`mb-2 border-b-2 ${border} pb-1`}>
        <h2 className={`font-display text-xl ${heading}`}>
          {title}
          <span className="font-ui ml-2 text-xs font-normal text-ink-muted">{note}</span>
        </h2>
      </div>
      {rows.length === 0 ? (
        <p className="font-ui py-2 text-xs text-ink-muted">None.</p>
      ) : (
        <ul className="divide-y divide-parchment/60">
          {rows.map((r) => (
            <li key={r.key} className="flex items-center gap-2.5 py-1.5">
              <RowVisual img={r.img} name={r.name} hexes={r.hexes} />
              <span className="font-ui min-w-0 flex-1 truncate text-xs">
                <span className="font-semibold text-espresso">{r.name}</span>
                {r.category ? <span className="text-ink-muted"> · {r.category}</span> : null}
              </span>
              <span className="font-ui text-right text-xs tabular-nums text-ink-soft">{r.detail}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: { months?: string | string[]; top?: string | string[]; category?: string | string[] };
}) {
  let snap, cats, catalog;
  try {
    [snap, cats, catalog] = await Promise.all([
      getIconWindows(),
      getIconCategories(),
      getIconCatalog().catch(() => null),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return (
      <>
        <Header showSearch={false} />
        <main className="mx-auto max-w-3xl p-10">
          <h1 className="font-display text-3xl text-tomato">Failed to load comparison data</h1>
          <pre className="mt-4 rounded-lg bg-pink-soft p-4 text-xs text-cherry">{message}</pre>
        </main>
      </>
    );
  }

  const wanted = parseMonths(one(searchParams.months));
  const months: WindowMonths = snap.available.includes(wanted) ? wanted : snap.available.includes(3) ? 3 : 12;
  const topParam = parseInt(one(searchParams.top) ?? "30", 10);
  const top = Number.isFinite(topParam) && topParam > 0 ? topParam : 30;
  const handle = one(searchParams.category) || "most-popular";

  // Icon PNGs, keyed by normalized name (current and legacy) — the compare
  // rows and the builder show the actual designs, not just thread swatches.
  const imgByKey = new Map<string, string>();
  for (const icon of catalog?.icons ?? []) {
    if (!icon.pngFileId) continue;
    const url = `/api/image/${icon.pngFileId}`;
    imgByKey.set(normIconName(icon.name), url);
    if (icon.oldName) imgByKey.set(normIconName(icon.oldName), url);
  }
  const imgFor = (name: string) => imgByKey.get(normIconName(name));

  const website = cats.categories.get(handle);
  const ranked = sortForWindow(snap.stats, months).filter((s) => s.counts[months] > 0);
  const rankByKey = new Map(ranked.map((s, i) => [normIconName(s.icon), { stat: s, rank: i + 1 }]));

  const chrome = (
    <div className="mb-6">
      <p className="font-ui mb-2 text-xs uppercase tracking-[0.25em] text-berry">Comparison report</p>
      <h1 className="font-display text-4xl font-medium tracking-tight text-espresso md:text-5xl">
        Website vs. what sells
      </h1>
      <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft">
        The site&rsquo;s &ldquo;{website?.title ?? "Most Popular"}&rdquo; category against the top {top} most-ordered
        icons of the last {months === 3 ? "90 days" : `${months} months`} — what&rsquo;s earning its spot, what
        customers order that the site doesn&rsquo;t feature, and what&rsquo;s featured without the orders to show for
        it.
      </p>
    </div>
  );

  // ── Empty states ───────────────────────────────────────────────────────────
  if (!cats.tabFound || !website) {
    return (
      <>
        <Header showSearch={false} />
        <main className="mx-auto max-w-5xl px-6 py-12 lg:px-10 lg:py-16">
          {chrome}
          <div className="rounded-xl border border-cream-200 bg-cream-50 p-5">
            <h2 className="font-display text-lg text-espresso">
              {cats.tabFound ? `No synced "${handle}" category` : "The website categories haven't been synced yet"}
            </h2>
            <p className="font-ui mt-2 text-sm text-ink-soft">
              Run the <span className="font-semibold">Icon categories sync</span> workflow (repo → Actions → Icon
              categories sync → Run workflow), then refresh. It snapshots the Shopify metaobjects into the
              ICON_CATEGORIES tab and needs the <span className="font-semibold">read_metaobjects</span> scope on the
              Dev Dashboard app — if the run fails, the log says exactly what to add.
            </p>
          </div>
        </main>
      </>
    );
  }

  if (ranked.length === 0) {
    return (
      <>
        <Header showSearch={false} />
        <main className="mx-auto max-w-5xl px-6 py-12 lg:px-10 lg:py-16">
          {chrome}
          <div className="rounded-xl border border-cream-200 bg-cream-50 p-5">
            <p className="font-ui text-sm text-ink-soft">
              No order data for this window yet — run the <span className="font-semibold">Icon order stats</span>{" "}
              workflow first.
            </p>
          </div>
        </main>
      </>
    );
  }

  // ── The three-way split ────────────────────────────────────────────────────
  const reportTop = ranked.slice(0, top);
  const reportKeys = new Set(reportTop.map((s) => normIconName(s.icon)));

  const siteMatched = website.icons.filter((i) => i.canon);
  const siteUnmatched = website.icons.filter((i) => !i.canon);
  const websiteKeys = new Set(siteMatched.map((i) => normIconName(i.canon)));
  const sitePosByKey = new Map(siteMatched.map((i) => [normIconName(i.canon), i.position]));

  const matches = reportTop.filter((s) => websiteKeys.has(normIconName(s.icon)));
  const reportOnly = reportTop.filter((s) => !websiteKeys.has(normIconName(s.icon)));
  const websiteOnly = siteMatched.filter((i) => !reportKeys.has(normIconName(i.canon)));

  const slim = (s: (typeof ranked)[number]): SlimIcon => ({
    icon: s.icon,
    category: s.category,
    count: s.counts[months],
    hexes: s.hexes,
    rank: rankByKey.get(normIconName(s.icon))?.rank ?? 0,
    img: imgFor(s.icon),
  });

  // Website-only icons as SlimIcons for the builder's suggested-cuts block.
  const cutSlim = websiteOnly.map((i): SlimIcon => {
    const hit = rankByKey.get(normIconName(i.canon));
    return {
      icon: i.canon,
      category: hit?.stat.category ?? "",
      count: hit?.stat.counts[months] ?? 0,
      hexes: hit?.stat.hexes ?? [],
      rank: hit?.rank ?? 0,
      img: imgFor(i.canon),
      sitePos: i.position,
    };
  });

  const pillOn = "bg-plum font-semibold text-porcelain";
  const pillOff = "bg-parchment text-ink-soft hover:text-espresso";
  const href = (m: WindowMonths, t: number) => `/reports/icons/compare?months=${m}&top=${t}`;

  return (
    <>
      <Header showSearch={false} />
      <main className="mx-auto max-w-5xl px-6 py-12 lg:px-10 lg:py-16">
        {chrome}

        <p className="font-ui -mt-2 mb-5 text-xs text-ink-muted">
          Website category: {website.icons.length} icons
          {website.categoryUpdatedAt ? ` · last edited ${website.categoryUpdatedAt.slice(0, 10)}` : ""}
          {website.syncedAt ? ` · synced ${website.syncedAt.slice(0, 10)}` : ""} · Report:{" "}
          {snap.updatedAt ? `updated ${snap.updatedAt}` : "—"}
        </p>

        <div className="font-ui mb-6 flex flex-wrap items-center gap-x-5 gap-y-3 text-xs">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink-muted">Window:</span>
            {([3, 6, 12] as WindowMonths[]).map((w) =>
              snap.available.includes(w) ? (
                <Link key={w} href={href(w, top)} className={`rounded-full px-2.5 py-1 transition-colors ${w === months ? pillOn : pillOff}`}>
                  {w === 3 ? "90 days" : `${w} months`}
                </Link>
              ) : (
                <span key={w} title="Populates on the next Icon order stats run." className="cursor-not-allowed rounded-full bg-parchment px-2.5 py-1 text-ink-muted/50">
                  {w} months
                </span>
              )
            )}
          </span>
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-ink-muted">Report depth:</span>
            {TOP_CHOICES.map((n) => (
              <Link key={n} href={href(months, n)} className={`rounded-full px-2.5 py-1 transition-colors ${top === n ? pillOn : pillOff}`}>
                Top {n}
              </Link>
            ))}
          </span>
          <Link href="/reports/icons" className="ml-auto text-ink-muted underline hover:text-espresso">
            ← Icon report
          </Link>
        </div>

        <Section
          tone="match"
          title={`Matches (${matches.length})`}
          note="on the website and in the report — earning their spot"
          rows={matches.map((s) => ({
            key: s.icon,
            hexes: s.hexes,
            img: imgFor(s.icon),
            name: s.icon,
            category: s.category,
            detail: `#${rankByKey.get(normIconName(s.icon))?.rank} · ${s.counts[months].toLocaleString()} orders · site pos ${sitePosByKey.get(normIconName(s.icon)) ?? "—"}`,
          }))}
        />

        <Section
          tone="add"
          title={`In the report, not on the website (${reportOnly.length})`}
          note="customers order these — the site doesn't feature them"
          rows={reportOnly.map((s) => ({
            key: s.icon,
            hexes: s.hexes,
            img: imgFor(s.icon),
            name: s.icon,
            category: s.category,
            detail: `#${rankByKey.get(normIconName(s.icon))?.rank} · ${s.counts[months].toLocaleString()} orders`,
          }))}
        />

        <Section
          tone="drop"
          title={`On the website, not in the report (${websiteOnly.length})`}
          note={`featured, but outside the top ${top} for this window`}
          rows={websiteOnly.map((i) => {
            const hit = rankByKey.get(normIconName(i.canon));
            return {
              key: `${i.canon}-${i.position}`,
              hexes: hit?.stat.hexes ?? [],
              img: imgFor(i.canon),
              name: i.canon,
              category: hit?.stat.category ?? "",
              detail: hit
                ? `#${hit.rank} · ${hit.stat.counts[months].toLocaleString()} orders · site pos ${i.position}`
                : `no orders this window · site pos ${i.position}`,
            };
          })}
        />

        {siteUnmatched.length > 0 ? (
          <div className="mb-6 rounded-xl border border-cream-200 bg-cream-50 px-4 py-3">
            <p className="font-ui text-xs text-ink-soft">
              <span className="font-semibold text-espresso">
                {siteUnmatched.length} website label{siteUnmatched.length === 1 ? "" : "s"} couldn&rsquo;t be matched
              </span>{" "}
              to a catalog icon and sit outside the comparison:{" "}
              {siteUnmatched.map((i) => i.label).join(", ")}. Add them to the ICON_ALIASES tab and re-run the sync to
              include them.
            </p>
          </div>
        ) : null}

        <CategoryCompare
          matches={matches.map(slim)}
          reportOnly={reportOnly.map(slim)}
          cuts={cutSlim}
          pool={ranked.map(slim)}
          months={months}
          top={top}
          categoryTitle={website.title}
          dataUpdatedAt={snap.updatedAt}
        />
      </main>
    </>
  );
}
