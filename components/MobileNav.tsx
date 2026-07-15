"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Hamburger menu — a slide-in drawer that holds every destination in one place.
 * On small screens it's the primary navigation (the centered desktop nav row is
 * hidden there); on large screens it stays available as an "everything" menu.
 *
 * The overlay is rendered through a portal on <body>. That matters: the header
 * uses backdrop-blur, and a backdrop-filter creates a containing block for
 * position:fixed descendants — so if the drawer lived inside the header it would
 * be clipped to the header's height instead of filling the viewport. Portaling
 * it to <body> lets `fixed inset-0` mean the whole screen again.
 *
 * The account section (name + Sign out) uses a server action passed down from
 * the header, so signing out works the same as the avatar menu.
 */

type Item = { href: string; label: string; badge?: number };

export default function MobileNav({
  commentTotal,
  user,
  onSignOut,
}: {
  commentTotal: number;
  user: { name?: string | null; email?: string | null } | null;
  onSignOut?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  // Portals need the DOM, so only render the overlay after mount (client-side).
  useEffect(() => setMounted(true), []);

  // Close on Escape and lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const primary: Item[] = [
    { href: "/machines", label: "Thread Config" },
    { href: "/", label: "Categories" },
    { href: "/browse", label: "All icons" },
    { href: "/assets", label: "Downloads" },
    { href: "/contact-sheet", label: "Generate Contact Sheet" },
    { href: "/comments", label: "Notes", badge: commentTotal },
  ];
  const reports: Item[] = [
    { href: "/composite", label: "Composite Data" },
    { href: "/trends", label: "Trends" },
    { href: "/reports/trends", label: "Product Trends" },
    { href: "/reports/usage", label: "Product Usage" },
  ];

  const rowClass =
    "font-ui flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium text-espresso transition-colors hover:bg-pink-soft";

  const overlay = (
    <div className={`fixed inset-0 z-50 ${open ? "" : "pointer-events-none"}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-espresso/50 transition-opacity duration-200 ${
          open ? "opacity-100" : "opacity-0"
        }`}
        onClick={() => setOpen(false)}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        className={`absolute inset-y-0 left-0 flex h-full w-80 max-w-[85%] flex-col border-r border-cream-200 bg-porcelain shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-parchment px-4 py-4">
          <span className="font-display text-xl text-plum">Menu</span>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close menu"
            className="flex h-8 w-8 items-center justify-center rounded-full border border-cream-200 bg-white text-ink-soft transition-colors hover:bg-pink-soft hover:text-cherry focus-ring"
          >
            ✕
          </button>
        </div>

        <nav className="flex flex-1 flex-col overflow-y-auto p-3">
          <div className="flex flex-col gap-0.5">
            {primary.map((it) => (
              <Link key={it.href} href={it.href} onClick={() => setOpen(false)} className={rowClass}>
                <span>{it.label}</span>
                {it.badge ? <Badge value={it.badge} /> : null}
              </Link>
            ))}
          </div>

          <div className="pt-2">
            <SavedSheetsSubmenu onNavigate={() => setOpen(false)} />
          </div>

          <p className="font-ui px-3 pb-1 pt-5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Data &amp; reports
          </p>
          <div className="flex flex-col gap-0.5">
            {reports.map((it) => (
              <Link key={it.href} href={it.href} onClick={() => setOpen(false)} className={rowClass}>
                <span>{it.label}</span>
              </Link>
            ))}
            <ScanNewIconsItem menuOpen={open} />
          </div>

          {user ? (
            <div className="mt-auto border-t border-parchment pt-3">
              <div className="px-3 pb-1">
                <p className="truncate text-sm font-semibold text-espresso">{user.name || "Account"}</p>
                {user.email ? <p className="font-ui truncate text-xs text-ink-muted">{user.email}</p> : null}
              </div>
              {onSignOut ? (
                <form action={onSignOut}>
                  <button type="submit" className={`${rowClass} w-full text-ink-soft hover:text-cherry`}>
                    Sign out
                  </button>
                </form>
              ) : null}
            </div>
          ) : null}
        </nav>
      </aside>
    </div>
  );

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-espresso transition-colors hover:bg-parchment focus-ring"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      </button>

      {mounted ? createPortal(overlay, document.body) : null}
    </>
  );
}

function Badge({ value }: { value: number }) {
  return (
    <span className="font-ui inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-cherry px-1 text-[10px] font-bold leading-none text-porcelain tabular-nums">
      {value > 99 ? "99+" : value}
    </span>
  );
}

/**
 * "Scan New Icons" — the visual search index trigger, living in the menu.
 *
 * The index (VISUAL_INDEX tab) gives each icon a short description of how it
 * looks so the search bar can match on material / color / pattern. This item
 * only ever scans icons that don't have a description yet — the server tracks
 * what's done, so the very first run captions everything and every run after
 * that just picks up newly-added icons.
 *
 * Status is fetched when the drawer OPENS (not on page load), so there's no
 * per-page cost. The label reflects the current state:
 *   - "Scan New Icons" + a count badge when unindexed icons exist,
 *   - a greyed-out "Nothing to Scan" when everything is up to date.
 * The scan runs in resumable batches; closing the menu doesn't stop it.
 */
function ScanNewIconsItem({ menuOpen }: { menuOpen: boolean }) {
  const [phase, setPhase] = useState<
    "checking" | "ready" | "running" | "done" | "error"
  >("checking");
  const [captioned, setCaptioned] = useState(0);
  const [total, setTotal] = useState(0);
  const [rateLimited, setRateLimited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);
  const fetchedAtRef = useRef(0);

  const newCount = Math.max(0, total - captioned);
  const pct = total > 0 ? Math.round((captioned / total) * 100) : 0;

  const row =
    "font-ui flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium text-espresso transition-colors";

  const checkStatus = useCallback(async () => {
    setPhase((p) => (p === "running" ? p : "checking"));
    try {
      const res = await fetch("/api/contact-sheet/build-index");
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Couldn't read index status.");
      setCaptioned(d.captioned);
      setTotal(d.total);
      fetchedAtRef.current = Date.now();
      setError(null);
      setPhase(d.total > 0 && d.captioned >= d.total ? "done" : "ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read index status.");
      setPhase("error");
    }
  }, []);

  // Refresh status each time the drawer opens (cheap, on demand), skipping if a
  // scan is running or we just checked. Nothing fires on page load.
  useEffect(() => {
    if (!menuOpen || runningRef.current) return;
    if (phase !== "checking" && Date.now() - fetchedAtRef.current < 15000) return;
    checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuOpen]);

  // Stop the loop if this ever unmounts.
  useEffect(() => () => {
    runningRef.current = false;
  }, []);

  const run = useCallback(async () => {
    setError(null);
    setPhase("running");
    runningRef.current = true;
    let noProgress = 0;
    try {
      while (runningRef.current) {
        const res = await fetch("/api/contact-sheet/build-index", { method: "POST" });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Scan failed.");
        setCaptioned(d.captioned);
        setTotal(d.total);
        setRateLimited(!!d.rateLimited);
        if (d.done) {
          setPhase("done");
          runningRef.current = false;
          break;
        }
        if (d.processed === 0 && !d.rateLimited) {
          noProgress += 1;
          if (noProgress >= 4) {
            const left = Math.max(0, d.total - d.captioned);
            setError(
              `Couldn't describe ${left} icon${left === 1 ? "" : "s"} (they may be missing an image). Everything else is done.`
            );
            setPhase("error");
            runningRef.current = false;
            break;
          }
        } else {
          noProgress = 0;
        }
        await sleep(d.rateLimited ? 8000 : 400);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed.");
      setPhase("error");
      runningRef.current = false;
    } finally {
      setRateLimited(false);
      fetchedAtRef.current = Date.now();
    }
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    setPhase(total > 0 && captioned >= total ? "done" : "ready");
  }, [total, captioned]);

  if (phase === "running") {
    return (
      <div className="rounded-lg px-3 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <span className="font-ui text-[15px] font-medium text-espresso">
            Scanning new icons…
          </span>
          <button
            type="button"
            onClick={stop}
            className="font-ui rounded-full border border-cream-200 bg-white px-3 py-1 text-xs font-semibold text-espresso transition-colors hover:border-pink focus-ring"
          >
            Stop
          </button>
        </div>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-parchment">
          <div
            className="h-full rounded-full bg-cherry transition-[width] duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="font-ui mt-1.5 text-[11px] text-ink-muted">
          {captioned} of {total} described ({pct}%)
          {rateLimited ? " · pausing for rate limit…" : ""}
        </p>
      </div>
    );
  }

  if (phase === "checking") {
    return (
      <div className={`${row} cursor-default opacity-60`}>
        <span>Search index</span>
        <span className="font-ui text-xs text-ink-muted">Checking…</span>
      </div>
    );
  }

  if (phase === "error") {
    return (
      <div className="rounded-lg px-3 py-2">
        <button
          type="button"
          onClick={checkStatus}
          className="font-ui flex w-full items-center justify-between gap-3 text-[15px] font-medium text-espresso"
        >
          <span>Search index</span>
          <span className="font-ui text-xs font-semibold text-cherry">Retry</span>
        </button>
        {error && (
          <p className="font-ui mt-1 text-[11px] leading-snug text-berry">{error}</p>
        )}
      </div>
    );
  }

  if (newCount === 0) {
    // Everything indexed — greyed out, nothing to do.
    return (
      <div className={`${row} cursor-default opacity-45`} aria-disabled="true">
        <span>Nothing to Scan</span>
        <span className="font-ui text-sm text-sage" aria-hidden>
          ✓
        </span>
      </div>
    );
  }

  // New icons are waiting to be described.
  return (
    <button
      type="button"
      onClick={run}
      className={`${row} text-cherry hover:bg-pink-soft`}
    >
      <span>Scan New Icons</span>
      <Badge value={newCount} />
    </button>
  );
}

type SavedSheetSummary = {
  id: string;
  label: string;
  theme: string;
  createdAt: string;
  count: number;
};

/**
 * Collapsible "Saved sheets" submenu. Lazily loads the library the first time
 * it's opened; each entry links to /contact-sheet?load=<id> to reopen that
 * sheet for re-export or tweaking. A small ✕ deletes an entry.
 */
function SavedSheetsSubmenu({ onNavigate }: { onNavigate: () => void }) {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [sheets, setSheets] = useState<SavedSheetSummary[]>([]);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/contact-sheet/library");
      const data = await res.json();
      setSheets(Array.isArray(data.sheets) ? data.sheets : []);
    } catch {
      setSheets([]);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }

  function toggle() {
    const next = !open;
    setOpen(next);
    if (next && !loaded) load();
  }

  async function remove(id: string) {
    setSheets((prev) => prev.filter((s) => s.id !== id));
    try {
      await fetch(`/api/contact-sheet/library?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    } catch {
      /* best effort */
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="font-ui flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-[15px] font-medium text-espresso transition-colors hover:bg-pink-soft"
      >
        <span>Saved sheets</span>
        <Chevron open={open} />
      </button>

      {open && (
        <div className="mb-1 mt-0.5 flex flex-col gap-0.5 pl-3">
          {loading && (
            <p className="font-ui px-3 py-1.5 text-xs text-ink-muted">Loading…</p>
          )}
          {!loading && sheets.length === 0 && (
            <p className="font-ui px-3 py-1.5 text-xs text-ink-muted">
              No saved sheets yet.
            </p>
          )}
          {sheets.map((s) => (
            <div key={s.id} className="group flex items-center gap-1">
              <Link
                href={`/contact-sheet?load=${encodeURIComponent(s.id)}`}
                onClick={onNavigate}
                className="flex-1 rounded-lg px-3 py-2 transition-colors hover:bg-pink-soft"
              >
                <span className="font-ui block truncate text-sm text-espresso">
                  {s.label || s.theme || "Untitled"}
                </span>
                <span className="font-ui block text-[11px] text-ink-muted">
                  {formatDate(s.createdAt)}
                  {s.count ? ` · ${s.count} icons` : ""}
                </span>
              </Link>
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  remove(s.id);
                }}
                aria-label={`Delete ${s.label || "saved sheet"}`}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] text-ink-muted opacity-0 transition-opacity hover:bg-parchment hover:text-cherry group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className={`transition-transform duration-150 ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M3 4.5L6 7.5L9 4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
