"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { Icon, IconSize } from "@/lib/sheets";
import { getThreadBySlot, rgbToHex } from "@/lib/threadPalette";
import CommentDialog from "./CommentDialog";

interface Props {
  icon: Icon;
  onClose: () => void;
  /** Number of notes already left on this icon. Optional; defaults to 0. */
  commentCount?: number;
  /** When provided, the modal shows a previous-icon arrow + handles ←. */
  onPrev?: () => void;
  /** When provided, the modal shows a next-icon arrow + handles →. */
  onNext?: () => void;
  /** "N of M" position indicator shown near the category label. */
  position?: { current: number; total: number };
}

export default function IconDetailModal({
  icon,
  onClose,
  commentCount = 0,
  onPrev,
  onNext,
  position,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [commentOpen, setCommentOpen] = useState(false);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  // When we navigate to a different icon via the arrow buttons / arrow keys
  // the modal stays mounted but the icon prop changes. Reset any per-icon UI
  // state so we don't carry over (e.g.) an open comment dialog or stale
  // scroll position from the previous icon.
  useEffect(() => {
    setCommentOpen(false);
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    // Re-focus the dialog when the icon changes so subsequent arrow
    // keypresses are received by our window listener and not stolen by the
    // arrow button the user just clicked.
    dialogRef.current?.focus();
  }, [icon.slug]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6 animate-fade-in"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-espresso/40 backdrop-blur-sm" aria-hidden />

      {/* Lightbox-style prev/next arrows. Always rendered when the parent
          declares it has prev/next; we don't render the button at all when
          there's nothing to navigate to so screen readers don't see a dead
          control. */}
      {onPrev && (
        <NavArrowButton
          direction="prev"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
        />
      )}
      {onNext && (
        <NavArrowButton
          direction="next"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
        />
      )}

      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="icon-modal-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-full max-h-[92vh] max-w-3xl flex-col overflow-hidden rounded-t-2xl bg-porcelain shadow-2xl outline-none animate-slide-up sm:max-h-[88vh] sm:rounded-2xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-white/85 text-espresso backdrop-blur transition-colors hover:bg-pink-soft hover:text-cherry focus-ring"
        >
          <CloseIcon />
        </button>

        <div ref={scrollRef} className="grid grid-cols-1 overflow-y-auto sm:grid-cols-[1fr_1.1fr]">
          <div className="flex aspect-square items-center justify-center bg-white p-10 sm:aspect-auto sm:min-h-[420px]">
            {icon.pngFileId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/image/${icon.pngFileId}`}
                alt={icon.name}
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="text-center text-ink-muted">
                <span className="font-display text-5xl text-parchment">·</span>
                <p className="font-ui mt-2 text-xs">No preview available</p>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-6 p-6 sm:p-8">
            <header>
              <p className="font-ui flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-berry">
                <span>{icon.category}</span>
                {position && position.total > 1 && (
                  <>
                    <span aria-hidden className="text-ink-muted/60">·</span>
                    <span
                      className="text-ink-muted"
                      aria-label={`Icon ${position.current} of ${position.total} in the current view`}
                    >
                      {position.current} of {position.total}
                    </span>
                  </>
                )}
              </p>
              <h2
                id="icon-modal-title"
                className="mt-2 font-display text-3xl font-medium leading-tight tracking-tight text-espresso"
              >
                {icon.name}
              </h2>
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {icon.hasColorVariation && <Badge tone="pink">Color variations</Badge>}
                <Badge tone="muted">{icon.status}</Badge>
                {icon.oldName && (
                  <Badge tone="muted">Formerly: {icon.oldName}</Badge>
                )}
              </div>
              {icon.notes && (
                <p className="mt-3 font-paris italic text-cherry">{icon.notes}</p>
              )}
            </header>

            {icon.pngFileId && (
              <section>
                <SectionLabel>Preview image</SectionLabel>
                <div className="flex flex-wrap gap-2">
                  <DownloadButton
                    fileId={icon.pngFileId}
                    filename={`${icon.name}.png`}
                    format="PNG"
                    primary
                  />
                  <CopyImageButton key={icon.pngFileId} fileId={icon.pngFileId} />
                </div>
              </section>
            )}

            {icon.hasColorVariation && icon.pngFileId ? (
              <section>
                <SectionLabel>Thread colors</SectionLabel>
                <Link
                  href={`/icon/${icon.slug}/variations`}
                  className="group font-ui inline-flex items-center gap-2 rounded-full border border-pink bg-white px-4 py-2 text-xs font-semibold text-cherry transition-colors hover:bg-pink-soft focus-ring"
                >
                  <ColorWheel />
                  Color variations
                  <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
                </Link>
                <p className="font-ui mt-2 text-[11px] text-ink-muted">
                  {icon.isMultiColor
                    ? "View this design in its multi-color variations."
                    : "View this design in all 24 Madeira thread colors."}
                </p>
              </section>
            ) : (
              icon.threadSlots.length > 0 && (
                <section>
                  <SectionLabel>Thread colors</SectionLabel>
                  <ThreadColorChips slots={icon.threadSlots} />
                </section>
              )
            )}

            <section>
              <SectionLabel>Embroidery files</SectionLabel>
              <div className="space-y-3">
                <SizeRow icon={icon} sizeKey="small" label="Small" />
                <SizeRow icon={icon} sizeKey="medium" label="Medium" />
                <SizeRow icon={icon} sizeKey="large" label="Large" />
              </div>
            </section>

            <section>
              <SectionLabel>Notes</SectionLabel>
              <button
                type="button"
                onClick={() => setCommentOpen(true)}
                className="group font-ui inline-flex items-center gap-2 rounded-full border border-parchment bg-white px-4 py-2 text-xs font-semibold text-espresso transition-colors hover:border-pink hover:bg-pink-soft focus-ring"
              >
                <CommentBubbleIcon className="h-3.5 w-3.5 text-ink-muted group-hover:text-cherry transition-colors" />
                <span>Leave a note</span>
                {commentCount > 0 && (
                  <span
                    aria-label={`${commentCount} existing ${commentCount === 1 ? "note" : "notes"}`}
                    className="font-ui inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-cherry px-1 text-[10px] font-bold leading-none text-porcelain tabular-nums"
                  >
                    {commentCount > 99 ? "99+" : commentCount}
                  </span>
                )}
              </button>
              {commentCount > 0 && (
                <p className="font-ui mt-2 text-[11px] text-ink-muted">
                  <Link href="/comments" className="hover:text-espresso underline-offset-2 hover:underline">
                    View all notes →
                  </Link>
                </p>
              )}
            </section>
          </div>
        </div>
      </div>

      {commentOpen && (
        <CommentDialog
          icon={icon}
          onClose={() => setCommentOpen(false)}
        />
      )}
    </div>
  );
}

function SizeRow({
  icon,
  sizeKey,
  label,
}: {
  icon: Icon;
  sizeKey: "small" | "medium" | "large";
  label: string;
}) {
  const size: IconSize = icon.sizes[sizeKey];
  const isAvailable = size.inches || size.ofmFileId || size.dstFileId;

  if (!isAvailable) {
    return (
      <div className="font-ui flex items-center gap-3 rounded-lg border border-dashed border-parchment px-3 py-2.5 text-xs text-ink-muted">
        <span className="w-16 font-medium">{label}</span>
        <span className="italic">Not available in this size</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-parchment bg-white p-3 sm:flex-row sm:items-center sm:gap-3">
      <div className="flex w-full items-baseline justify-between sm:w-20 sm:flex-col sm:items-start sm:justify-start sm:gap-0">
        <span className="text-sm font-medium text-espresso">{label}</span>
        {size.inches && (
          <span className="font-ui text-[11px] tabular-nums text-ink-muted sm:mt-0.5">
            {size.inches === "Varies" ? "Varies" : `${size.inches}"`}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-wrap gap-2">
        {size.ofmFileId ? (
          <DownloadButton
            fileId={size.ofmFileId}
            filename={`${icon.name} ${label.toUpperCase()}.ofm`}
            format="OFM"
          />
        ) : (
          <DisabledButton format="OFM" />
        )}
        {size.dstFileId ? (
          <DownloadButton
            fileId={size.dstFileId}
            filename={`${icon.name} ${label.toUpperCase()}.dst`}
            format="DST"
          />
        ) : (
          <DisabledButton format="DST" />
        )}
      </div>
    </div>
  );
}

function DownloadButton({
  fileId,
  filename,
  format,
  primary = false,
}: {
  fileId: string;
  filename: string;
  format: string;
  primary?: boolean;
}) {
  const url = `/api/download/${fileId}?filename=${encodeURIComponent(filename)}`;
  return (
    <a
      href={url}
      download={filename}
      className={`font-ui group inline-flex items-center justify-center gap-1.5 rounded-full px-3.5 py-2 text-xs font-semibold uppercase tracking-wider transition-all focus-ring ${
        primary
          ? "bg-espresso text-porcelain hover:bg-berry"
          : "border border-parchment bg-white text-espresso hover:border-pink hover:bg-pink-soft"
      }`}
    >
      <DownloadIcon />
      {format}
    </a>
  );
}

function DisabledButton({ format }: { format: string }) {
  return (
    <span
      title="File not available"
      className="font-ui inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed border-parchment px-3.5 py-2 text-xs font-semibold uppercase tracking-wider text-ink-muted/60"
    >
      {format}
    </span>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "pink" | "muted";
}) {
  return (
    <span
      className={`font-ui inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        tone === "pink"
          ? "bg-pink text-espresso"
          : "border border-parchment bg-white text-ink-muted"
      }`}
    >
      {children}
    </span>
  );
}

function NavArrowButton({
  direction,
  onClick,
}: {
  direction: "prev" | "next";
  onClick: (e: React.MouseEvent) => void;
}) {
  const isPrev = direction === "prev";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={isPrev ? "Previous icon" : "Next icon"}
      title={isPrev ? "Previous icon (←)" : "Next icon (→)"}
      className={
        // Vertically centered on the viewport, hugging the edge. Slightly
        // smaller and pulled in on mobile so they don't overlap the panel's
        // content; lightbox-spaced on desktop.
        "group absolute top-1/2 z-[55] flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-espresso shadow-lg backdrop-blur transition-all hover:scale-110 hover:bg-white hover:text-cherry focus-ring sm:h-12 sm:w-12 " +
        (isPrev ? "left-3 sm:left-6" : "right-3 sm:right-6")
      }
    >
      {isPrev ? <ChevronLeft /> : <ChevronRight />}
    </button>
  );
}

function ChevronLeft() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="transition-transform group-hover:-translate-x-0.5"
    >
      <path d="M12.5 4 6.5 10l6 6" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="transition-transform group-hover:translate-x-0.5"
    >
      <path d="M7.5 4 13.5 10l-6 6" />
    </svg>
  );
}

function CommentBubbleIcon({ className }: { className?: string }) {
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

function ColorWheel() {
  // A six-petal conic-gradient swatch to signal "many colors"
  return (
    <span
      aria-hidden
      className="inline-block h-3.5 w-3.5 rounded-full ring-1 ring-white"
      style={{
        background:
          "conic-gradient(from 0deg, #BB3767, #F0691E, #F4DC5C, #7D6E35, #1C4072, #5A4F9C, #BB3767)",
      }}
    />
  );
}

function ArrowRight({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      width="12"
      height="12"
    >
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function ThreadColorChips({ slots }: { slots: number[] }) {
  // Display in numerical order regardless of how they were entered in the sheet.
  // .slice() first so we don't mutate the array the parent owns.
  const sortedSlots = slots.slice().sort((a, b) => a - b);
  return (
    <ul className="flex flex-wrap gap-2" aria-label="Thread colors used in this design">
      {sortedSlots.map((slot, idx) => {
        const thread = getThreadBySlot(slot);
        if (!thread) {
          // Unknown slot — render a neutral chip with the number so the user
          // notices and can fix the sheet entry (or add a missing palette color).
          return (
            <li
              key={`unknown-${slot}-${idx}`}
              aria-label={`Slot ${slot}, not in palette`}
              className="group relative flex items-center gap-2 rounded-full border border-dashed border-ink-muted bg-white px-2.5 py-1"
            >
              <span className="h-4 w-4 rounded-full border border-parchment bg-parchment" aria-hidden />
              <span className="font-ui text-xs font-semibold text-ink-muted">
                {slot}
              </span>
              <ChipTooltip>Not in palette</ChipTooltip>
            </li>
          );
        }
        const hex = rgbToHex(thread.rgb);
        return (
          <li
            key={`${slot}-${idx}`}
            aria-label={`Slot ${thread.slot}, ${thread.name}, Madeira ${thread.code}`}
            className="group relative flex items-center gap-2 rounded-full border border-parchment bg-white px-2.5 py-1 transition-shadow hover:shadow-sm"
          >
            <span
              className="h-4 w-4 rounded-full ring-1 ring-black/10"
              style={{ backgroundColor: hex }}
              aria-hidden
            />
            <span className="font-ui text-xs font-semibold text-espresso">
              {thread.slot}
            </span>
            <span className="font-ui text-xs text-ink-soft">
              {thread.name}
            </span>
            <ChipTooltip>Madeira {thread.code}</ChipTooltip>
          </li>
        );
      })}
    </ul>
  );
}

function ChipTooltip({ children }: { children: React.ReactNode }) {
  return (
    <span
      role="tooltip"
      className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-md bg-espresso px-2 py-1 font-ui text-[10px] font-semibold tracking-wide text-porcelain opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100"
    >
      {children}
    </span>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-ui mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-olive">
      {children}
    </h3>
  );
}

function CopyImageButton({ fileId }: { fileId: string }) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">(
    "idle"
  );

  async function handleCopy() {
    setStatus("copying");
    try {
      // Pass a Promise to ClipboardItem rather than awaiting first — Safari
      // requires the clipboard write to start synchronously in response to
      // the click, otherwise it rejects with a NotAllowedError.
      await navigator.clipboard.write([
        new ClipboardItem({
          "image/png": fetch(`/api/image/${fileId}`).then((r) => {
            if (!r.ok) throw new Error(`Image fetch failed: ${r.status}`);
            return r.blob();
          }),
        }),
      ]);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 1800);
    } catch (err) {
      console.error("Copy to clipboard failed:", err);
      setStatus("error");
      window.setTimeout(() => setStatus("idle"), 2200);
    }
  }

  const isCopied = status === "copied";
  const isError = status === "error";
  const isBusy = status === "copying";

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={isBusy}
      aria-live="polite"
      className={`font-ui inline-flex items-center justify-center gap-1.5 rounded-full border px-3.5 py-2 text-xs font-semibold uppercase tracking-wider transition-all focus-ring disabled:cursor-wait disabled:opacity-60 ${
        isCopied
          ? "border-olive bg-olive/10 text-olive"
          : isError
          ? "border-cherry bg-pink-soft text-cherry"
          : "border-parchment bg-white text-espresso hover:border-pink hover:bg-pink-soft"
      }`}
    >
      {isCopied ? <CheckIcon /> : isError ? <XIcon /> : <CopyIcon />}
      {isCopied ? "Copied" : isError ? "Failed" : "Copy"}
    </button>
  );
}

function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.2" />
      <path d="M10.5 5.5V3.7c0-.66-.54-1.2-1.2-1.2H3.7c-.66 0-1.2.54-1.2 1.2v5.6c0 .66.54 1.2 1.2 1.2H5.5" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m3 8.5 3.2 3.2L13 4.5" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
      <path d="m4 4 8 8M12 4l-8 8" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M8 2v9" />
      <path d="m4.5 7.5 3.5 3.5 3.5-3.5" />
      <path d="M2.5 13.5h11" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" aria-hidden>
      <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" />
    </svg>
  );
}
