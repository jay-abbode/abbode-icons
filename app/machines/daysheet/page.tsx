import { getMachineJobs } from "@/lib/threadAllocationData";
import { getActiveFloors, getConfig } from "@/lib/machineConfigs";
import {
  computeAllocation,
  type Fleet,
  type FleetKey,
  type FloorState,
  type Machine,
  type RoomResult,
} from "@/lib/threadAllocation";
import { getThreadBySlot, rgbToHex } from "@/lib/threadPalette";
import DaySheetHeader from "@/components/DaySheetHeader";

/**
 * The printable thread-up sheet. Prints the ACTIVE configuration — what the
 * floor is actually threaded to — so what comes off the printer matches what
 * someone is about to load. Falls back to the solver's own answer when no
 * active config has been set yet.
 *
 *   ?fleet=webster        only that fleet
 *   ?fleet=webster&room=3 only that room  (Room 3 should print Room 3)
 *   ?cfg=<id>             a specific saved configuration
 */
export const dynamic = "force-dynamic";

function pct(x: number): number {
  return Math.round(x * 100);
}

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

function isFleetKey(v: string | undefined): v is FleetKey {
  return v === "abbode" || v === "webster";
}

function MachineBlock({ machine, needleCount }: { machine: Machine; needleCount: number }) {
  const needles = Array.from({ length: needleCount }, (_, i) => i + 1);
  return (
    <div className="break-inside-avoid rounded-lg border border-cream-200 p-3">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="font-display text-base text-espresso">{machine.name}</h3>
        <span
          className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${
            machine.offColor ? "bg-pink-soft text-cherry" : "bg-parchment text-ink-muted"
          }`}
        >
          {machine.offColor ? "off-color" : "standard"}
        </span>
      </div>
      <table className="font-ui w-full border-collapse text-[11.5px]">
        <thead>
          <tr className="text-ink-muted">
            <th className="border-b border-cream-200 py-0.5 pr-2 text-left font-semibold">Ndl</th>
            <th className="border-b border-cream-200 py-0.5 pr-2 text-left font-semibold">#</th>
            <th className="border-b border-cream-200 py-0.5 text-left font-semibold">Color</th>
          </tr>
        </thead>
        <tbody>
          {needles.map((n) => {
            const slot = machine.slots[n - 1];
            const color = getThreadBySlot(slot);
            return (
              <tr key={n}>
                <td className="border-b border-cream-200/60 py-0.5 pr-2 tabular-nums text-ink-soft">{n}</td>
                <td className="border-b border-cream-200/60 py-0.5 pr-2 tabular-nums text-ink-soft">
                  {color ? slot : "—"}
                </td>
                <td className="border-b border-cream-200/60 py-0.5">
                  <span className="flex items-center gap-1">
                    {color ? (
                      <span
                        className="inline-block h-2.5 w-2.5 flex-none rounded-[2px] ring-1 ring-black/10"
                        style={{ backgroundColor: rgbToHex(color.rgb) }}
                      />
                    ) : null}
                    <span className="text-espresso">{color ? color.name : "—"}</span>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function MachineGrid({ machines, needleCount }: { machines: Machine[]; needleCount: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 print:grid-cols-3">
      {machines.map((m) => (
        <MachineBlock key={m.id} machine={m} needleCount={needleCount} />
      ))}
    </div>
  );
}

function RoomBlock({ room, needleCount }: { room: RoomResult; needleCount: number }) {
  const machines = room.machines.filter((m) => m.active);
  if (!room.active || !machines.length) return null;
  return (
    <section className="mb-5 break-inside-avoid">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-cream-200 pb-1">
        <h3 className="font-display text-base text-espresso">
          {room.name}
          <span className="font-ui ml-1.5 text-[11px] font-normal text-ink-muted">
            room {room.id} · {machines.length} {machines.length === 1 ? "head" : "heads"}
            {room.locked ? " · locked" : ""}
          </span>
        </h3>
        <span className="font-ui text-[11px] text-ink-soft">
          <strong className="text-espresso">{pct(room.changeFree)}%</strong> change-free
        </span>
      </div>
      <MachineGrid machines={machines} needleCount={needleCount} />
    </section>
  );
}

function FleetBlock({ fleet }: { fleet: Fleet }) {
  const machines = fleet.machines.filter((m) => m.active);
  if (!machines.length) return null;
  return (
    <section className="mb-7">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 border-b-2 border-plum/25 pb-1">
        <h2 className="font-display text-xl text-plum">
          {fleet.label} <span className="font-ui text-xs font-normal text-ink-muted">— {fleet.brand}</span>
        </h2>
        <p className="font-ui text-xs text-ink-soft">
          <strong className="text-espresso">{pct(fleet.changeFreeAll)}%</strong> change-free
          <span className="text-ink-muted">
            {" "}
            ({pct(fleet.changeFreeStandard)}% standard
            {fleet.offCount > 0 ? ` + ${fleet.offCount} off-color` : ""})
          </span>
        </p>
      </div>
      {fleet.rooms ? (
        fleet.rooms.map((r) => <RoomBlock key={r.id} room={r} needleCount={fleet.needleCount} />)
      ) : (
        <MachineGrid machines={machines} needleCount={fleet.needleCount} />
      )}
    </section>
  );
}

export default async function DaySheetPage({
  searchParams,
}: {
  searchParams: { fleet?: string | string[]; room?: string | string[]; cfg?: string | string[] };
}) {
  const fleetParam = one(searchParams.fleet);
  const roomParam = one(searchParams.room);
  const cfgParam = one(searchParams.cfg);

  let floors: Partial<Record<FleetKey, FloorState>> = {};
  let configName: string | null = null;

  try {
    if (cfgParam) {
      const cfg = await getConfig(cfgParam);
      if (cfg) {
        floors = { [cfg.fleet]: cfg.state };
        configName = cfg.name;
      }
    } else {
      floors = await getActiveFloors();
    }
  } catch {
    floors = {}; // no MACHINE_CONFIGS tab yet — fall back to the solver's answer
  }

  let data;
  try {
    const { jobs, meta } = await getMachineJobs();
    data = computeAllocation(jobs, floors, meta);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return (
      <main className="mx-auto max-w-3xl p-10">
        <h1 className="font-display text-2xl text-tomato">Failed to load machine data</h1>
        <pre className="mt-4 rounded-lg bg-pink-soft p-4 text-xs text-cherry">{message}</pre>
      </main>
    );
  }

  // Narrow to one fleet, and optionally to one room inside it.
  let fleets = data.fleets;
  if (isFleetKey(fleetParam)) fleets = fleets.filter((f) => f.key === fleetParam);
  let scopeLabel = "";
  if (roomParam && fleets.length === 1 && fleets[0].rooms) {
    const f = fleets[0];
    const room = f.rooms!.find((r) => r.id === roomParam);
    if (room) {
      const ids = new Set(room.machines.map((m) => m.id));
      fleets = [{ ...f, rooms: [room], machines: f.machines.filter((m) => ids.has(m.id)) }];
      scopeLabel = `${f.label} · ${room.name}`;
    }
  }

  return (
    <main className="mx-auto max-w-5xl px-6 py-8 print:px-0 print:py-0">
      {/* Print styling: tight page margins, white background, keep swatch colors. */}
      <style>{`
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        @media print {
          @page { margin: 12mm; }
          body { background: #ffffff !important; }
        }
      `}</style>

      <DaySheetHeader
        windowLabel={data.window}
        jobCount={data.jobCount}
        updatedAt={data.updatedAt}
        scopeLabel={scopeLabel}
        configName={configName}
      />

      {fleets.map((f) => (
        <FleetBlock key={f.key} fleet={f} />
      ))}

      <p className="font-ui mt-6 text-[11px] text-ink-muted">
        Needle 1 = most-ordered color on each head. A head stitches a design change-free when every color the design
        uses is already loaded on it. Loadouts are computed from {data.window || "recent"} of orders and re-tune as
        ordering shifts — except in a locked room, which stays put until it&rsquo;s unlocked.
      </p>
    </main>
  );
}
