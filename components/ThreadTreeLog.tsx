import { getThreadBySlot, rgbToHex } from "@/lib/threadPalette";
import type { SlotMove, TreeLogEntry } from "@/lib/threadTreeLog";

/**
 * "Change history" — every time the top-N tree moved, newest first.
 *
 * Reads as a timeline rather than a table: each entry leads with what changed
 * (colors in, colors out, needles that shifted), because that's the question
 * being asked. The full needle order at that moment is there too, as a strip.
 */
export default function ThreadTreeLog({
  history,
  writeFailed,
}: {
  history: TreeLogEntry[];
  writeFailed: boolean;
}) {
  const entries = [...history].reverse(); // newest first

  return (
    <section className="mt-10 border-t border-parchment pt-6">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-xl text-espresso">Change history</h2>
        <p className="font-ui text-xs text-ink-muted">
          {entries.length} recorded {entries.length === 1 ? "change" : "changes"}
        </p>
      </div>
      <p className="font-ui mb-4 text-xs leading-relaxed text-ink-soft">
        The tree is derived from a rolling 12-month window, so it shifts on its own as orders come
        in. Every time the top 15 or their needle order changes, it gets written to the{" "}
        <span className="font-semibold">THREAD_TREE_LOG</span> tab and appears here.
      </p>

      {writeFailed && (
        <p className="font-ui mb-4 rounded-lg border border-tomato/30 bg-tomato/5 px-3 py-2 text-xs text-cherry">
          The tree changed but couldn&rsquo;t be written to the sheet — check that the service
          account still has edit access. History below may be behind.
        </p>
      )}

      {entries.length === 0 ? (
        <p className="font-ui rounded-xl border border-parchment bg-white px-4 py-6 text-center text-sm text-ink-muted">
          Nothing recorded yet. The current tree gets logged as the baseline the first time this
          page loads with data.
        </p>
      ) : (
        <ol className="space-y-3">
          {entries.map((e, i) => (
            <li
              key={`${e.recordedAt}-${i}`}
              className="rounded-xl border border-parchment bg-white p-4"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-ui text-xs font-semibold text-espresso">
                  {formatWhen(e.recordedAt)}
                </span>
                <span className="font-ui text-[11px] tabular-nums text-ink-muted">
                  {Math.round(e.coverage * 100)}% coverage · {e.totalUses.toLocaleString()} uses ·{" "}
                  {e.window}
                </span>
              </div>

              {e.baseline ? (
                <p className="font-ui mt-2 text-xs text-ink-soft">
                  Baseline recorded — the tree as it stood when logging started.
                </p>
              ) : (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {e.diff.added.map((slot) => (
                    <Chip key={`a-${slot}`} slot={slot} kind="added" />
                  ))}
                  {e.diff.removed.map((slot) => (
                    <Chip key={`r-${slot}`} slot={slot} kind="removed" />
                  ))}
                  {e.diff.moved.map((m) => (
                    <MoveChip key={`m-${m.slot}`} move={m} />
                  ))}
                  {e.diff.added.length === 0 &&
                    e.diff.removed.length === 0 &&
                    e.diff.moved.length === 0 && (
                      <span className="font-ui text-xs text-ink-muted">{e.summary}</span>
                    )}
                </div>
              )}

              <div className="mt-3">
                <p className="font-ui mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
                  Tree at this point
                </p>
                <SlotStrip slots={e.slots} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Chip({ slot, kind }: { slot: number; kind: "added" | "removed" }) {
  const t = getThreadBySlot(slot);
  const added = kind === "added";
  return (
    <span
      className={`font-ui inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
        added
          ? "border-olive/40 bg-olive/10 text-olive"
          : "border-cherry/25 bg-pink-soft text-cherry"
      }`}
    >
      <span className="font-bold" aria-hidden>
        {added ? "+" : "−"}
      </span>
      {t && (
        <span
          className="h-2.5 w-2.5 flex-none rounded-full ring-1 ring-black/10"
          style={{ backgroundColor: rgbToHex(t.rgb) }}
          aria-hidden
        />
      )}
      <span className="font-semibold">{t ? t.name : `Slot ${slot}`}</span>
      <span className="tabular-nums opacity-70">{slot}</span>
    </span>
  );
}

function MoveChip({ move }: { move: SlotMove }) {
  const t = getThreadBySlot(move.slot);
  const up = move.to < move.from; // lower needle number = more popular
  return (
    <span className="font-ui inline-flex items-center gap-1.5 rounded-full border border-parchment bg-porcelain px-2.5 py-1 text-[11px] text-ink-soft">
      {t && (
        <span
          className="h-2.5 w-2.5 flex-none rounded-full ring-1 ring-black/10"
          style={{ backgroundColor: rgbToHex(t.rgb) }}
          aria-hidden
        />
      )}
      <span className="font-semibold text-espresso">{t ? t.name : `Slot ${move.slot}`}</span>
      <span className="tabular-nums">
        n{move.from} <span aria-hidden>{up ? "↑" : "↓"}</span> n{move.to}
      </span>
    </span>
  );
}

/** The whole tree as a row of numbered swatches, in needle order. */
function SlotStrip({ slots }: { slots: number[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {slots.map((slot, i) => {
        const t = getThreadBySlot(slot);
        const rgb = t?.rgb ?? [230, 221, 210];
        const light = 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 140;
        return (
          <span
            key={`${slot}-${i}`}
            title={`Needle ${i + 1} — ${t ? t.name : `slot ${slot}`}`}
            className="font-ui flex h-6 w-6 flex-none items-center justify-center rounded-full text-[10px] font-bold tabular-nums ring-1 ring-black/10"
            style={{ backgroundColor: rgbToHex(rgb), color: light ? "#1b1b1b" : "#ffffff" }}
          >
            {slot}
          </span>
        );
      })}
    </div>
  );
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
  });
}
