"use client";

import { useState, useTransition } from "react";
import { deleteCommentAction } from "@/app/actions/comments";

/**
 * Two-step delete: first click reveals "Delete? [Cancel] [Confirm]" inline,
 * second click on Confirm actually deletes. Avoids the jarring browser
 * confirm() dialog, and avoids accidental nukes.
 */
export default function DeleteCommentButton({
  timestamp,
}: {
  timestamp: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleConfirm() {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const result = await deleteCommentAction(timestamp);
      if (!result.ok) {
        setError(result.error);
        // Stay in confirming mode so user sees the error next to the button
      }
      // On success: the revalidatePath in the server action will refresh
      // the page and this component will unmount with its note.
    });
  }

  if (confirming) {
    return (
      <span className="font-ui inline-flex items-center gap-1.5 text-[11px]">
        {error ? (
          <span className="text-cherry">{error}</span>
        ) : (
          <span className="text-ink-soft">Delete?</span>
        )}
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={pending}
          className="rounded-full px-2 py-0.5 text-ink-soft transition-colors hover:text-espresso disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={pending}
          className="rounded-full bg-cherry px-2 py-0.5 font-semibold text-porcelain transition-colors hover:bg-berry disabled:opacity-60"
        >
          {pending ? "Deleting…" : "Confirm"}
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setConfirming(true)}
      aria-label="Delete this note"
      title="Delete this note"
      className="font-ui inline-flex h-6 w-6 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-pink-soft hover:text-cherry focus-ring"
    >
      <TrashIcon className="h-3.5 w-3.5" />
    </button>
  );
}

function TrashIcon({ className }: { className?: string }) {
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
      <path d="M3 4h10" />
      <path d="M5.5 4V2.8c0-.44.36-.8.8-.8h3.4c.44 0 .8.36.8.8V4" />
      <path d="M4.5 4l.55 8.6c.04.56.5 1 1.06 1h3.78c.56 0 1.02-.44 1.06-1L11.5 4" />
      <path d="M6.5 7v4M9.5 7v4" />
    </svg>
  );
}
