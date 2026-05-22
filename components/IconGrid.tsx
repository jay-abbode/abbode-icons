"use client";

import { useState, useEffect, useCallback } from "react";
import type { Icon } from "@/lib/sheets";
import IconDetailModal from "./IconDetailModal";

export default function IconGrid({ icons }: { icons: Icon[] }) {
  const [selected, setSelected] = useState<Icon | null>(null);

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

  return (
    <>
      <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
        {icons.map((icon) => (
          <li key={icon.slug}>
            <IconCard icon={icon} onClick={() => setSelected(icon)} />
          </li>
        ))}
      </ul>

      {selected && <IconDetailModal icon={selected} onClose={handleClose} />}
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
