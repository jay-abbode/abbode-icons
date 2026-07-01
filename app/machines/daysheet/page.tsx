import { getMachineAllocation } from "@/lib/threadAllocationData";
import { FLEET_BASES, defaultOffSelection, type Fleet, type Machine, type OffSelection } from "@/lib/threadAllocation";
import { getThreadBySlot, rgbToHex } from "@/lib/threadPalette";
import DaySheetHeader from "@/components/DaySheetHeader";

export const dynamic = "force-dynamic";

function pct(x: number): number {
  return Math.round(x * 100);
}

/** Parse a `?ab=6,7` style param into off-color indices. A missing param means
 * "use the default"; an explicitly-empty param means "no off-color heads". */
function parseOff(param: string | string[] | undefined, machineCount: number, fallback: number[]): number[] {
  if (param === undefined) return fallback;
  const raw = Array.isArray(param) ? param.join(",") : param;
  if (raw.trim() === "") return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const tok of raw.split(",")) {
    const n = parseInt(tok.trim(), 10);
    if (Number.isInteger(n) && n >= 0 && n < machineCount && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out.sort((a, b) => a - b);
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
                <td className="border-b border-cream-200/60 py-0.5 pr-2 tabular-nums text-ink-soft">{color ? slot : "—"}</td>
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

function FleetBlock({ fleet }: { fleet: Fleet }) {
  const offCount = fleet.machines.filter((m) => m.offColor).length;
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
            ({pct(fleet.changeFreeStandard)}% standard{offCount > 0 ? ` + ${offCount} off-color` : ""})
          </span>
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 print:grid-cols-3">
        {fleet.machines.map((m, i) => (
          <MachineBlock key={`${m.name}-${i}`} machine={m} needleCount={fleet.needleCount} />
        ))}
      </div>
    </section>
  );
}

export default async function DaySheetPage({
  searchParams,
}: {
  searchParams: { ab?: string | string[]; wb?: string | string[] };
}) {
  const fallback = defaultOffSelection();
  const byKey = Object.fromEntries(FLEET_BASES.map((b) => [b.key, b]));
  const offSel: OffSelection = {
    abbode: parseOff(searchParams.ab, byKey.abbode.machineNames.length, fallback.abbode),
    webster: parseOff(searchParams.wb, byKey.webster.machineNames.length, fallback.webster),
  };

  let data;
  try {
    data = await getMachineAllocation(offSel);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return (
      <main className="mx-auto max-w-3xl p-10">
        <h1 className="font-display text-2xl text-tomato">Failed to load machine data</h1>
        <pre className="mt-4 rounded-lg bg-pink-soft p-4 text-xs text-cherry">{message}</pre>
      </main>
    );
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

      <DaySheetHeader windowLabel={data.window} jobCount={data.jobCount} updatedAt={data.updatedAt} />

      {data.fleets.map((f) => (
        <FleetBlock key={f.key} fleet={f} />
      ))}

      <p className="font-ui mt-6 text-[11px] text-ink-muted">
        Needle 1 = most-ordered color on each machine. A machine stitches a design change-free when every color the
        design uses is already loaded on it. Loadouts are computed from {data.window || "recent"} of orders and re-tune
        as ordering shifts.
      </p>
    </main>
  );
}
