import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import { getIconCatalog, type Icon } from "@/lib/sheets";
import { THREAD_PALETTE, getThreadBySlot, rgbToHex } from "@/lib/threadPalette";
import {
  getMultiColorRule,
  getAnchorRgb,
  getAccentForBase,
  type MultiColorRule,
} from "@/lib/multiColorRules";

export const dynamic = "force-dynamic";

interface Props {
  params: { slug: string };
}

/**
 * /icon/<slug>/variations
 *
 * Three rendering paths:
 *   1. Multi-color icon with a configured rule → render either the named
 *      colorways or all 24 base colors with the rule's accent.
 *   2. Multi-color icon WITHOUT a rule yet → safe placeholder (we don't
 *      run single-color recolor on a multi-color source since the result
 *      would tint everything one hue).
 *   3. Single-color icon (Col. Var. = YES) → all 24 Madeira colors as
 *      before.
 */

type Variant = {
  key: string;
  label: string;
  sublabel: string;
  swatchHex: string;
  src: string;
  downloadName: string;
};

function safeFileName(name: string): string {
  return name.replace(/[^\w-]+/g, "_");
}

function buildVariants(icon: Icon, rule: MultiColorRule | null): Variant[] {
  if (!icon.pngFileId) return [];

  // Multi-color path with a rule
  if (icon.isMultiColor && rule) {
    const anchor = getAnchorRgb(rule);
    const anchorStr = anchor.join(",");

    if (rule.mode === "named") {
      return rule.variants.map((v, i) => {
        const baseThread = getThreadBySlot(v.base);
        const accentThread = getThreadBySlot(v.accent);
        const baseName = baseThread ? baseThread.name : `Slot ${v.base}`;
        const accentName = accentThread ? accentThread.name : `Slot ${v.accent}`;
        const swatchHex = baseThread ? rgbToHex(baseThread.rgb) : "#999999";
        return {
          key: `named-${i}`,
          label: v.label,
          sublabel: `${baseName} · ${accentName}`,
          swatchHex,
          src: `/api/image/${icon.pngFileId}?base=${v.base}&accent=${v.accent}&anchor=${anchorStr}`,
          downloadName: `${safeFileName(icon.name)}_${safeFileName(v.label)}.png`,
        };
      });
    }

    // all-24 mode
    return THREAD_PALETTE.map((thread) => {
      const accentSlot = getAccentForBase(rule, thread.slot);
      const accentThread = getThreadBySlot(accentSlot);
      const accentName = accentThread ? accentThread.name : `Slot ${accentSlot}`;
      return {
        key: `slot-${thread.slot}`,
        label: `${thread.slot} ${thread.name}`,
        sublabel: `with ${accentName}`,
        swatchHex: rgbToHex(thread.rgb),
        src: `/api/image/${icon.pngFileId}?base=${thread.slot}&accent=${accentSlot}&anchor=${anchorStr}`,
        downloadName: `${safeFileName(icon.name)}_${thread.slot}_${safeFileName(thread.name)}.png`,
      };
    });
  }

  // Single-color path (Col. Var. = YES)
  return THREAD_PALETTE.map((thread) => ({
    key: `slot-${thread.slot}`,
    label: `${thread.slot} ${thread.name}`,
    sublabel: `Madeira ${thread.code}`,
    swatchHex: rgbToHex(thread.rgb),
    src: `/api/image/${icon.pngFileId}?slot=${thread.slot}`,
    downloadName: `${safeFileName(icon.name)}_${thread.slot}_${safeFileName(thread.name)}.png`,
  }));
}

export default async function VariationsPage({ params }: Props) {
  const catalog = await getIconCatalog();
  const icon = catalog.icons.find((i) => i.slug === params.slug);

  if (!icon || !icon.hasColorVariation || !icon.pngFileId) {
    notFound();
  }

  const rule = icon.isMultiColor ? getMultiColorRule(icon.name) : null;
  const needsConfigNote = icon.isMultiColor && !rule;
  const variants = needsConfigNote ? [] : buildVariants(icon, rule);

  // Subtitle text
  let subtitle: string;
  if (needsConfigNote) {
    subtitle = `${icon.category} · multi-color design`;
  } else if (icon.isMultiColor && rule?.mode === "named") {
    subtitle = `${icon.category} · ${variants.length} preset colorway${
      variants.length === 1 ? "" : "s"
    }`;
  } else if (icon.isMultiColor) {
    subtitle = `${icon.category} · 24 base colors`;
  } else {
    subtitle = `${icon.category} · 24 Madeira thread colors`;
  }

  return (
    <>
      <Header showSearch={false} />
      <main className="mx-auto max-w-7xl px-6 py-10 lg:px-10">
        <nav className="font-ui mb-6 flex items-center gap-2 text-xs text-ink-muted">
          <Link href="/" className="hover:text-espresso transition-colors">
            Home
          </Link>
          <span aria-hidden>›</span>
          <Link
            href={`/browse?category=${encodeURIComponent(icon.category)}`}
            className="hover:text-espresso transition-colors"
          >
            {icon.category}
          </Link>
          <span aria-hidden>›</span>
          <span className="text-espresso">{icon.name}</span>
          <span aria-hidden>›</span>
          <span className="text-espresso">Variations</span>
        </nav>

        <header className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="font-ui text-[10px] font-semibold uppercase tracking-[0.16em] text-berry">
              Color variations
            </p>
            <h1 className="font-display mt-1 text-4xl font-medium tracking-tightest text-espresso md:text-5xl">
              {icon.name}
            </h1>
            <p className="font-ui mt-1.5 text-sm text-ink-muted">{subtitle}</p>
          </div>
          <Link
            href="/browse"
            className="font-ui self-start rounded-full border border-parchment bg-white px-3.5 py-1.5 text-xs font-semibold text-espresso transition-colors hover:border-pink hover:bg-pink-soft md:self-end"
          >
            ← Back to browse
          </Link>
        </header>

        {needsConfigNote ? (
          <div className="rounded-2xl border border-parchment bg-white p-8 text-center">
            <p className="font-display text-xl text-espresso">
              Variations for this design haven&apos;t been configured yet.
            </p>
            <p className="font-ui mt-2 text-sm text-ink-muted">
              {icon.name} uses multiple thread colors. Curated colorways will be
              added soon.
            </p>
          </div>
        ) : (
          <>
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
              {variants.map((v) => (
                <li
                  key={v.key}
                  className="flex flex-col overflow-hidden rounded-xl border border-parchment bg-white transition-shadow hover:shadow-[0_8px_24px_-12px_rgba(187,55,103,0.20)]"
                >
                  <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-porcelain p-4">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={v.src}
                      alt={`${icon.name} — ${v.label}`}
                      loading="lazy"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-parchment px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-3.5 w-3.5 flex-none rounded-full ring-1 ring-black/10"
                        style={{ backgroundColor: v.swatchHex }}
                        aria-hidden
                      />
                      <div className="min-w-0">
                        <p className="font-ui truncate text-xs font-semibold text-espresso">
                          {v.label}
                        </p>
                        <p className="font-ui truncate text-[10px] text-ink-muted">
                          {v.sublabel}
                        </p>
                      </div>
                    </div>
                    <a
                      href={v.src}
                      download={v.downloadName}
                      title={`Download ${v.label}`}
                      aria-label={`Download ${v.label} variation`}
                      className="font-ui flex h-7 w-7 flex-none items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-pink-soft hover:text-cherry focus-ring"
                    >
                      <DownloadIcon className="h-3.5 w-3.5" />
                    </a>
                  </div>
                </li>
              ))}
            </ul>

            <p className="font-ui mt-10 max-w-2xl text-xs text-ink-muted">
              {icon.isMultiColor
                ? "These previews are generated by classifying the source PNG into two regions and recoloring each independently while preserving the stitch texture. They're for design reference — the embroidery files themselves stay format-agnostic; thread colors are set on the machine when stitching."
                : "These previews are generated from the original PNG by remapping its single foreground color to each Madeira spool while preserving the stitch texture. They're for design reference — the embroidery files themselves stay format-agnostic; thread color is set on the machine when stitching."}
            </p>
          </>
        )}
      </main>
    </>
  );
}

function DownloadIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M8 2v8m0 0 3-3m-3 3-3-3" />
      <path d="M3 12v1.5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5V12" />
    </svg>
  );
}
