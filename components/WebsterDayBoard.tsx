"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateWebsterDay } from "@/app/actions/machineConfigs";
import { getThreadBySlot, rgbToHex } from "@/lib/threadPalette";

/**
 * The morning half of the Webster day board: block off the rooms that aren't
 * running today, hit Generate, and the thread configuration re-solves across
 * the remaining rooms and becomes the ACTIVE config (day sheet and room pages
 * follow automatically). Each live room card then shows its loadouts and its
 * share of the day's orders, and clicks through to the room's list.
 */

export type BoardRoom = {
  id: string;
  name: string;
  /** Room switched on in the active config. */
  active: boolean;
  headCount: number;
  /** Active heads with their solved loadouts (empty until a config exists). */
  heads: { id: string; slots: number[]; offColor: boolean }[];
  orders: number;
  changeFree: number;
  swaps: number;
};

function MiniChip({ slot }: { slot: number }) {
  const color = getThreadBySlot(slot);
  if (!color) return null;
  return (
    <span
      title={`${slot} · ${color.name}`}
      className="inline-block h-2 w-2 flex-none rounded-[2px] ring-1 ring-black/10"
      style={{ backgroundColor: rgbToHex(color.rgb) }}
    />
  );
}

export default function WebsterDayBoard({
  rooms,
  batch,
  hasConfig,
}: {
  rooms: BoardRoom[];
  batch: string;
  hasConfig: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [blocked, setBlocked] = useState<Set<string>>(
    () => new Set(rooms.filter((r) => !r.active).map((r) => r.id))
  );
  const [error, setError] = useState<string | null>(null);

  const savedBlocked = useMemo(
    () => new Set(rooms.filter((r) => !r.active).map((r) => r.id)),
    [rooms]
  );
  const dirty = useMemo(() => {
    if (blocked.size !== savedBlocked.size) return true;
    for (const id of blocked) if (!savedBlocked.has(id)) return true;
    return false;
  }, [blocked, savedBlocked]);

  function toggle(id: string) {
    setBlocked((b) => {
      const next = new Set(b);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setError(null);
  }

  function generate() {
    if (pending) return;
    if (blocked.size >= rooms.length) {
      setError("Every room is blocked — leave at least one on.");
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await generateWebsterDay([...blocked]);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="print:hidden">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="font-ui rounded-full bg-plum px-5 py-2.5 text-sm font-semibold text-porcelain transition-colors hover:bg-cherry focus-ring disabled:opacity-60"
        >
          {pending ? "Solving…" : "Generate Thread Config"}
        </button>
        <p className="font-ui text-xs text-ink-muted">
          {pending
            ? "Re-solving loadouts across the open rooms and saving as the active config…"
            : dirty
              ? "Room changes not applied yet — Generate to re-solve and save."
              : hasConfig
                ? "Tap a room to block it off for today, then Generate."
                : "No active config yet — set today's rooms and Generate."}
        </p>
      </div>

      {error ? (
        <p className="font-ui mb-4 rounded-lg bg-pink-soft px-3 py-2 text-xs text-cherry">{error}</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rooms.map((room) => {
          const isBlocked = blocked.has(room.id);
          return (
            <div
              key={room.id}
              className={`rounded-xl border p-4 transition-colors ${
                isBlocked ? "border-cream-200 bg-cream-50 opacity-70" : "border-parchment bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-display text-lg text-espresso">{room.name}</p>
                  <p className="font-ui text-[11px] text-ink-muted">
                    room {room.id} · {room.headCount} heads
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => toggle(room.id)}
                  className={`font-ui rounded-full px-3 py-1 text-[11px] font-semibold transition-colors focus-ring ${
                    isBlocked
                      ? "bg-espresso/80 text-porcelain hover:bg-espresso"
                      : "bg-parchment text-ink-soft hover:text-espresso"
                  }`}
                >
                  {isBlocked ? "Blocked" : "On"}
                </button>
              </div>

              {isBlocked ? (
                <p className="font-ui mt-3 text-xs text-ink-muted">Blocked off for today.</p>
              ) : !hasConfig || room.heads.length === 0 ? (
                <p className="font-ui mt-3 text-xs text-ink-muted">
                  {dirty || !hasConfig ? "Generate to solve this room's loadouts." : "No threaded heads."}
                </p>
              ) : (
                <>
                  <div className="mt-3 space-y-0.5">
                    {room.heads.map((h) => (
                      <div key={h.id} className="font-ui flex items-center gap-1.5 text-[10px] text-ink-soft">
                        <span className="w-7 tabular-nums text-ink-muted">{h.id}</span>
                        <span className="flex items-center gap-0.5">
                          {h.slots.map((s) => (
                            <MiniChip key={s} slot={s} />
                          ))}
                        </span>
                        {h.offColor ? <span className="text-[9px] uppercase text-cherry">off</span> : null}
                      </div>
                    ))}
                  </div>
                  <div className="font-ui mt-3 flex items-center justify-between text-xs">
                    <span className="text-ink-soft">
                      <strong className="text-espresso">{room.orders}</strong>{" "}
                      {room.orders === 1 ? "order" : "orders"}
                      {room.orders > 0 ? ` · ${room.changeFree} change-free` : ""}
                      {room.swaps > 0 ? ` · ${room.swaps} swap` : ""}
                    </span>
                    <Link
                      href={`/machines/routing/room/${room.id}?batch=${batch}`}
                      className="font-semibold text-plum transition-colors hover:text-cherry"
                    >
                      Open room →
                    </Link>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
