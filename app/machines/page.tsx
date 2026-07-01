import Link from "next/link";
import Header from "@/components/Header";
import { getMachineJobs } from "@/lib/threadAllocationData";
import MachinesView from "@/components/MachinesView";

// Always fetch the latest jobs (cached 60s inside the reader); the allocation
// itself is recomputed in the browser as the off-color selection changes.
export const dynamic = "force-dynamic";

export default async function MachinesPage() {
  let data;
  try {
    data = await getMachineJobs();
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
          <Link href="/" className="hover:text-espresso transition-colors">
            Home
          </Link>
          <span>/</span>
          <span className="text-ink-soft">Machines</span>
        </nav>
        <MachinesView jobs={data.jobs} meta={data.meta} />
      </main>
    </>
  );
}
