"use client";

import { useMemo, useRef, useState } from "react";
import { downloadZip } from "client-zip";
import type { Icon } from "@/lib/sheets";
import { buildExportVariants, iconFileLabel, fileSafe } from "@/lib/variants";

/**
 * Bulk asset downloader.
 *
 * The user picks categories, file types (OFM / DST / PNG), and sizes; we build
 * the full list of files and assemble a single ZIP IN THE BROWSER, then hand it
 * over as one finished download. Doing the zipping client-side (rather than in
 * one serverless function) is what makes "download the whole catalog" possible —
 * the server just keeps serving individual files as it already does, and the
 * browser stitches them together and backs large archives on disk.
 *
 * Folder layout inside the zip:
 *   ICON OFM/<CATEGORY> OFM/<file as named in Drive>
 *   ICON DST/<CATEGORY> DST/<file as named in Drive>
 *   ICON PNG/<CATEGORY> PNG/<file as named in Drive>                (plain icon)
 *   ICON PNG/<CATEGORY> PNG/<Icon>/<file as named in Drive>         (default)
 *   ICON PNG/<CATEGORY> PNG/<Icon>/<Color> <Icon>.png              (variations)
 *
 * Variation PNGs are only produced for icons flagged with color variation.
 */

type Props = {
  icons: Icon[];
  categories: string[];
};

type SizeKey = "small" | "medium" | "large";

// A unit of work. Either a Drive file (name comes back from the server in the
// X-Filename header) or a generated recolor (we already know its name).
type Task =
  | { url: string; dir: string; named: false }
  | { url: string; path: string; named: true };

type Entry = { name: string; input: Uint8Array };

const CONCURRENCY = 6;

export default function AssetDownloader({ icons, categories }: Props) {
  const [selCats, setSelCats] = useState<Set<string>>(new Set());
  const [types, setTypes] = useState({ ofm: false, dst: false, png: true });
  const [sizes, setSizes] = useState({ small: true, medium: true, large: true });

  const [status, setStatus] = useState<"idle" | "running" | "done" | "error">(
    "idle"
  );
  const [progress, setProgress] = useState({ done: 0, total: 0, errors: 0 });
  const [message, setMessage] = useState<string | null>(null);

  const doneRef = useRef(0);
  const errRef = useRef(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Group icons by category once.
  const iconsByCategory = useMemo(() => {
    const m = new Map<string, Icon[]>();
    for (const icon of icons) {
      const list = m.get(icon.category);
      if (list) list.push(icon);
      else m.set(icon.category, [icon]);
    }
    return m;
  }, [icons]);

  // Variant count per icon never changes with selection — precompute it.
  const variantCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const icon of icons) m.set(icon.slug, buildExportVariants(icon).length);
    return m;
  }, [icons]);

  const sizesSelected = useMemo(
    () =>
      (["small", "medium", "large"] as SizeKey[]).filter((s) => sizes[s]),
    [sizes]
  );

  const needsSize = types.ofm || types.dst;
  const sizesValid = !needsSize || sizesSelected.length > 0;
  const anyType = types.ofm || types.dst || types.png;
  const canDownload =
    selCats.size > 0 && anyType && sizesValid && status !== "running";

  // Live count of files the current selection would produce.
  const totalFiles = useMemo(() => {
    let n = 0;
    for (const cat of selCats) {
      for (const icon of iconsByCategory.get(cat) || []) {
        if (types.png && icon.pngFileId) n += 1 + (variantCount.get(icon.slug) || 0);
        if (types.ofm) {
          for (const s of sizesSelected) if (icon.sizes[s].ofmFileId) n++;
        }
        if (types.dst) {
          for (const s of sizesSelected) if (icon.sizes[s].dstFileId) n++;
        }
      }
    }
    return n;
  }, [selCats, types, sizesSelected, iconsByCategory, variantCount]);

  // ---- selection helpers ----
  const allSelected = selCats.size === categories.length && categories.length > 0;
  function toggleCat(cat: string) {
    setSelCats((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }
  function toggleAll() {
    setSelCats(allSelected ? new Set() : new Set(categories));
  }

  // ---- the export ----
  function buildTasks(): Task[] {
    const tasks: Task[] = [];
    for (const cat of selCats) {
      const CAT = cat.toUpperCase();
      for (const icon of iconsByCategory.get(cat) || []) {
        // PNG (+ variations, only for flagged icons)
        if (types.png && icon.pngFileId) {
          const variants = buildExportVariants(icon);
          if (variants.length > 0) {
            const folder = fileSafe(iconFileLabel(icon.name)) || "icon";
            const dir = `ICON PNG/${CAT} PNG/${folder}`;
            tasks.push({ url: `/api/download/${icon.pngFileId}`, dir, named: false });
            for (const v of variants) {
              tasks.push({ url: v.src, path: `${dir}/${v.downloadName}`, named: true });
            }
          } else {
            tasks.push({
              url: `/api/download/${icon.pngFileId}`,
              dir: `ICON PNG/${CAT} PNG`,
              named: false,
            });
          }
        }
        // OFM / DST per selected size
        if (types.ofm) {
          for (const s of sizesSelected) {
            const id = icon.sizes[s].ofmFileId;
            if (id) tasks.push({ url: `/api/download/${id}`, dir: `ICON OFM/${CAT} OFM`, named: false });
          }
        }
        if (types.dst) {
          for (const s of sizesSelected) {
            const id = icon.sizes[s].dstFileId;
            if (id) tasks.push({ url: `/api/download/${id}`, dir: `ICON DST/${CAT} DST`, named: false });
          }
        }
      }
    }
    return tasks;
  }

  async function fetchOne(task: Task): Promise<Entry | null> {
    const res = await fetch(task.url);
    if (!res.ok) return null; // ignore missing / inaccessible files
    const input = new Uint8Array(await res.arrayBuffer());
    if (task.named) return { name: task.path, input };
    const enc = res.headers.get("X-Filename");
    const driveName = enc ? decodeURIComponent(enc) : "download";
    return { name: `${task.dir}/${driveName}`, input };
  }

  // Concurrency pool that yields entries in completion order (zip entry order
  // doesn't matter — the folder paths do the organizing). Memory stays bounded
  // to ~CONCURRENCY files in flight.
  async function* runTasks(tasks: Task[]): AsyncGenerator<Entry> {
    let next = 0;
    const inflight = new Map<number, Promise<{ slot: number; entry: Entry | null }>>();
    const launch = () => {
      while (inflight.size < CONCURRENCY && next < tasks.length) {
        const slot = next++;
        const task = tasks[slot];
        inflight.set(
          slot,
          (async () => {
            try {
              return { slot, entry: await fetchOne(task) };
            } catch {
              return { slot, entry: null };
            }
          })()
        );
      }
    };
    launch();
    while (inflight.size > 0) {
      const { slot, entry } = await Promise.race(inflight.values());
      inflight.delete(slot);
      doneRef.current++;
      if (!entry) errRef.current++;
      launch();
      if (entry) yield entry;
    }
  }

  function timestampName(): string {
    // Eastern time, rounded to the nearest hour. Rounding the epoch to the hour
    // lands exactly on :00 in ET (its offset is whole hours). Colons are illegal
    // in filenames, so seconds/minutes render with dashes.
    const rounded = new Date(Math.round(Date.now() / 3_600_000) * 3_600_000);
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(rounded)
        .map((p) => [p.type, p.value] as [string, string])
    );
    return `${parts.day}-${parts.month}-${parts.year} ${parts.hour}-00-00.zip`;
  }

  async function handleDownload() {
    const tasks = buildTasks();
    if (tasks.length === 0) return;

    const fileName = timestampName();

    doneRef.current = 0;
    errRef.current = 0;
    setProgress({ done: 0, total: tasks.length, errors: 0 });
    setMessage(null);
    setStatus("running");
    tickRef.current = setInterval(() => {
      setProgress((p) => ({ ...p, done: doneRef.current, errors: errRef.current }));
    }, 200);

    try {
      // Assemble the entire archive first, then hand the browser ONE finished
      // file. Files are pulled through a bounded-concurrency pool, and the
      // browser backs large blobs on disk rather than holding them all in RAM,
      // so this still works for big exports. Crucially, nothing downloads until
      // the zip is complete — no empty placeholder file appears up front.
      const blob = await downloadZip(runTasks(tasks)).blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Revoke after a delay so the download has time to start.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);

      setProgress((p) => ({ ...p, done: doneRef.current, errors: errRef.current }));
      setStatus("done");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Download failed.");
      setStatus("error");
    } finally {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    }
  }

  const running = status === "running";

  return (
    <div className="flex flex-col gap-8">
      {/* Categories */}
      <section className="rounded-2xl border border-parchment bg-white p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg text-espresso">Categories</h2>
          <label className="font-ui flex cursor-pointer items-center gap-2 text-xs font-semibold text-espresso">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={toggleAll}
              disabled={running}
              className="h-4 w-4 accent-berry"
            />
            All categories
          </label>
        </div>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
          {categories.map((cat) => (
            <label
              key={cat}
              className="font-ui flex cursor-pointer items-center gap-2 text-sm text-espresso"
            >
              <input
                type="checkbox"
                checked={selCats.has(cat)}
                onChange={() => toggleCat(cat)}
                disabled={running}
                className="h-4 w-4 accent-berry"
              />
              <span className="truncate">{cat}</span>
            </label>
          ))}
        </div>
      </section>

      {/* File types + sizes */}
      <section className="grid gap-5 md:grid-cols-2">
        <div className="rounded-2xl border border-parchment bg-white p-5">
          <h2 className="font-display mb-3 text-lg text-espresso">File types</h2>
          <div className="flex flex-col gap-2">
            {(["ofm", "dst", "png"] as const).map((t) => (
              <label
                key={t}
                className="font-ui flex cursor-pointer items-center gap-2 text-sm text-espresso"
              >
                <input
                  type="checkbox"
                  checked={types[t]}
                  onChange={() => setTypes((p) => ({ ...p, [t]: !p[t] }))}
                  disabled={running}
                  className="h-4 w-4 accent-berry"
                />
                {t.toUpperCase()}
              </label>
            ))}
          </div>
        </div>

        <div
          className={`rounded-2xl border border-parchment bg-white p-5 transition-opacity ${
            needsSize ? "" : "opacity-50"
          }`}
        >
          <h2 className="font-display mb-1 text-lg text-espresso">Sizes</h2>
          <p className="font-ui mb-3 text-xs text-ink-muted">
            Applies to OFM &amp; DST. PNG has a single size.
          </p>
          <div className="flex flex-col gap-2">
            {(["small", "medium", "large"] as SizeKey[]).map((s) => (
              <label
                key={s}
                className="font-ui flex cursor-pointer items-center gap-2 text-sm capitalize text-espresso"
              >
                <input
                  type="checkbox"
                  checked={sizes[s]}
                  onChange={() => setSizes((p) => ({ ...p, [s]: !p[s] }))}
                  disabled={running || !needsSize}
                  className="h-4 w-4 accent-berry"
                />
                {s}
              </label>
            ))}
          </div>
        </div>
      </section>

      {/* Action */}
      <section className="rounded-2xl border border-parchment bg-white p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="font-ui text-sm text-ink-muted">
            {totalFiles > 0 ? (
              <>
                <span className="font-semibold text-espresso">
                  {totalFiles.toLocaleString()}
                </span>{" "}
                file{totalFiles === 1 ? "" : "s"} selected
              </>
            ) : (
              "Choose categories and file types to begin."
            )}
            {!sizesValid && (
              <span className="ml-2 text-cherry">Select at least one size.</span>
            )}
          </div>
          <button
            type="button"
            onClick={handleDownload}
            disabled={!canDownload || totalFiles === 0}
            className="font-ui rounded-full bg-berry px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-cherry disabled:cursor-not-allowed disabled:opacity-40 focus-ring"
          >
            {running ? "Preparing…" : "Download ZIP"}
          </button>
        </div>

        {/* Progress / status */}
        {running && (
          <div className="mt-4">
            <div className="h-2 w-full overflow-hidden rounded-full bg-porcelain">
              <div
                className="h-full bg-berry transition-[width] duration-200"
                style={{
                  width: `${
                    progress.total
                      ? Math.round((progress.done / progress.total) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>
            <p className="font-ui mt-2 text-xs text-ink-muted">
              {progress.done.toLocaleString()} / {progress.total.toLocaleString()}{" "}
              files
              {progress.errors > 0 && ` · ${progress.errors} skipped`} · keep this
              tab open until it finishes.
            </p>
          </div>
        )}
        {status === "done" && (
          <p className="font-ui mt-4 text-sm text-espresso">
            Done — {progress.done.toLocaleString()} file
            {progress.done === 1 ? "" : "s"} written
            {progress.errors > 0 &&
              `, ${progress.errors} skipped (missing in Drive)`}
            .
          </p>
        )}
        {status === "error" && (
          <p className="font-ui mt-4 text-sm text-cherry">
            {message || "Something went wrong."}
          </p>
        )}
      </section>

      <p className="font-ui max-w-2xl text-xs text-ink-muted">
        The zip is assembled in your browser and saved as a single file once it
        finishes — nothing downloads until it&apos;s complete. Large selections
        make many requests and can take a while, so keep this tab open; Chrome or
        Edge handle the biggest exports best. Files missing from Drive are skipped
        automatically.
      </p>
    </div>
  );
}
