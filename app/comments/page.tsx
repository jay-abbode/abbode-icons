import Link from "next/link";
import Header from "@/components/Header";
import { getAllComments } from "@/lib/comments";

export const dynamic = "force-dynamic";

export default async function CommentsPage() {
  const comments = await getAllComments();

  return (
    <>
      <Header showSearch={false} />
      <main className="mx-auto max-w-3xl px-6 py-10 lg:px-10">
        <nav className="font-ui mb-6 flex items-center gap-2 text-xs text-ink-muted">
          <Link href="/" className="hover:text-espresso transition-colors">
            Home
          </Link>
          <span aria-hidden>›</span>
          <span className="text-espresso">Notes</span>
        </nav>

        <header className="mb-8">
          <h1 className="font-display text-4xl font-medium tracking-tightest text-espresso md:text-5xl">
            Notes
          </h1>
          <p className="font-ui mt-1.5 text-sm text-ink-muted">
            {comments.length.toLocaleString()}{" "}
            {comments.length === 1 ? "note" : "notes"} from the team
          </p>
        </header>

        {comments.length === 0 ? (
          <EmptyState />
        ) : (
          <ol className="space-y-4">
            {comments.map((c, idx) => (
              <li
                key={`${c.timestamp}-${idx}`}
                className="rounded-2xl border border-parchment bg-white p-5"
              >
                <header className="flex items-baseline justify-between gap-3">
                  <Link
                    href={`/browse?q=${encodeURIComponent(c.iconName)}`}
                    className="font-display text-lg text-espresso transition-colors hover:text-cherry"
                  >
                    {c.iconName || "(unknown icon)"}
                  </Link>
                  {c.iconCategory && (
                    <span className="font-ui shrink-0 text-[11px] text-ink-muted">
                      {c.iconCategory}
                    </span>
                  )}
                </header>

                <p className="font-ui mt-2 whitespace-pre-wrap text-sm leading-relaxed text-espresso">
                  {c.text}
                </p>

                <footer className="font-ui mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-ink-muted">
                  <span className="font-semibold text-ink-soft">
                    {c.authorName || c.authorEmail || "Unknown"}
                  </span>
                  {c.authorName && c.authorEmail && (
                    <span className="text-ink-muted/70">·</span>
                  )}
                  {c.authorEmail && c.authorName !== c.authorEmail && (
                    <span>{c.authorEmail}</span>
                  )}
                  <span className="text-ink-muted/70">·</span>
                  <time dateTime={c.timestamp}>{formatTimestamp(c.timestamp)}</time>
                </footer>
              </li>
            ))}
          </ol>
        )}
      </main>
    </>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-parchment bg-parchment/50 px-8 py-16 text-center">
      <p className="font-display text-2xl text-espresso">No notes yet.</p>
      <p className="font-ui mt-2 max-w-sm text-sm text-ink-muted">
        Hit the comment icon on any icon&apos;s card to leave a note about color
        variations, sewing issues, or anything else worth flagging.
      </p>
      <Link
        href="/browse"
        className="font-ui mt-5 rounded-full border border-pink bg-white px-4 py-2 text-sm font-medium text-cherry transition-colors hover:bg-pink-soft"
      >
        Browse all icons
      </Link>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
