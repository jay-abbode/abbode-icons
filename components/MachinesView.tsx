"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import {
  captureRoomSlots,
  computeAllocation,
  defaultFloor,
  defaultOffIds,
  fleetBase,
  floorFingerprint,
  normalizeFloors,
  type Fleet,
  type FleetKey,
  type FloorState,
  type Job,
  type MachineJobsMeta,
  type RoomResult,
  type SolveScope,
} from "@/lib/threadAllocation";
import type { MachineConfig } from "@/lib/machineConfigs";
import { removeConfig, saveConfig, setActiveConfig } from "@/app/actions/machineConfigs";
import { ColorStrip, MachineCard, MachineModal, pct } from "@/components/MachineParts";

/**
 * Machine thread allocation.
 *
 * Webster is 25 heads across 6 rooms. You can switch rooms and individual heads
 * on and off, rename rooms, lock a room's loadout so it stops re-solving under
 * you, and save the whole floor as a configuration you can load back.
 *
 * The solver runs in the browser, so every toggle re-scores instantly. Nothing
 * touches the sheet until you set an active config or save a named one.
 */

// ── Config bar ─────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}

function ConfigBar({
  fleet,
  configs,
  dirty,
  busy,
  error,
  scoreNow,
  onSetActive,
  onSaveAs,
  onLoad,
  onDelete,
  onReset,
}: {
  fleet: Fleet;
  configs: MachineConfig[];
  dirty: boolean;
  busy: boolean;
  error: string | null;
  /** Re-score any saved floor against today's jobs. */
  scoreNow: (state: FloorState) => number;
  onSetActive: () => void;
  onSaveAs: (name: string) => void;
  onLoad: (c: MachineConfig) => void;
  onDelete: (c: MachineConfig) => void;
  onReset: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const mine = configs.filter((c) => c.fleet === fleet.key);
  const active = mine.find((c) => c.kind === "active") ?? null;
  const saved = mine.filter((c) => c.kind === "saved");
  const snapshots = mine.filter((c) => c.kind === "snapshot");

  return (
    <div className="mb-5 rounded-2xl border border-cream-200 bg-white px-4 py-3.5 md:px-5">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="font-ui min-w-0 text-xs text-ink-muted">
          {active ? (
            <>
              <span className="font-semibold text-espresso">On the floor</span> · set {timeAgo(active.savedAt)}
              {active.savedBy ? ` by ${active.savedBy.split("@")[0]}` : ""} · scored {pct(active.score)}% then,{" "}
              <strong className="text-espresso">{pct(scoreNow(active.state))}% now</strong>
            </>
          ) : (
            <>
              <span className="font-semibold text-espresso">No active configuration yet</span> — this is the solver&rsquo;s
              own answer. Set it active once the floor is threaded to it.
            </>
          )}
          {dirty ? (
            <span className="ml-2 rounded-full bg-pink-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cherry">
              unsaved changes
            </span>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {dirty ? (
            <button
              type="button"
              onClick={onReset}
              disabled={busy}
              className="font-ui rounded-full border border-cream-200 bg-white px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:text-espresso disabled:opacity-50 focus-ring"
            >
              Discard
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setNaming((v) => !v)}
            disabled={busy}
            className="font-ui rounded-full border border-cream-200 bg-white px-3 py-1.5 text-xs font-semibold text-espresso transition-colors hover:border-pink hover:bg-pink-soft disabled:opacity-50 focus-ring"
          >
            Save as…
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="font-ui rounded-full border border-cream-200 bg-white px-3 py-1.5 text-xs font-semibold text-espresso transition-colors hover:border-pink hover:bg-pink-soft focus-ring"
            >
              Load ▾
            </button>
            {open ? (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} aria-hidden />
                <div className="absolute right-0 z-40 mt-1.5 max-h-[22rem] w-80 overflow-auto rounded-xl border border-cream-200 bg-white p-1.5 shadow-lg">
                  {saved.length === 0 && snapshots.length === 0 ? (
                    <p className="font-ui px-2.5 py-2 text-xs text-ink-muted">
                      Nothing saved yet. &ldquo;Save as…&rdquo; keeps a floor you can come back to.
                    </p>
                  ) : null}
                  {saved.length ? (
                    <p className="font-ui px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      Saved
                    </p>
                  ) : null}
                  {saved.map((c) => (
                    <ConfigRow
                      key={c.id}
                      config={c}
                      now={scoreNow(c.state)}
                      onLoad={() => {
                        onLoad(c);
                        setOpen(false);
                      }}
                      onDelete={() => onDelete(c)}
                    />
                  ))}
                  {snapshots.length ? (
                    <p className="font-ui px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                      Auto-snapshots
                    </p>
                  ) : null}
                  {snapshots.map((c) => (
                    <ConfigRow
                      key={c.id}
                      config={c}
                      now={scoreNow(c.state)}
                      onLoad={() => {
                        onLoad(c);
                        setOpen(false);
                      }}
                      onDelete={() => onDelete(c)}
                    />
                  ))}
                </div>
              </>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onSetActive}
            disabled={busy || (!dirty && !!active)}
            className="font-ui rounded-full bg-plum px-3.5 py-1.5 text-xs font-semibold text-porcelain transition-colors hover:bg-cherry disabled:opacity-40 focus-ring"
          >
            {busy ? "Saving…" : "Set as active"}
          </button>
        </div>
      </div>

      {naming ? (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-cream-200 pt-3">
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && name.trim()) {
                onSaveAs(name.trim());
                setName("");
                setNaming(false);
              }
              if (e.key === "Escape") setNaming(false);
            }}
            placeholder="Holiday, Rush week, Tuesday…"
            maxLength={60}
            className="font-ui w-64 rounded-lg border border-cream-200 bg-white px-3 py-1.5 text-sm text-espresso focus-ring"
          />
          <button
            type="button"
            disabled={!name.trim() || busy}
            onClick={() => {
              onSaveAs(name.trim());
              setName("");
              setNaming(false);
            }}
            className="font-ui rounded-full bg-plum px-3.5 py-1.5 text-xs font-semibold text-porcelain transition-colors hover:bg-cherry disabled:opacity-40 focus-ring"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setNaming(false)}
            className="font-ui rounded-full border border-cream-200 px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors hover:text-espresso focus-ring"
          >
            Cancel
          </button>
          <span className="font-ui text-xs text-ink-muted">
            Saves the whole floor — rooms, heads, off-color picks, locks.
          </span>
        </div>
      ) : null}

      {error ? <p className="font-ui mt-2 text-xs text-tomato">{error}</p> : null}
    </div>
  );
}

function ConfigRow({
  config,
  now,
  onLoad,
  onDelete,
}: {
  config: MachineConfig;
  now: number;
  onLoad: () => void;
  onDelete: () => void;
}) {
  const then = pct(config.score);
  const nowPct = pct(now);
  const drifted = Math.abs(nowPct - then) >= 1;
  return (
    <div className="group flex items-center gap-2 rounded-lg px-2.5 py-1.5 hover:bg-parchment">
      <button type="button" onClick={onLoad} className="font-ui min-w-0 flex-1 text-left focus-ring">
        <span className="block truncate text-[13px] font-semibold text-espresso">
          {config.name || "Untitled"}
        </span>
        <span className="block text-[11px] text-ink-muted">
          {timeAgo(config.savedAt)} · saved at {then}%
          {drifted ? (
            <span className={nowPct < then ? "text-cherry" : "text-olive"}> · scores {nowPct}% now</span>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${config.name}`}
        className="font-ui flex h-6 w-6 flex-none items-center justify-center rounded-full text-ink-muted opacity-0 transition-opacity hover:bg-pink-soft hover:text-cherry group-hover:opacity-100 focus-ring"
      >
        ✕
      </button>
    </div>
  );
}

// ── Scope ──────────────────────────────────────────────────────────────────

function ScopeControl({ scope, onChange }: { scope: SolveScope; onChange: (s: SolveScope) => void }) {
  return (
    <div className="mb-5 rounded-2xl border border-cream-200 bg-white px-4 py-3.5 md:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-ui text-sm font-semibold text-espresso">Solve for:</span>
        <div className="inline-flex gap-1 rounded-full bg-parchment p-1">
          {(["fleet", "room"] as SolveScope[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => onChange(s)}
              aria-pressed={scope === s}
              className={`font-ui rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors focus-ring ${
                scope === s ? "bg-white text-espresso shadow-sm" : "text-ink-muted hover:text-espresso"
              }`}
            >
              {s === "fleet" ? "The whole floor" : "Each room on its own"}
            </button>
          ))}
        </div>
      </div>
      <p className="font-ui mt-2 text-xs text-ink-muted">
        {scope === "fleet"
          ? "One shared tail: the off-color heads cover the whole floor, wherever they sit. Right when a job can go to any machine — the fleet number is the honest one."
          : "Every room covers its own tail, so a room can run anything handed to it without leaning on the others. Right when a room only ever stitches its own queue. Costs a few points fleet-wide; raises the weakest room."}
      </p>
      <p className="font-ui mt-1 text-xs text-ink-muted">
        Changing this resets the off-color picks to the sensible default for that mode.
      </p>
    </div>
  );
}

// ── Rooms ──────────────────────────────────────────────────────────────────

function PowerDot({ on }: { on: boolean }) {
  return (
    <span
      className={`inline-block h-1.5 w-1.5 flex-none rounded-full ${on ? "bg-olive" : "bg-cream-200"}`}
      aria-hidden
    />
  );
}

function RoomBox({
  room,
  fleet,
  locked,
  onToggleRoom,
  onToggleMachine,
  onToggleOff,
  onToggleLock,
  onRename,
  onOpenMachine,
}: {
  room: RoomResult;
  fleet: Fleet;
  locked: boolean;
  onToggleRoom: () => void;
  onToggleMachine: (id: string) => void;
  onToggleOff: (id: string) => void;
  onToggleLock: () => void;
  onRename: (name: string) => void;
  onOpenMachine: (id: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(room.name);

  const stdCount = room.machines.filter((m) => m.active && !m.offColor).length;
  const offCount = room.machines.filter((m) => m.active && m.offColor).length;
  const driftPts = pct(room.freshChangeFree) - pct(room.changeFree);
  const drifted = locked && driftPts >= 1;

  function commit() {
    setEditing(false);
    const clean = draft.trim();
    onRename(clean && clean !== `Room ${room.id}` ? clean : "");
  }

  return (
    <section
      className={`rounded-2xl border bg-white p-4 transition-opacity md:p-5 ${
        room.active ? "border-cream-200" : "border-cream-200 opacity-55"
      } ${locked ? "ring-1 ring-plum/25" : ""}`}
    >
      <header className="mb-3 flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={room.active}
              onClick={onToggleRoom}
              disabled={locked}
              aria-label={`${room.active ? "Deactivate" : "Activate"} ${room.name}`}
              className={`relative h-5 w-9 flex-none rounded-full transition-colors disabled:opacity-40 focus-ring ${
                room.active ? "bg-olive" : "bg-cream-200"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-all ${
                  room.active ? "left-[1.15rem]" : "left-0.5"
                }`}
              />
            </button>

            {editing ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") {
                    setDraft(room.name);
                    setEditing(false);
                  }
                }}
                maxLength={40}
                className="font-display w-44 rounded-lg border border-cream-200 bg-white px-2 py-1 text-lg text-espresso focus-ring"
              />
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDraft(room.name);
                  setEditing(true);
                }}
                title="Rename this room"
                className="font-display group flex min-w-0 items-center gap-1.5 text-lg text-espresso focus-ring"
              >
                <span className="truncate">{room.name}</span>
                <span className="font-ui text-[10px] text-ink-muted opacity-0 transition-opacity group-hover:opacity-100">
                  ✎
                </span>
              </button>
            )}
            <span className="font-ui rounded-full bg-parchment px-1.5 py-0.5 text-[10px] font-semibold tabular-nums text-ink-muted">
              {room.id}
            </span>
          </div>
          <p className="font-ui mt-1 text-xs text-ink-muted">
            {room.active ? (
              <>
                {room.activeCount} of {room.machines.length} heads · {stdCount} standard
                {offCount ? ` + ${offCount} off-color` : ""}
              </>
            ) : (
              "Room switched off"
            )}
          </p>
        </div>

        <div className="flex flex-none items-center gap-2">
          {room.active ? (
            <span className="font-display text-2xl leading-none text-plum">{pct(room.changeFree)}%</span>
          ) : null}
          <button
            type="button"
            onClick={onToggleLock}
            aria-pressed={locked}
            title={locked ? "Unlock — let this room re-solve" : "Lock — pin this room's loadout"}
            className={`font-ui rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus-ring ${
              locked
                ? "border-plum bg-plum text-porcelain"
                : "border-cream-200 bg-white text-ink-muted hover:border-pink hover:text-espresso"
            }`}
          >
            {locked ? "🔒 Locked" : "Lock"}
          </button>
        </div>
      </header>

      {drifted ? (
        <p className="font-ui mb-3 rounded-lg bg-pink-soft px-2.5 py-1.5 text-[11px] text-cherry">
          Locked — a fresh thread-up would score {pct(room.freshChangeFree)}% on today&rsquo;s orders (this loadout
          scores {pct(room.changeFree)}%).
        </p>
      ) : null}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {room.machines.map((m) => (
          <div
            key={m.id}
            className={`rounded-xl border p-2 transition-colors ${
              m.active ? "border-cream-200 bg-porcelain" : "border-cream-200 bg-parchment/60"
            }`}
          >
            <button
              type="button"
              onClick={() => m.active && onOpenMachine(m.id)}
              disabled={!m.active}
              aria-label={`Open ${m.name}`}
              className="mb-1.5 block w-full disabled:cursor-default focus-ring"
            >
              <ColorStrip slots={m.slots} />
            </button>
            <div className="flex items-center justify-between gap-1">
              <span className="font-ui flex items-center gap-1 text-[13px] font-semibold tabular-nums text-espresso">
                <PowerDot on={m.active} />
                {m.name}
              </span>
              <button
                type="button"
                onClick={() => onToggleMachine(m.id)}
                disabled={locked || !room.active}
                aria-label={`${m.active ? "Switch off" : "Switch on"} ${m.name}`}
                className="font-ui text-[10px] font-semibold text-ink-muted transition-colors hover:text-espresso disabled:opacity-40 focus-ring"
              >
                {m.active ? "off" : "on"}
              </button>
            </div>
            <button
              type="button"
              onClick={() => onToggleOff(m.id)}
              disabled={locked || !room.active || !m.active}
              aria-pressed={m.offColor}
              className={`font-ui mt-1.5 w-full rounded-full border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide transition-colors disabled:opacity-40 focus-ring ${
                m.offColor
                  ? "border-berry bg-pink-soft text-cherry"
                  : "border-cream-200 bg-white text-ink-muted hover:border-pink"
              }`}
            >
              {m.offColor ? "off-color" : "standard"}
            </button>
          </div>
        ))}
      </div>

      <div className="mt-3 flex items-center justify-between">
        <Link
          href={`/machines/${fleet.key}/room/${room.id}`}
          className="font-ui text-xs font-semibold text-berry transition-colors hover:text-cherry focus-ring"
        >
          Open room →
        </Link>
        <span className="font-ui text-[11px] text-ink-muted">
          {locked ? "loadout pinned" : "re-solves with the floor"}
        </span>
      </div>
    </section>
  );
}

// ── Roomless fleets (Abbode) ───────────────────────────────────────────────

function OffColorControl({
  fleet,
  onToggle,
  defaultCount,
}: {
  fleet: Fleet;
  onToggle: (id: string) => void;
  defaultCount: number;
}) {
  return (
    <div className="mb-5 rounded-2xl border border-cream-200 bg-white px-4 py-3.5 md:px-5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="font-ui text-sm font-semibold text-espresso">Off-color heads:</span>
        <div className="flex flex-wrap gap-1.5">
          {fleet.machines.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => onToggle(m.id)}
              aria-pressed={m.offColor}
              className={`font-ui rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus-ring ${
                m.offColor
                  ? "border-berry bg-pink-soft text-cherry"
                  : "border-cream-200 bg-white text-ink-muted hover:border-pink"
              }`}
            >
              {m.offColor ? "✓ " : ""}
              {m.name}
            </button>
          ))}
        </div>
      </div>
      <p className="font-ui mt-2 text-xs text-ink-muted">
        Off-color heads carry the rarer colors so the standard heads can stay loaded with the popular ones. Default is
        the last {defaultCount} {defaultCount === 1 ? "head" : "heads"} of this fleet.
      </p>
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function MachinesView({
  jobs,
  meta,
  floors: savedFloors,
  configs: initialConfigs,
}: {
  jobs: Job[];
  meta: MachineJobsMeta;
  floors: Partial<Record<FleetKey, FloorState>>;
  configs: MachineConfig[];
}) {
  const persisted = useMemo(() => normalizeFloors(savedFloors), [savedFloors]);

  const [floors, setFloors] = useState<Record<FleetKey, FloorState>>(() => persisted);
  const [configs, setConfigs] = useState<MachineConfig[]>(initialConfigs);
  const [active, setActive] = useState<FleetKey>("webster");
  const [openId, setOpenId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const result = useMemo(() => computeAllocation(jobs, floors, meta), [jobs, floors, meta]);
  const fleet = result.fleets.find((f) => f.key === active) ?? result.fleets[0];
  const base = fleetBase(fleet.key);
  const floor = floors[fleet.key];

  const dirty =
    floorFingerprint(base, floor) !== floorFingerprint(base, persisted[fleet.key]) ||
    !configs.some((c) => c.fleet === fleet.key && c.kind === "active");

  // Re-score any saved floor against today's jobs — that's config drift, visible.
  const scoreNow = useMemo(
    () => (state: FloorState) => {
      const r = computeAllocation(jobs, { [fleet.key]: state }, meta);
      return r.fleets.find((f) => f.key === fleet.key)?.changeFreeAll ?? 0;
    },
    [jobs, meta, fleet.key]
  );

  useEffect(() => {
    if (openId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [openId]);

  function edit(fn: (f: FloorState) => FloorState) {
    setError(null);
    setFloors((prev) => ({ ...prev, [fleet.key]: fn(prev[fleet.key]) }));
  }

  const toggleIn = (list: string[], id: string) =>
    list.includes(id) ? list.filter((x) => x !== id) : [...list, id];

  function setScope(scope: SolveScope) {
    setOpenId(null);
    edit((f) => ({ ...f, scope, offColor: defaultOffIds(base, scope) }));
  }

  function toggleRoom(roomId: string) {
    edit((f) => ({ ...f, inactiveRooms: toggleIn(f.inactiveRooms, roomId) }));
  }

  function toggleMachine(id: string) {
    edit((f) => ({ ...f, inactiveMachines: toggleIn(f.inactiveMachines, id) }));
  }

  function toggleOffColor(id: string) {
    edit((f) => ({ ...f, offColor: toggleIn(f.offColor, id) }));
  }

  function renameRoom(roomId: string, name: string) {
    edit((f) => {
      const roomNames = { ...f.roomNames };
      if (name) roomNames[roomId] = name;
      else delete roomNames[roomId];
      return { ...f, roomNames };
    });
  }

  /** Locking pins the loadout the room has right now; unlocking releases it. */
  function toggleLock(roomId: string) {
    const isLocked = floor.lockedRooms.includes(roomId);
    edit((f) => {
      const lockedSlots = { ...f.lockedSlots };
      if (isLocked) {
        for (const key of Object.keys(lockedSlots)) {
          if (key.startsWith(`${roomId}-`)) delete lockedSlots[key];
        }
        return { ...f, lockedRooms: f.lockedRooms.filter((r) => r !== roomId), lockedSlots };
      }
      return {
        ...f,
        lockedRooms: [...f.lockedRooms, roomId],
        lockedSlots: { ...lockedSlots, ...captureRoomSlots(fleet, roomId) },
      };
    });
  }

  const meta4 = { score: fleet.changeFreeAll, window: result.window, jobCount: result.jobCount };

  function run(action: () => Promise<{ ok: true; configs: MachineConfig[] } | { ok: false; error: string }>) {
    startTransition(async () => {
      const res = await action();
      if (res.ok) {
        setConfigs(res.configs);
        setError(null);
      } else {
        setError(res.error);
      }
    });
  }

  function onSetActive() {
    run(() => setActiveConfig(fleet.key, floor, meta4));
  }
  function onSaveAs(name: string) {
    run(() => saveConfig(fleet.key, name, floor, meta4));
  }
  function onDelete(c: MachineConfig) {
    run(() => removeConfig(fleet.key, c.id));
  }
  function onLoad(c: MachineConfig) {
    setOpenId(null);
    setError(null);
    setFloors((prev) => ({ ...prev, [fleet.key]: c.state }));
  }
  function onReset() {
    setOpenId(null);
    setError(null);
    setFloors((prev) => ({ ...prev, [fleet.key]: persisted[fleet.key] ?? defaultFloor(base) }));
  }

  const openMachine = openId ? fleet.machines.find((m) => m.id === openId) ?? null : null;
  const daysheetHref = `/machines/daysheet?fleet=${fleet.key}`;
  const delta = pct(fleet.changeFreeAll) - pct(fleet.changeFreeStandard);

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl text-espresso">Machine thread allocation</h1>
          <p className="font-ui mt-1 max-w-2xl text-sm text-ink-muted">
            Which spool colors to load on each head so the most orders stitch without a thread change. Spool color is
            the thread itself; the number is its color-menu #; hover a spool for the name; click a head to enlarge it.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Link
            href={daysheetHref}
            className="font-ui rounded-full border border-parchment bg-white px-3.5 py-2 text-xs font-semibold text-espresso transition-colors hover:border-pink hover:bg-pink-soft focus-ring"
          >
            Print day sheet →
          </Link>
          {dirty ? (
            <span className="font-ui text-[11px] text-ink-muted">prints the active config, not your edits</span>
          ) : null}
        </div>
      </div>

      {/* Fleet toggle */}
      <div className="mb-6 inline-flex flex-wrap gap-1 rounded-full bg-parchment p-1">
        {result.fleets.map((f) => {
          const on = f.key === active;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setOpenId(null);
                setActive(f.key);
              }}
              aria-pressed={on}
              className={`font-ui rounded-full px-4 py-2 text-sm font-semibold transition-colors focus-ring ${
                on ? "bg-white text-espresso shadow-sm" : "text-ink-muted hover:text-espresso"
              }`}
            >
              {f.label} · {f.activeCount} × {f.needleCount}-needle
              <span className="ml-1 hidden font-normal text-ink-muted sm:inline">
                ({f.activeCount - f.offCount} standard + {f.offCount} off-color)
              </span>
            </button>
          );
        })}
      </div>

      {/* Change-free callout */}
      <div className="mb-5 rounded-2xl border border-cream-200 bg-white px-5 py-5 md:px-7 md:py-6">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span className="font-display text-5xl leading-none text-plum md:text-6xl">
            {pct(fleet.changeFreeAll)}%
          </span>
          <span className="font-ui text-base text-espresso md:text-lg">
            of orders run <strong>change-free</strong> — no spool swaps — across the {fleet.label} fleet
          </span>
        </div>
        <p className="font-ui mt-2 text-xs text-ink-muted md:text-[13px]">
          {fleet.standardCount > 0 ? (
            <>
              {pct(fleet.changeFreeStandard)}% on the {fleet.standardCount} standard{" "}
              {fleet.standardCount === 1 ? "head" : "heads"} alone
              {fleet.offCount > 0 && delta > 0 ? (
                <>
                  {" "}
                  · +{delta} points from the{" "}
                  {fleet.offCount === 1 ? "off-color head" : `${fleet.offCount} off-color heads`}
                </>
              ) : null}
            </>
          ) : (
            <>No standard heads running — every active head is off-color or pinned.</>
          )}
          {fleet.rooms ? (
            <>
              {" "}
              · solved {fleet.scope === "fleet" ? "across the whole floor" : "room by room"}
            </>
          ) : null}
        </p>
      </div>

      <ConfigBar
        fleet={fleet}
        configs={configs}
        dirty={dirty}
        busy={pending}
        error={error}
        scoreNow={scoreNow}
        onSetActive={onSetActive}
        onSaveAs={onSaveAs}
        onLoad={onLoad}
        onDelete={onDelete}
        onReset={onReset}
      />

      {fleet.rooms ? (
        <>
          <ScopeControl scope={fleet.scope} onChange={setScope} />
          {fleet.scope === "fleet" ? (
            <p className="font-ui mb-4 rounded-xl bg-parchment px-4 py-2.5 text-xs text-ink-soft">
              A room&rsquo;s % counts only its own heads. The {pct(fleet.changeFreeAll)}% floor number is higher
              because it assumes a job can go to <em>any</em> head — including the off-color ones, wherever they sit.
              If work can&rsquo;t be steered to a particular room, the room numbers below are the real ones.
            </p>
          ) : null}
          <div className="grid gap-4 lg:grid-cols-2">
            {fleet.rooms.map((room) => (
              <RoomBox
                key={room.id}
                room={room}
                fleet={fleet}
                locked={room.locked}
                onToggleRoom={() => toggleRoom(room.id)}
                onToggleMachine={toggleMachine}
                onToggleOff={toggleOffColor}
                onToggleLock={() => toggleLock(room.id)}
                onRename={(name) => renameRoom(room.id, name)}
                onOpenMachine={setOpenId}
              />
            ))}
          </div>
        </>
      ) : (
        <>
          <OffColorControl fleet={fleet} onToggle={toggleOffColor} defaultCount={base.defaultOffCount} />
          <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
            {fleet.machines.map((m) => (
              <MachineCard key={m.id} machine={m} needleCount={fleet.needleCount} onOpen={() => setOpenId(m.id)} />
            ))}
          </div>
        </>
      )}

      <p className="font-ui mt-8 text-xs text-ink-muted">
        Based on {result.window || "recent"} of orders · {result.jobCount} designs
        {result.updatedAt ? ` · data updated ${result.updatedAt}` : ""}
        {result.source && result.source !== "THREAD_STATS"
          ? " · showing 12-month data until the 3-month feed runs"
          : ""}
        . Loadouts re-tune automatically as ordering shifts — except in a locked room, which stays put.
      </p>

      {openMachine ? (
        <MachineModal machine={openMachine} needleCount={fleet.needleCount} onClose={() => setOpenId(null)} />
      ) : null}
    </div>
  );
}
