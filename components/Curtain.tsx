"use client";

import { useEffect, useState } from "react";

/**
 * Full-screen brand curtain shown over the home page. Purely a landing moment:
 * "Abbode Embroidery" stylized, one line of description, and it gets out of the
 * way on any click or keypress. Shows on each fresh load of "/".
 */
export default function Curtain() {
  const [closing, setClosing] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (gone) return;
    const dismiss = () => setClosing(true);
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [gone]);

  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => setGone(true), 400);
    return () => clearTimeout(t);
  }, [closing]);

  if (gone) return null;

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Enter Abbode Embroidery"
      onClick={() => setClosing(true)}
      className={`fixed inset-0 z-50 flex cursor-pointer select-none flex-col items-center justify-center bg-porcelain px-6 text-center transition-opacity duration-400 ${
        closing ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      <span className="w-24 border-t-2 border-dashed border-pink" aria-hidden />

      <h1 className="font-display mt-8 text-6xl tracking-tight text-espresso md:text-7xl">Abbode</h1>
      <p className="font-ui mt-3 text-sm uppercase tracking-[0.5em] text-berry md:text-base">Embroidery</p>

      <span className="mt-8 w-24 border-t-2 border-dashed border-pink" aria-hidden />

      <p className="mt-8 max-w-md text-sm leading-relaxed text-ink-soft md:text-base">
        The catalog, the colors, and the order trends behind the brand — all in one place.
      </p>

      <p className="font-ui absolute bottom-10 animate-pulse text-[11px] uppercase tracking-[0.25em] text-ink-muted">
        Click anywhere · Press any key
      </p>
    </div>
  );
}
