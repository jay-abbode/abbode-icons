"use client";

import { useState, useEffect, useCallback } from "react";
import type { Icon } from "@/lib/sheets";
import IconDetailModal from "./IconDetailModal";
import CommentDialog from "./CommentDialog";

export default function IconGrid({
  icons,
  commentCounts = {},
}: {
  icons: Icon[];
  /** Map of icon slug → number of notes left on that icon. */
  commentCounts?: Record<string, number>;
}) {
  const [selected, setSelected] = useState<Icon | null>(null);
  const [commentingOn, setCommentingOn] = useState<Icon | null>(null);

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSelected(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  useEffect(() => {
    if (!selected) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [selected]);

  const handleClose = useCallback(() => setSelected(null), []);
  const handleCloseComment = useCallback(() => setCommentingOn(null), []);

  return (
    <>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {icons.map((icon) => (
          <li key={icon.slug} className="relative">
            <IconCard icon={icon} onClick={() => setSelected(icon)} />
            <CommentButton
              icon={icon}
              count={commentCounts[icon.slug] || 0}
              onOpen={(i) => setCommentingOn(i)}
            />
          </li>
        ))}
      </ul>

      {selected && (
        <IconDetailModal
          icon={selected}
          onClose={handleClose}
          commentCount={commentCounts[selected.slug] || 0}
        />
      )}
      {commentingOn && (
        <CommentDialog icon={commentingOn} onClose={handleCloseComment} />
      )}
    </>
  );
}

function IconCard({
  icon,
  onClick,
}: {
  icon: Icon;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full flex-col overflow-hidden rounded-xl border border-parchment bg-white text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-pink hover:shadow-[0_8px_24px_-12px_rgba(187,55,103,0.20)] focus-ring"
    >
      <div className="relative flex aspect-square items-center justify-center overflow-hidden bg-porcelain p-5">
        {icon.pngFileId ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/image/${icon.pngFileId}`}
            alt={icon.name}
            loading="lazy"
            className="max-h-full max-w-full object-contain transition-transform duration-500 group-hover:scale-[1.06]"
          />
        ) : (
          <span className="font-display text-3xl text-parchment">·</span>
        )}

        {icon.hasColorVariation && (
          <span
            title="Available in color variations"
            className="font-ui absolute right-2 top-2 inline-flex h-5 items-center gap-1 rounded-full bg-pink px-1.5 text-[9px] font-semibold uppercase tracking-wider text-espresso shadow-sm"
          >
            <ColorDot /> Var
          </span>
        )}
      </div>

      <div className="border-t border-parchment px-3 py-2.5">
        <p className="truncate text-sm font-medium text-espresso" title={icon.name}>
          {icon.name}
        </p>
        <p className="font-ui mt-0.5 truncate text-[11px] text-ink-muted">
          {icon.category}
        </p>
      </div>
    </button>
  );
}

function CommentButton({
  icon,
  count,
  onOpen,
}: {
  icon: Icon;
  count: number;
  onOpen: (icon: Icon) => void;
}) {
  const hasNotes = count > 0;
  return (
    <button
      type="button"
      aria-label={
        hasNotes
          ? `${count} ${count === 1 ? "note" : "notes"} on ${icon.name} · leave another`
          : `Leave a note on ${icon.name}`
      }
      title={hasNotes ? `${count} ${count === 1 ? "note" : "notes"}` : "Leave a note"}
      onClick={(e) => {
        // Sibling of the IconCard button; stopPropagation is belt-and-braces
        // in case future markup nests them.
        e.stopPropagation();
        onOpen(icon);
      }}
      className="absolute bottom-1.5 right-1.5 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-white/90 text-ink-muted shadow-sm transition-colors hover:bg-pink-soft hover:text-cherry focus-ring"
    >
      <CommentIcon className="h-3.5 w-3.5" />
      {hasNotes && (
        <span
          aria-hidden
          className="font-ui absolute -top-1 -right-1 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-cherry px-1 text-[10px] font-bold leading-none text-porcelain tabular-nums shadow-sm"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  );
}

function CommentIcon({ className }: { className?: string }) {
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
      <path d="M13.5 9.5c0 .83-.67 1.5-1.5 1.5H6l-3 2.5V11H4c-.83 0-1.5-.67-1.5-1.5v-6C2.5 2.67 3.17 2 4 2h8c.83 0 1.5.67 1.5 1.5v6z" />
    </svg>
  );
}

function ColorDot() {
  return (
    <span
      aria-hidden
      className="inline-block h-1.5 w-1.5 rounded-full"
      style={{
        background:
          "conic-gradient(from 0deg, #BB3767, #D1C68F, #C398B5, #E7E57E, #BB3767)",
      }}
    />
  );
}
