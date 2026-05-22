"use client";

import { useEffect, useRef } from "react";
import type { Icon, IconSize } from "@/lib/sheets";

interface Props {
  icon: Icon;
  onClose: () => void;
}

export default function IconDetailModal({ icon, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-6 animate-fade-in"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-espresso/40 backdrop-blur-sm" aria-hidden />

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

        <div className="grid grid-cols-1 overflow-y-auto sm:grid-cols-[1fr_1.1fr]">
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
              <p className="font-ui text-[10px] font-semibold uppercase tracking-[0.18em] text-berry">
                {icon.category}
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
                <DownloadButton
                  fileId={icon.pngFileId}
                  filename={`${icon.name}.png`}
                  format="PNG"
                  primary
                />
              </section>
            )}

            <section>
              <SectionLabel>Embroidery files</SectionLabel>
              <div className="space-y-3">
                <SizeRow icon={icon} sizeKey="small" label="Small" />
                <SizeRow icon={icon} sizeKey="medium" label="Medium" />
                <SizeRow icon={icon} sizeKey="large" label="Large" />
              </div>
            </section>
          </div>
        </div>
      </div>
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

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-ui mb-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-olive">
      {children}
    </h3>
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
