import Link from "next/link";
import { notFound } from "next/navigation";
import Header from "@/components/Header";
import RoomView from "@/components/RoomView";
import { getMachineJobs } from "@/lib/threadAllocationData";
import { getActiveFloors } from "@/lib/machineConfigs";
import { computeAllocation, FLEET_BASES, type FleetKey } from "@/lib/threadAllocation";

// Reads the *active* configuration on every request — a room tablet should
// never show a stale loadout, and it should never re-solve on its own.
export const dynamic = "force-dynamic";

function isFleetKey(v: string): v is FleetKey {
  return v === "abbode" || v === "webster";
}

/** Rooms are an optional fleet property, so this route works for any fleet that
 * grows them later without a rewrite. */
export default async function RoomPage({ params }: { params: { fleet: string; id: string } }) {
  if (!isFleetKey(params.fleet)) notFound();
  const base = FLEET_BASES.find((b) => b.key === params.fleet);
  if (!base?.rooms?.some((r) => r.id === params.id)) notFound();

  let jobs, meta, floors;
  try {
    const data = await getMachineJobs();
    jobs = data.jobs;
    meta = data.meta;
    floors = await getActiveFloors().catch(() => ({}));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return (
      <>
        <Header />
        <main className="mx-auto max-w-3xl p-10">
          <h1 className="font-display text-3xl text-tomato">Failed to load machine data</h1>
          <pre className="mt-4 rounded-lg bg-pink-soft p-4 text-xs text-cherry">{message}</pre>
        </main>
      </>
    );
  }

  const result = computeAllocation(jobs, floors, meta);
  const fleet = result.fleets.find((f) => f.key === params.fleet);
  const room = fleet?.rooms?.find((r) => r.id === params.id);
  if (!fleet || !room) notFound();

  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-5 pb-24 pt-6 lg:px-8">
        <nav className="font-ui mb-6 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <Link href="/" className="transition-colors hover:text-espresso">
            Home
          </Link>
          <span>/</span>
          <Link href="/machines" className="transition-colors hover:text-espresso">
            Thread Config
          </Link>
          <span>/</span>
          <span className="text-ink-soft">
            {fleet.label} · {room.name}
          </span>
        </nav>
        <RoomView
          fleet={fleet}
          room={room}
          window={result.window}
          jobCount={result.jobCount}
          updatedAt={result.updatedAt}
          hasActiveConfig={Boolean((floors as Record<string, unknown>)[params.fleet])}
        />
      </main>
    </>
  );
}
