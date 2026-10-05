/**
 * Client-side ZIP download of Drive files, shared by any surface that needs to
 * hand the user a single archive (the contact sheet's "icon files" export).
 *
 * Mirrors the flow the /assets downloader uses: each task is a Drive file
 * served through /api/download/<fileId> (the real filename comes back in the
 * X-Filename header), files are pulled through a bounded-concurrency pool so
 * memory stays flat, and the whole archive is assembled with client-zip before
 * the browser is handed ONE finished file — nothing downloads until it's done.
 *
 * Client-only: uses fetch, Blob, and the DOM to trigger the save.
 */
import { downloadZip } from "client-zip";

/** One Drive file to fetch, placed under `dir/` in the archive. */
export type ZipTask = { url: string; dir: string };

type Entry = { name: string; input: Uint8Array };

const CONCURRENCY = 6;

async function fetchOne(task: ZipTask): Promise<Entry | null> {
  const res = await fetch(task.url);
  if (!res.ok) return null; // missing / inaccessible file: skip, count as error
  const input = new Uint8Array(await res.arrayBuffer());
  const enc = res.headers.get("X-Filename");
  const driveName = enc ? decodeURIComponent(enc) : "download";
  return { name: `${task.dir}/${driveName}`, input };
}

/**
 * Yields entries in completion order through a pool of ~CONCURRENCY fetches.
 * Order inside the zip doesn't matter — the folder paths do the organizing.
 */
async function* runTasks(
  tasks: ZipTask[],
  onTick: (done: number, errors: number) => void
): AsyncGenerator<Entry> {
  let next = 0;
  let done = 0;
  let errors = 0;
  const inflight = new Map<number, Promise<{ slot: number; entry: Entry | null }>>();
  const launch = () => {
    while (inflight.size < CONCURRENCY && next < tasks.length) {
      const slot = next++;
      const task = tasks[slot];
      inflight.set(
        slot,
        (async () => {
          try {
            return { slot, entry: await fetchOne(task) };
          } catch {
            return { slot, entry: null };
          }
        })()
      );
    }
  };
  launch();
  while (inflight.size > 0) {
    const { slot, entry } = await Promise.race(inflight.values());
    inflight.delete(slot);
    done++;
    if (!entry) errors++;
    onTick(done, errors);
    launch();
    if (entry) yield entry;
  }
}

/**
 * Fetch every task, assemble the archive, and trigger a browser save of
 * `fileName`. Resolves with the number of files that failed to fetch.
 */
export async function downloadTasksAsZip(
  tasks: ZipTask[],
  fileName: string,
  onProgress?: (done: number, errors: number) => void
): Promise<number> {
  let errorCount = 0;
  const blob = await downloadZip(
    runTasks(tasks, (done, errors) => {
      errorCount = errors;
      onProgress?.(done, errors);
    })
  ).blob();

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke after a delay so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return errorCount;
}
