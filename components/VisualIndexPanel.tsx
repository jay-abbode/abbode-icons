"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * "Visual search index" panel. Kicks off the vision-captioning pass on the
 * server and drives it to completion by calling /api/contact-sheet/build-index
 * repeatedly, showing a live progress bar. Fully resumable — closing the page
 * mid-run just means picking up where it left off next time.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Status = "checking" | "idle" | "running" | "done";

export default function VisualIndexPanel() {
  const [status, setStatus] = useState<Status>("checking");
  const [captioned, setCaptioned] = useState(0);
  const [total, setTotal] = useState(0);
  const [rateLimited, setRateLimited] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const runningRef = useRef(false);

  // Initial status.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/contact-sheet/build-index");
        const d = await res.json();
        if (cancelled) return;
        if (!res.ok) throw new Error(d.error || "Couldn't read index status.");
        setCaptioned(d.captioned);
        setTotal(d.total);
        setStatus(d.total > 0 && d.captioned >= d.total ? "done" : "idle");
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Couldn't read index status.");
          setStatus("idle");
        }
      }
    })();
    return () => {
      cancelled = true;
      runningRef.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    setError(null);
    setStatus("running");
    runningRef.current = true;
    let noProgress = 0;

    try {
      while (runningRef.current) {
        const res = await fetch("/api/contact-sheet/build-index", { method: "POST" });
        const d = await res.json();
        if (!res.ok) throw new Error(d.error || "Build failed.");

        setCaptioned(d.captioned);
        setTotal(d.total);
        setRateLimited(!!d.rateLimited);

        if (d.done) {
          setStatus("done");
          runningRef.current = false;
          break;
        }
        // Guard against getting stuck on icons that can't be captioned.
        if (d.processed === 0 && !d.rateLimited) {
          noProgress += 1;
          if (noProgress >= 4) {
            const left = Math.max(0, d.total - d.captioned);
            setError(
              `Couldn't describe ${left} icon${left === 1 ? "" : "s"} (they may be missing an image). Everything else is done.`
            );
            setStatus("idle");
            runningRef.current = false;
            break;
          }
        } else {
          noProgress = 0;
        }

        await sleep(d.rateLimited ? 8000 : 400);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Build failed.");
      setStatus("idle");
      runningRef.current = false;
    } finally {
      setRateLimited(false);
    }
  }, []);

  const stop = useCallback(() => {
    runningRef.current = false;
    setStatus((s) => (s === "running" ? "idle" : s));
  }, []);

  const pct = total > 0 ? Math.round((captioned / total) * 100) : 0;
  const complete = status === "done" || (total > 0 && captioned >= total);

  return (
    <div className="mt-12 rounded-2xl border border-parchment bg-white/60 p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl">
          <p className="font-ui text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Visual search index
          </p>
          <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">
            Lets the lookbook match on how icons actually look — stripes, wood,
            colors — not just their names. Claude looks at each icon once and
            saves a short description. Safe to close mid-run; it picks up where
            it left off.
          </p>
        </div>

        <div className="shrink-0">
          {status === "checking" ? (
            <span className="font-ui text-sm text-ink-muted">Checking…</span>
          ) : status === "running" ? (
            <button
              type="button"
              onClick={stop}
              className="font-ui rounded-full border border-cream-200 bg-white px-5 py-2.5 text-sm font-semibold text-espresso transition-colors hover:border-pink focus-ring"
            >
              Stop
            </button>
          ) : complete ? (
            <button
              type="button"
              onClick={run}
              className="font-ui rounded-full border border-cream-200 bg-white px-5 py-2.5 text-sm font-semibold text-espresso transition-colors hover:border-pink hover:bg-pink-soft focus-ring"
            >
              Re-scan for new icons
            </button>
          ) : (
            <button
              type="button"
              onClick={run}
              className="font-ui rounded-full bg-cherry px-6 py-2.5 text-sm font-semibold text-porcelain shadow-sm transition-colors hover:bg-berry focus-ring"
            >
              {captioned > 0 ? "Resume building" : "Build visual index"}
            </button>
          )}
        </div>
      </div>

      {total > 0 && (
        <div className="mt-4">
          <div className="h-2 w-full overflow-hidden rounded-full bg-parchment">
            <div
              className={`h-full rounded-full transition-[width] duration-500 ${
                complete ? "bg-sage" : "bg-cherry"
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <p className="font-ui mt-2 text-xs text-ink-muted">
            {complete ? (
              <>All {total} icons described.</>
            ) : (
              <>
                {captioned} of {total} described ({pct}%)
                {status === "running" && (
                  <>
                    {" · "}
                    {rateLimited ? "pausing for rate limit…" : "describing…"}
                  </>
                )}
              </>
            )}
          </p>
        </div>
      )}

      {error && <p className="font-ui mt-3 text-xs text-berry">{error}</p>}
    </div>
  );
}
