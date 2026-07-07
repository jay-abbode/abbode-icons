"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PDFDocument } from "pdf-lib";
import { WORDMARK_PATHS, wordmarkSvg } from "@/lib/wordmark";

/* ------------------------------------------------------------------ *
 * Contact-sheet generator.
 *
 * Flow: type a theme + count -> POST /api/contact-sheet/match (Claude
 * curates the set) -> live canvas preview -> tweak (remove / add /
 * regenerate) -> export PNG, PDF, or HTML.
 *
 * All three exports and the preview are driven by ONE geometry function
 * (`computeLayout`), so the sheet looks identical whichever way it leaves.
 * Icons are pulled through the app's existing /api/image/<fileId> route,
 * which serves the Drive PNGs same-origin — no CORS, no canvas tainting.
 * ------------------------------------------------------------------ */

// ---- Design constants (in "sheet units"; rendered at 2x for crispness) ----
const SHEET_W = 1480;
const SHEET_H = 820;
const RENDER_SCALE = 2;
const HERO_PINK = "#F2B2AE"; // brand pink token
const LABEL_GREY = "#6E6E6E"; // neutral grey from the reference sheets
const LABEL_FONT = '"Abbode Berlin"';
const LABEL_SIZE = 26;
const LABEL_TRACKING = 10;
const LOGO_W = 200;
const LOGO_RATIO = 582.48 / 1428.87; // wordmark viewBox aspect

type SheetIconLite = { slug: string; name: string; pngFileId: string };
type PoolIcon = { slug: string; name: string; pngFileId: string };
type MatchResponse = {
  theme: string;
  requested: number;
  icons: { slug: string; name: string; category: string; pngFileId: string }[];
  note: string | null;
};

type Placed = { x: number; y: number; w: number; h: number };
type Layout = {
  logo: Placed | null;
  icons: Placed[];
  label: { cx: number; baseline: number } | null;
};

/** Balanced grid + centered logo/label, all in sheet units. Shared by every renderer. */
function computeLayout(
  dims: { w: number; h: number }[],
  renderLogo: boolean,
  renderCategory: boolean
): Layout {
  const n = dims.length;
  // Always reserve the logo (top) and label (bottom) bands, even when they're
  // toggled off. The grid geometry stays fixed, so the icons never move — the
  // logo and label just appear or disappear inside their reserved space.
  const topM = 150;
  const botM = 120;
  const sideM = 120;
  const availW = SHEET_W - 2 * sideM;
  const availH = SHEET_H - topM - botM;

  // rows = ceil(N/6) reproduces the reference sheets: 10->5x2, 12->6x2, 18->6x3.
  const rows = Math.max(1, Math.ceil(n / 6));
  const cols = Math.max(1, Math.ceil(n / rows));
  const cellW = availW / cols;
  const cellH = availH / rows;
  const iconBox = Math.min(cellW, cellH) * 0.62;

  const icons: Placed[] = [];
  let idx = 0;
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, n - r * cols);
    const rowW = inRow * cellW;
    const x0 = (SHEET_W - rowW) / 2; // center a partial last row
    for (let c = 0; c < inRow; c++) {
      const d = dims[idx];
      const s = d.w && d.h ? iconBox / Math.max(d.w, d.h) : 1; // normalize longer side
      const w = d.w * s;
      const h = d.h * s;
      const cx = x0 + c * cellW + cellW / 2;
      const cy = topM + r * cellH + cellH / 2;
      icons.push({ x: cx - w / 2, y: cy - h / 2, w, h });
      idx++;
    }
  }

  const logo = renderLogo
    ? { x: (SHEET_W - LOGO_W) / 2, y: 46, w: LOGO_W, h: LOGO_W * LOGO_RATIO }
    : null;
  const label = renderCategory ? { cx: SHEET_W / 2, baseline: SHEET_H - 76 } : null;

  return { logo, icons, label };
}

/** Draw uppercase, evenly-tracked, horizontally-centered text (canvas has no letter-spacing). */
function drawTracked(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  baseline: number,
  tracking: number
) {
  const chars = Array.from(text);
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const total =
    widths.reduce((a, b) => a + b, 0) + tracking * Math.max(0, chars.length - 1);
  let x = cx - total / 2;
  chars.forEach((ch, i) => {
    ctx.fillText(ch, x, baseline);
    x += widths[i] + tracking;
  });
}

function slugifyFilename(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "contact-sheet";
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function fetchDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
}

function dataUrlToBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.split(",")[1] || "";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

export default function ContactSheetGenerator({ loadId }: { loadId?: string }) {
  const [theme, setTheme] = useState("");
  const [count, setCount] = useState(12);
  const [status, setStatus] = useState<"idle" | "matching" | "ready">("idle");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const [icons, setIcons] = useState<SheetIconLite[]>([]);
  const [renderLogo, setRenderLogo] = useState(false);
  const [renderCategory, setRenderCategory] = useState(false);
  const [categoryLabel, setCategoryLabel] = useState("");
  const [labelTouched, setLabelTouched] = useState(false);

  const [pool, setPool] = useState<PoolIcon[]>([]);
  const [exporting, setExporting] = useState<string | null>(null);
  const [saving, setSaving] = useState<"idle" | "saving" | "saved">("idle");

  const [loadTick, setLoadTick] = useState(0);
  const [logoReady, setLogoReady] = useState(false);
  const [fontReady, setFontReady] = useState(false);

  const previewRef = useRef<HTMLCanvasElement>(null);
  const imgMapRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const logoImgRef = useRef<HTMLImageElement | null>(null);

  // --- One-time setup: logo image, label font, and the add-icon pool ---
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      logoImgRef.current = img;
      setLogoReady(true);
    };
    img.src =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(wordmarkSvg(HERO_PINK));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const done = () => !cancelled && setFontReady(true);
    const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts;
    if (fonts?.load) {
      fonts.load(`${LABEL_SIZE}px ${LABEL_FONT}`).then(done, done);
    } else {
      done();
    }
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/icons")
      .then((r) => r.json())
      .then((cat: { icons?: Array<{ slug: string; name: string; status: string; pngFileId: string | null }> }) => {
        if (cancelled || !cat?.icons) return;
        setPool(
          cat.icons
            .filter((i) => i.status?.toUpperCase() === "ACTIVE" && i.pngFileId)
            .map((i) => ({ slug: i.slug, name: i.name, pngFileId: i.pngFileId as string }))
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // --- Hydrate from a saved sheet when opened via ?load=<id> ---
  useEffect(() => {
    if (!loadId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/contact-sheet/library?id=${encodeURIComponent(loadId)}`
        );
        if (!res.ok || cancelled) return;
        const s = (await res.json()) as {
          theme: string;
          label: string;
          count: number;
          renderLogo: boolean;
          renderCategory: boolean;
          icons: SheetIconLite[];
        };
        if (cancelled) return;
        setTheme(s.theme || "");
        setCount(s.count || s.icons.length || 12);
        setRenderLogo(s.renderLogo);
        setRenderCategory(s.renderCategory);
        setCategoryLabel(s.label || s.theme || "");
        setLabelTouched(true);
        setIcons(
          s.icons.map((i) => ({ slug: i.slug, name: i.name, pngFileId: i.pngFileId }))
        );
        setStatus("ready");
      } catch {
        /* ignore — just start blank */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loadId]);

  // --- Ensure every active icon's image is loading ---
  useEffect(() => {
    for (const ic of icons) {
      if (imgMapRef.current.has(ic.slug)) continue;
      const img = new Image();
      img.onload = () => setLoadTick((t) => t + 1);
      img.onerror = () => setLoadTick((t) => t + 1);
      img.src = `/api/image/${ic.pngFileId}`;
      imgMapRef.current.set(ic.slug, img);
    }
  }, [icons]);

  // --- The renderer (canvas). Preview and PNG/PDF export all call this. ---
  const drawSheet = useCallback(
    (canvas: HTMLCanvasElement, list: SheetIconLite[], opts: { logo: boolean; category: boolean; label: string }) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      canvas.width = SHEET_W * RENDER_SCALE;
      canvas.height = SHEET_H * RENDER_SCALE;
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, SHEET_W, SHEET_H);

      const dims = list.map((ic) => {
        const img = imgMapRef.current.get(ic.slug);
        return { w: img?.naturalWidth || 1, h: img?.naturalHeight || 1 };
      });
      const layout = computeLayout(dims, opts.logo, opts.category);

      if (layout.logo && logoImgRef.current) {
        const { x, y, w, h } = layout.logo;
        ctx.drawImage(logoImgRef.current, x, y, w, h);
      }
      list.forEach((ic, i) => {
        const img = imgMapRef.current.get(ic.slug);
        const p = layout.icons[i];
        if (img && img.complete && img.naturalWidth && p) {
          ctx.drawImage(img, p.x, p.y, p.w, p.h);
        }
      });
      const labelText = opts.label.trim();
      if (layout.label && labelText) {
        ctx.fillStyle = LABEL_GREY;
        ctx.font = `${LABEL_SIZE}px ${LABEL_FONT}`;
        ctx.textBaseline = "alphabetic";
        drawTracked(ctx, labelText.toUpperCase(), layout.label.cx, layout.label.baseline, LABEL_TRACKING);
      }
    },
    []
  );

  // --- Live preview ---
  useEffect(() => {
    const canvas = previewRef.current;
    if (!canvas) return;
    drawSheet(canvas, icons, { logo: renderLogo, category: renderCategory, label: categoryLabel });
  }, [icons, renderLogo, renderCategory, categoryLabel, loadTick, logoReady, fontReady, drawSheet]);

  // --- Curate ---
  const generate = useCallback(async () => {
    const t = theme.trim();
    if (!t) {
      setError("Enter a theme first.");
      return;
    }
    setStatus("matching");
    setError(null);
    setNote(null);
    try {
      const res = await fetch("/api/contact-sheet/match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ theme: t, count }),
      });
      const data = (await res.json()) as MatchResponse & { error?: string };
      if (!res.ok) throw new Error(data.error || "Something went wrong.");
      setIcons(data.icons.map((i) => ({ slug: i.slug, name: i.name, pngFileId: i.pngFileId })));
      setNote(data.note);
      if (!labelTouched) setCategoryLabel(data.theme);
      setStatus("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStatus("ready");
    }
  }, [theme, count, labelTouched]);

  const removeIcon = useCallback((slug: string) => {
    setIcons((prev) => prev.filter((i) => i.slug !== slug));
    setNote(null);
  }, []);

  const addIcon = useCallback((p: PoolIcon) => {
    setIcons((prev) => (prev.some((i) => i.slug === p.slug) ? prev : [...prev, p]));
    setNote(null);
  }, []);

  const saveToLibrary = useCallback(async () => {
    if (icons.length === 0) return;
    setSaving("saving");
    try {
      const label = (categoryLabel || theme).trim();
      const res = await fetch("/api/contact-sheet/library", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          label,
          theme: theme.trim() || label,
          count: icons.length,
          renderLogo,
          renderCategory,
          icons,
        }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error((d as { error?: string }).error || "Save failed.");
      }
      setSaving("saved");
      setTimeout(() => setSaving("idle"), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
      setSaving("idle");
    }
  }, [icons, categoryLabel, theme, renderLogo, renderCategory]);

  // Make sure fonts + all active images are in before rendering an export.
  const ensureReady = useCallback(async () => {
    const fonts = (document as unknown as { fonts?: FontFaceSet }).fonts;
    if (fonts?.load) await fonts.load(`${LABEL_SIZE}px ${LABEL_FONT}`).catch(() => {});
    await Promise.all(
      icons.map(
        (ic) =>
          new Promise<void>((resolve) => {
            let img = imgMapRef.current.get(ic.slug);
            if (!img) {
              img = new Image();
              img.src = `/api/image/${ic.pngFileId}`;
              imgMapRef.current.set(ic.slug, img);
            }
            if (img.complete) return resolve();
            img.addEventListener("load", () => resolve(), { once: true });
            img.addEventListener("error", () => resolve(), { once: true });
          })
      )
    );
  }, [icons]);

  const renderOffscreen = useCallback((): HTMLCanvasElement => {
    const canvas = document.createElement("canvas");
    drawSheet(canvas, icons, { logo: renderLogo, category: renderCategory, label: categoryLabel });
    return canvas;
  }, [drawSheet, icons, renderLogo, renderCategory, categoryLabel]);

  const fileBase = useMemo(
    () => slugifyFilename(categoryLabel || theme),
    [categoryLabel, theme]
  );

  const exportPNG = useCallback(async () => {
    setExporting("PNG");
    try {
      await ensureReady();
      const canvas = renderOffscreen();
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG failed"))), "image/png")
      );
      downloadBlob(blob, `${fileBase}.png`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PNG export failed.");
    } finally {
      setExporting(null);
    }
  }, [ensureReady, renderOffscreen, fileBase]);

  const exportPDF = useCallback(async () => {
    setExporting("PDF");
    try {
      await ensureReady();
      const canvas = renderOffscreen();
      const bytes = dataUrlToBytes(canvas.toDataURL("image/png"));
      const doc = await PDFDocument.create();
      const page = doc.addPage([SHEET_W, SHEET_H]);
      const png = await doc.embedPng(bytes);
      page.drawImage(png, { x: 0, y: 0, width: SHEET_W, height: SHEET_H });
      const pdf = await doc.save();
      downloadBlob(new Blob([new Uint8Array(pdf)], { type: "application/pdf" }), `${fileBase}.pdf`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed.");
    } finally {
      setExporting(null);
    }
  }, [ensureReady, renderOffscreen, fileBase]);

  const exportHTML = useCallback(async () => {
    setExporting("HTML");
    try {
      await ensureReady();
      // Base64 each icon PNG + the label font so the file is fully self-contained.
      const [iconData, fontData] = await Promise.all([
        Promise.all(icons.map((ic) => fetchDataUrl(`/api/image/${ic.pngFileId}`))),
        fetchDataUrl("/fonts/Abbode-Berlin-Font-1_0.ttf").catch(() => ""),
      ]);
      const dims = icons.map((ic) => {
        const img = imgMapRef.current.get(ic.slug);
        return { w: img?.naturalWidth || 1, h: img?.naturalHeight || 1 };
      });
      const layout = computeLayout(dims, renderLogo, renderCategory);

      const parts: string[] = [];
      if (layout.logo) {
        const { x, y, w } = layout.logo;
        const s = w / 1428.87;
        const paths = WORDMARK_PATHS.map((d) => `<path d="${d}"/>`).join("");
        parts.push(
          `<g transform="translate(${x} ${y}) scale(${s})" fill="${HERO_PINK}">${paths}</g>`
        );
      }
      icons.forEach((_, i) => {
        const p = layout.icons[i];
        if (!p) return;
        parts.push(
          `<image href="${iconData[i]}" x="${p.x.toFixed(2)}" y="${p.y.toFixed(
            2
          )}" width="${p.w.toFixed(2)}" height="${p.h.toFixed(2)}" preserveAspectRatio="xMidYMid meet"/>`
        );
      });
      const labelText = categoryLabel.trim();
      if (layout.label && labelText) {
        parts.push(
          `<text x="${layout.label.cx}" y="${layout.label.baseline}" text-anchor="middle" font-family="Abbode Berlin, sans-serif" font-size="${LABEL_SIZE}" letter-spacing="${LABEL_TRACKING}" fill="${LABEL_GREY}">${escapeXml(
            labelText.toUpperCase()
          )}</text>`
        );
      }

      const fontFace = fontData
        ? `@font-face{font-family:"Abbode Berlin";src:url(${fontData}) format("truetype");font-weight:normal;font-style:normal;}`
        : "";
      const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeXml(labelText || "Contact sheet")}</title>
<style>html,body{margin:0;background:#fff}${fontFace}
.wrap{max-width:1480px;margin:0 auto}svg{display:block;width:100%;height:auto}</style>
</head><body><div class="wrap">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SHEET_W} ${SHEET_H}">
<rect width="${SHEET_W}" height="${SHEET_H}" fill="#fff"/>
${parts.join("\n")}
</svg></div></body></html>`;
      downloadBlob(new Blob([html], { type: "text/html" }), `${fileBase}.html`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "HTML export failed.");
    } finally {
      setExporting(null);
    }
  }, [icons, renderLogo, renderCategory, categoryLabel, fileBase]);

  const inputClass =
    "w-full rounded-lg border border-cream-200 bg-porcelain px-3 py-2.5 text-espresso outline-none transition-colors focus:border-pink focus-ring";
  const labelClass =
    "font-ui mb-1.5 block text-xs font-semibold uppercase tracking-wide text-ink-muted";

  return (
    <div>
      {/* Prompt */}
      <div className="rounded-2xl border border-parchment bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1">
            <label className={labelClass} htmlFor="cs-theme">
              Theme
            </label>
            <input
              id="cs-theme"
              value={theme}
              onChange={(e) => setTheme(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") generate();
              }}
              placeholder="New England Autumn"
              className={inputClass}
            />
          </div>
          <div className="w-full sm:w-24">
            <label className={labelClass} htmlFor="cs-count">
              Icons
            </label>
            <input
              id="cs-count"
              type="number"
              min={1}
              max={40}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(40, Number(e.target.value) || 1)))}
              className={inputClass}
            />
          </div>
          <button
            type="button"
            onClick={generate}
            disabled={status === "matching"}
            className="font-ui inline-flex items-center justify-center gap-2 rounded-full bg-cherry px-6 py-2.5 text-sm font-semibold text-porcelain shadow-sm transition-colors hover:bg-berry disabled:cursor-not-allowed disabled:opacity-60 focus-ring"
          >
            {status === "matching" ? "Curating…" : "Generate"}
          </button>
        </div>
        <p className="font-ui mt-3 text-xs text-ink-muted">
          Claude reads the whole catalog and picks the icons that fit — reword the
          theme or hit Regenerate for a different take.
        </p>
      </div>

      {error && (
        <div className="mt-4 rounded-xl border border-tomato/30 bg-tomato/5 px-4 py-3 text-sm text-tomato">
          {error}
        </div>
      )}

      {icons.length > 0 && (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
          {/* Preview */}
          <div>
            <div className="overflow-hidden rounded-2xl border border-parchment bg-white p-3 shadow-sm">
              <canvas ref={previewRef} className="block h-auto w-full rounded-lg" />
            </div>
            {note && <p className="font-ui mt-2 text-xs text-berry">{note}</p>}
          </div>

          {/* Controls */}
          <div className="flex flex-col gap-5">
            <div className="rounded-xl border border-parchment bg-white p-4">
              <label className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={renderLogo}
                  onChange={(e) => setRenderLogo(e.target.checked)}
                  className="h-4 w-4 accent-cherry"
                />
                <span className="text-sm text-espresso">Render logo</span>
              </label>
              <label className="mt-2.5 flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={renderCategory}
                  onChange={(e) => setRenderCategory(e.target.checked)}
                  className="h-4 w-4 accent-cherry"
                />
                <span className="text-sm text-espresso">Render category</span>
              </label>
              {renderCategory && (
                <div className="mt-3">
                  <label className="font-ui mb-1 block text-xs text-ink-muted" htmlFor="cs-label">
                    Category label
                  </label>
                  <input
                    id="cs-label"
                    value={categoryLabel}
                    onChange={(e) => {
                      setCategoryLabel(e.target.value);
                      setLabelTouched(true);
                    }}
                    className="w-full rounded-lg border border-cream-200 bg-porcelain px-3 py-2 text-sm text-espresso outline-none focus:border-pink focus-ring"
                  />
                </div>
              )}
            </div>

            {/* Selection */}
            <div className="rounded-xl border border-parchment bg-white p-4">
              <div className="flex items-center justify-between">
                <p className="font-ui text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  {icons.length} icon{icons.length === 1 ? "" : "s"}
                </p>
                <button
                  type="button"
                  onClick={generate}
                  disabled={status === "matching"}
                  className="font-ui text-xs font-semibold text-cherry transition-colors hover:text-berry disabled:opacity-50"
                >
                  {status === "matching" ? "…" : "Regenerate"}
                </button>
              </div>
              <div className="mt-3 grid grid-cols-4 gap-2">
                {icons.map((ic) => (
                  <div
                    key={ic.slug}
                    className="group relative aspect-square rounded-lg border border-cream-200 bg-porcelain p-1"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/image/${ic.pngFileId}`}
                      alt={ic.name}
                      title={ic.name}
                      className="h-full w-full object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => removeIcon(ic.slug)}
                      aria-label={`Remove ${ic.name}`}
                      className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-espresso text-[10px] text-porcelain opacity-0 shadow transition-opacity hover:bg-cherry group-hover:opacity-100"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
              <AddIcon pool={pool} existing={icons} onAdd={addIcon} />
            </div>

            {/* Save to library */}
            <button
              type="button"
              onClick={saveToLibrary}
              disabled={saving === "saving" || icons.length === 0}
              className={`font-ui w-full rounded-xl border px-3 py-2.5 text-sm font-semibold transition-colors focus-ring disabled:opacity-50 ${
                saving === "saved"
                  ? "border-cherry bg-pink-soft text-cherry"
                  : "border-parchment bg-white text-espresso hover:border-pink hover:bg-pink-soft"
              }`}
            >
              {saving === "saving"
                ? "Saving…"
                : saving === "saved"
                ? "Saved to library ✓"
                : "Save to library"}
            </button>

            {/* Export */}
            <div className="rounded-xl border border-parchment bg-white p-4">
              <p className="font-ui mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Download
              </p>
              <div className="grid grid-cols-3 gap-2">
                {(
                  [
                    ["PNG", exportPNG],
                    ["PDF", exportPDF],
                    ["HTML", exportHTML],
                  ] as const
                ).map(([label, fn]) => (
                  <button
                    key={label}
                    type="button"
                    onClick={fn}
                    disabled={exporting !== null}
                    className="font-ui rounded-lg border border-cream-200 bg-white px-3 py-2 text-sm font-semibold text-espresso transition-colors hover:border-pink hover:bg-pink-soft disabled:opacity-50 focus-ring"
                  >
                    {exporting === label ? "…" : label}
                  </button>
                ))}
              </div>
              <p className="font-ui mt-2 text-[11px] text-ink-muted">
                PNG has a white background. HTML is a single self-contained file.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Small type-ahead to add any catalog icon to the sheet by name. */
function AddIcon({
  pool,
  existing,
  onAdd,
}: {
  pool: PoolIcon[];
  existing: SheetIconLite[];
  onAdd: (p: PoolIcon) => void;
}) {
  const [query, setQuery] = useState("");
  const have = useMemo(() => new Set(existing.map((i) => i.slug)), [existing]);
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return pool
      .filter((p) => !have.has(p.slug) && p.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [query, pool, have]);

  return (
    <div className="mt-3 border-t border-parchment pt-3">
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Add an icon by name…"
        className="w-full rounded-lg border border-cream-200 bg-porcelain px-3 py-2 text-sm text-espresso outline-none focus:border-pink focus-ring"
      />
      {matches.length > 0 && (
        <div className="mt-2 flex flex-col gap-0.5">
          {matches.map((m) => (
            <button
              key={m.slug}
              type="button"
              onClick={() => {
                onAdd(m);
                setQuery("");
              }}
              className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm text-espresso transition-colors hover:bg-pink-soft"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/image/${m.pngFileId}`}
                alt=""
                className="h-6 w-6 shrink-0 object-contain"
              />
              <span className="truncate">{m.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
