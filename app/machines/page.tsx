import Link from "next/link";
import Header from "@/components/Header";
import MachinesView from "@/components/MachinesView";
import { getMachinesPageData } from "@/lib/threadAllocationData";
import { listConfigs } from "@/lib/machineConfigs";

// Always fetch the latest jobs and the saved floor (both cached briefly inside
// their readers); the allocation itself recomputes in the browser as the floor
// changes.
export const dynamic = "force-dynamic";

export default async function MachinesPage() {
  let data;
  let configs;
  try {
    data = await getMachinesPageData();
    configs = await listConfigs().catch(() => []);
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

  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-5 pb-24 pt-6 lg:px-8">
        <nav className="font-ui mb-6 flex items-center gap-2 text-xs text-ink-muted">
          <Link href="/" className="transition-colors hover:text-espresso">
            Home
          </Link>
          <span>/</span>
          <span className="text-ink-soft">Thread Config</span>
          <Link
            href="/machines/routing"
            className="ml-auto font-medium text-ink-soft transition-colors hover:text-espresso"
          >
            Order Routing →
          </Link>
        </nav>
        <MachinesView jobs={data.jobs} meta={data.meta} floors={data.floors} configs={configs} />
      </main>
    </>
  );
}
