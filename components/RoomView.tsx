"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { Fleet, RoomResult } from "@/lib/threadAllocation";
import { MachineCard, MachineModal, pct } from "@/components/MachineParts";

/**
 * One room, on its own — what the embroiderer working in it sees. Shows the
 * ACTIVE configuration (what the floor is actually threaded to), not a scratch
 * pad: this page is meant to be pinned to the room's tablet, so it never
 * re-solves under someone's hands. Planning happens on /machines.
 */
export default function RoomView({
  fleet,
  room,
  window: windowLabel,
  jobCount,
  updatedAt,
  hasActiveConfig,
}: {
  fleet: Fleet;
  room: RoomResult;
  window: string;
  jobCount: number;
  updatedAt: string | null;
  hasActiveConfig: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    if (openId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [openId]);

  const machines = room.machines.filter((m) => m.active);
  const stdCount = machines.filter((m) => !m.offColor).length;
  const offCount = machines.length - stdCount;
  const openMachine = openId ? machines.find((m) => m.id === openId) ?? null : null;
  const driftPts = pct(room.freshChangeFree) - pct(room.changeFree);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-3xl text-espresso">{room.name}</h1>
            <span className="font-ui rounded-full bg-parchment px-2 py-0.5 text-[11px] font-semibold tabular-nums text-ink-muted">
              {fleet.label} · room {room.id}
            </span>
            {room.locked ? (
              <span className="font-ui rounded-full bg-plum px-2 py-0.5 text-[11px] font-semibold text-porcelain">
                🔒 Locked
              </span>
            ) : null}
          </div>
          <p className="font-ui mt-1 text-sm text-ink-muted">
            {room.active ? (
              <>
                {machines.length} {machines.length === 1 ? "head" : "heads"} running · {stdCount} standard
                {offCount ? ` + ${offCount} off-color` : ""} · {fleet.needleCount} needles each
              </>
            ) : (
              "This room is switched off."
            )}
          </p>
        </div>
        <Link
          href={`/machines/daysheet?fleet=${fleet.key}&room=${room.id}`}
          className="font-ui rounded-full border border-parchment bg-white px-3.5 py-2 text-xs font-semibold text-espresso transition-colors hover:border-pink hover:bg-pink-soft focus-ring"
        >
          Print this room →
        </Link>
      </div>

      {room.active && machines.length ? (
        <>
          <div className="mb-5 rounded-2xl border border-cream-200 bg-white px-5 py-5 md:px-7 md:py-6">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <span className="font-display text-5xl leading-none text-plum md:text-6xl">
                {pct(room.changeFree)}%
              </span>
              <span className="font-ui text-base text-espresso md:text-lg">
                of orders this room can stitch <strong>change-free</strong> — no spool swaps
              </span>
            </div>
            <p className="font-ui mt-2 text-xs text-ink-muted md:text-[13px]">
              Fleet-wide the {fleet.label} floor runs {pct(fleet.changeFreeAll)}% change-free across all{" "}
              {fleet.activeCount} active heads.
            </p>
            {room.locked && driftPts >= 1 ? (
              <p className="font-ui mt-2 rounded-lg bg-pink-soft px-2.5 py-1.5 text-[11px] text-cherry">
                Locked — a fresh thread-up would score {pct(room.freshChangeFree)}% on today&rsquo;s orders. Unlock on
                the Thread Config page to re-solve.
              </p>
            ) : null}
          </div>

          <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
            {machines.map((m) => (
              <MachineCard key={m.id} machine={m} needleCount={fleet.needleCount} onOpen={() => setOpenId(m.id)} />
            ))}
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-cream-200 bg-white px-5 py-8 text-center">
          <p className="font-ui text-sm text-ink-muted">
            {room.active
              ? "Every head in this room is switched off."
              : "This room is switched off in the active configuration."}
          </p>
          <Link
            href="/machines"
            className="font-ui mt-3 inline-block rounded-full border border-cream-200 px-3.5 py-1.5 text-xs font-semibold text-espresso transition-colors hover:border-pink hover:bg-pink-soft focus-ring"
          >
            Thread Config →
          </Link>
        </div>
      )}

      <p className="font-ui mt-8 text-xs text-ink-muted">
        {hasActiveConfig
          ? "Showing the active configuration — what the floor is threaded to."
          : "No active configuration has been set yet, so this is the solver's own answer."}{" "}
        Based on {windowLabel || "recent"} of orders · {jobCount} designs
        {updatedAt ? ` · data updated ${updatedAt}` : ""}.
      </p>

      {openMachine ? (
        <MachineModal machine={openMachine} needleCount={fleet.needleCount} onClose={() => setOpenId(null)} />
      ) : null}
    </div>
  );
}
