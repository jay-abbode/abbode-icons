"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { generateWebsterDay } from "@/app/actions/machineConfigs";
import { getThreadBySlot, rgbToHex } from "@/lib/threadPalette";

/**
 * The Webster board — the whole daily surface in two controls:
 *
 *   1. Turn rooms on or off. Nothing else about the threading is editable
 *      here (loadouts, locks, scope, and head settings live under Advanced
 *      configuration).
 *   2. GENERATE — re-solves the thread allocation across the open rooms
 *      against every outstanding order and pins the result as the active
 *      config. Room cards then show what's on each head and how many of the
 *      outstanding orders land in that room; click through for the list.
 */

export type BoardRoom = {
  id: string;
  name: string;
  active: boolean;
  headCount: number;
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
  hasConfig,
  lastGenerated,
}: {
  rooms: BoardRoom[];
  hasConfig: boolean;
  /** e.g. "Aug 11, 7:42 AM by jay@shopabbode.com" — from the active config. */
  lastGenerated?: string | null;
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
      setError("Every room is off — leave at least one on.");
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
      {/* ── The button ─────────────────────────────────────────────────── */}
      <div className="mb-6 rounded-2xl border border-parchment bg-white p-5 sm:p-6">
        <button
          type="button"
          onClick={generate}
          disabled={pending}
          className="font-display w-full rounded-2xl bg-plum px-8 py-5 text-2xl tracking-wide text-porcelain shadow-[0_10px_30px_-12px_rgba(103,30,48,0.55)] transition-all hover:bg-cherry hover:shadow-[0_14px_36px_-12px_rgba(151,41,69,0.6)] focus-ring disabled:opacity-60 sm:text-3xl"
        >
          {pending ? "Solving…" : "Generate"}
        </button>
        <p className="font-ui mt-3 text-center text-xs text-ink-muted">
          {pending
            ? "Optimizing the thread allocation across the open rooms for every outstanding order…"
            : dirty
              ? "Room changes aren't applied yet — Generate to re-solve."
              : hasConfig
                ? `Re-solves for all outstanding orders and pins the loadouts.${lastGenerated ? ` Last generated ${lastGenerated}.` : ""}`
                : "No configuration yet — set the rooms below and Generate."}
        </p>
        {error ? (
          <p className="font-ui mt-3 rounded-lg bg-pink-soft px-3 py-2 text-center text-xs text-cherry">{error}</p>
        ) : null}
      </div>

      {/* ── The rooms ──────────────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {rooms.map((room) => {
          const isOff = blocked.has(room.id);
          return (
            <div
              key={room.id}
              className={`flex flex-col rounded-xl border p-4 transition-colors ${
                isOff ? "border-cream-200 bg-cream-50 opacity-70" : "border-parchment bg-white"
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-display truncate text-xl text-espresso">{room.name}</p>
                  <p className="font-ui text-[11px] text-ink-muted">
                    room {room.id} · {room.headCount} heads
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!isOff}
                  onClick={() => toggle(room.id)}
                  aria-label={`Turn ${room.name} ${isOff ? "on" : "off"}`}
                  className={`relative h-7 w-[52px] flex-none rounded-full transition-colors focus-ring ${
                    isOff ? "bg-cream-200" : "bg-olive"
                  }`}
                >
                  <span
                    className={`absolute top-1 h-5 w-5 rounded-full bg-white shadow transition-all ${
                      isOff ? "left-1" : "left-[26px]"
                    }`}
                  />
                </button>
              </div>

              {isOff ? (
                <p className="font-ui mt-3 text-xs text-ink-muted">Off — no orders will be sent here.</p>
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
                  <p className="font-ui mt-3 text-xs text-ink-soft">
                    <strong className="font-display text-lg text-espresso">{room.orders}</strong>{" "}
                    {room.orders === 1 ? "order" : "orders"}
                    {room.orders > 0 ? ` · ${room.changeFree} change-free` : ""}
                    {room.swaps > 0 ? ` · ${room.swaps} need a swap` : ""}
                  </p>
                  <Link
                    href={`/webster/room/${room.id}`}
                    className="font-ui mt-3 block rounded-xl bg-parchment px-4 py-2.5 text-center text-sm font-semibold text-espresso transition-colors hover:bg-pink-soft focus-ring"
                  >
                    Open room →
                  </Link>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
