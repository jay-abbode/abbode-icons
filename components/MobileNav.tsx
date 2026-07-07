"use client";

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useState } from "react";

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
