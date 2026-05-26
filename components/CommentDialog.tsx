"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import type { Icon } from "@/lib/sheets";
import { createComment } from "@/app/actions/comments";

const MAX_LEN = 2000;

export default function CommentDialog({
  icon,
  onClose,
}: {
  icon: Icon;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [pending, startTransition] = useTransition();
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Focus the textarea on open + lock body scroll while modal is up
  useEffect(() => {
    textareaRef.current?.focus();
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function handleSubmit() {
    const trimmed = text.trim();
    if (!trimmed || pending) return;
    setError(null);
    startTransition(async () => {
      const result = await createComment({
        iconSlug: icon.slug,
        iconName: icon.name,
        iconCategory: icon.category,
        text: trimmed,
      });
      if (result.ok) {
        setSubmitted(true);
        window.setTimeout(onClose, 1200);
      } else {
        setError(result.error);
      }
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-espresso/40 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Leave a note on ${icon.name}`}
    >
      <div
        className="w-full max-w-md overflow-hidden rounded-2xl bg-porcelain shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {submitted ? (
          <div className="px-6 py-10 text-center">
            <CheckIcon className="mx-auto h-10 w-10 text-olive" />
            <p className="font-display mt-3 text-2xl text-espresso">Note saved</p>
            <p className="font-ui mt-1 text-xs text-ink-muted">
              You can see it on the Notes page.
            </p>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSubmit();
            }}
          >
            <header className="border-b border-parchment px-5 py-4">
              <p className="font-ui text-[10px] font-semibold uppercase tracking-[0.16em] text-berry">
                Leave a note
              </p>
              <h2 className="font-display mt-1 text-xl text-espresso">
                {icon.name}
              </h2>
              <p className="font-ui mt-0.5 text-xs text-ink-muted">
                {icon.category}
              </p>
            </header>

            <div className="px-5 py-4">
              <label htmlFor="note-text" className="sr-only">
                Note
              </label>
              <textarea
                id="note-text"
                ref={textareaRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Color variations, sewing issues, anything worth noting..."
                rows={5}
                maxLength={MAX_LEN}
                disabled={pending}
                className="font-ui w-full resize-none rounded-lg border border-parchment bg-white px-3 py-2.5 text-sm text-espresso placeholder-ink-muted focus:border-pink focus:outline-none focus:ring-2 focus:ring-pink/30 disabled:opacity-60"
              />
              <div className="mt-1 flex items-center justify-between">
                {error ? (
                  <p className="font-ui text-xs text-cherry">{error}</p>
                ) : (
                  <span />
                )}
                <p
                  className={`font-ui text-[11px] tabular-nums ${
                    text.length > MAX_LEN * 0.9 ? "text-cherry" : "text-ink-muted"
                  }`}
                >
                  {text.length}/{MAX_LEN}
                </p>
              </div>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-parchment bg-white px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                disabled={pending}
                className="font-ui rounded-full px-4 py-2 text-xs font-semibold text-ink-soft transition-colors hover:text-espresso disabled:opacity-60"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!text.trim() || pending}
                className="font-ui rounded-full bg-cherry px-4 py-2 text-xs font-semibold text-porcelain transition-colors hover:bg-berry disabled:opacity-60"
              >
                {pending ? "Saving…" : "Post note"}
              </button>
            </footer>
          </form>
        )}
      </div>
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <circle cx="12" cy="12" r="10" />
      <path d="m8 12 3 3 5-6" />
    </svg>
  );
}
