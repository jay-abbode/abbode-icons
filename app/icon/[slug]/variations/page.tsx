import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import { getIconCatalog } from "@/lib/sheets";
import { THREAD_PALETTE, rgbToHex } from "@/lib/threadPalette";

export const dynamic = "force-dynamic";

interface Props {
  params: { slug: string };
}

/**
 * /icon/<slug>/variations — grid of the icon recolored in all 24 Madeira
 * thread colors. Only valid for icons with hasColorVariation = true (i.e.
 * Col. Var. = "YES" exactly, not "YES/MC" or "NO"). Recoloring happens
 * server-side in /api/image/<fileId>?slot=N.
 */
export default async function VariationsPage({ params }: Props) {
  const catalog = await getIconCatalog();
  const icon = catalog.icons.find((i) => i.slug === params.slug);

  if (!icon || !icon.hasColorVariation || !icon.pngFileId) {
    notFound();
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
            <p className="font-ui mt-1.5 text-sm text-ink-muted">
              {icon.category} · 24 Madeira thread colors
            </p>
          </div>
          <Link
            href="/browse"
            className="font-ui self-start rounded-full border border-parchment bg-white px-3.5 py-1.5 text-xs font-semibold text-espresso transition-colors hover:border-pink hover:bg-pink-soft md:self-end"
          >
            ← Back to browse
          </Link>
        </header>

        <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6">
          {THREAD_PALETTE.map((thread) => {
            const hex = rgbToHex(thread.rgb);
            const src = `/api/image/${icon.pngFileId}?slot=${thread.slot}`;
            const downloadName = `${icon.name.replace(/[^\w-]+/g, "_")}_${thread.slot}_${thread.name.replace(
              /\s+/g,
              "_"
            )}.png`;
            return (
              <li
                key={thread.slot}
                className="flex flex-col overflow-hidden rounded-xl border border-parchment bg-white transition-shadow hover:shadow-[0_8px_24px_-12px_rgba(187,55,103,0.20)]"
              >
                <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-porcelain p-4">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={src}
                    alt={`${icon.name} in ${thread.name}`}
                    loading="lazy"
                    className="max-h-full max-w-full object-contain"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-parchment px-3 py-2.5">
                  <div className="flex min-w-0 items-center gap-2">
                    <span
                      className="h-3.5 w-3.5 flex-none rounded-full ring-1 ring-black/10"
                      style={{ backgroundColor: hex }}
                      aria-hidden
                    />
                    <div className="min-w-0">
                      <p className="font-ui truncate text-xs font-semibold text-espresso">
                        {thread.slot} {thread.name}
                      </p>
                      <p className="font-ui text-[10px] text-ink-muted">
                        Madeira {thread.code}
                      </p>
                    </div>
                  </div>
                  <a
                    href={src}
                    download={downloadName}
                    title={`Download ${thread.name} variation`}
                    aria-label={`Download ${thread.name} variation`}
                    className="font-ui flex h-7 w-7 flex-none items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-pink-soft hover:text-cherry focus-ring"
                  >
                    <DownloadIcon className="h-3.5 w-3.5" />
                  </a>
                </div>
              </li>
            );
          })}
        </ul>

        <p className="font-ui mt-10 max-w-2xl text-xs text-ink-muted">
          These previews are generated from the original PNG by remapping its
          single foreground color to each Madeira spool while preserving the
          stitch texture. They&apos;re for design reference — the embroidery
          files themselves stay format-agnostic; thread color is set on the
          machine when stitching.
        </p>
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
