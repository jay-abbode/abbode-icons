import Link from "next/link";
import { auth, signOut } from "@/auth";
import { getCommentCounts } from "@/lib/comments";
import { getColorStats, type ColorStat } from "@/lib/colorStats";
import { getOrderStats, type OrderStatsSnapshot } from "@/lib/orderStats";
import SearchBar from "./SearchBar";
import ColorDataMenu from "./ColorDataMenu";
import LiveOrderDataMenu from "./LiveOrderDataMenu";
import ReportsMenu from "./ReportsMenu";
import FiltersMenu from "./FiltersMenu";

/**
 * Wrapper around `getColorStats` that swallows sheet-fetch errors so the
 * header still renders if the catalog is briefly unavailable — we just show
 * an empty Color Data dropdown rather than tanking the whole page.
 */
async function loadColorStats(): Promise<ColorStat[]> {
  try {
    return await getColorStats();
  } catch {
    return [];
  }
}

/** Same resilience for order stats — empty dropdown beats a broken header. */
async function loadOrderStats(): Promise<OrderStatsSnapshot> {
  try {
    return await getOrderStats();
  } catch {
    return { stats: [], totalOrders: 0, window: "", updatedAt: null };
  }
}

export default async function Header({
  initialQuery = "",
  showSearch = true,
}: {
  initialQuery?: string;
  showSearch?: boolean;
}) {
  const session = await auth();
  const user = session?.user;
  // Only load stats if the user is signed in — anonymous /login views don't
  // need them, and loadColorStats() hits the Sheets API.
  const colorStats: ColorStat[] = user ? await loadColorStats() : [];
  const orderStats: OrderStatsSnapshot = user
    ? await loadOrderStats()
    : { stats: [], totalOrders: 0, window: "", updatedAt: null };
  // Same gating for comment counts. Cached for 60s, so this is cheap on
  // repeat page loads.
  let commentTotal = 0;
  if (user) {
    try {
      const { total } = await getCommentCounts();
      commentTotal = total;
    } catch {
      commentTotal = 0;
    }
  }

  return (
    <header className="sticky top-0 z-30 border-b border-parchment bg-porcelain/85 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-5 px-6 py-4 lg:px-10">
        <Link
          href="/"
          aria-label="Abbode Icons — home"
          className="group flex cursor-pointer items-end gap-2.5 rounded-md focus-ring"
        >
          <AbbodeLogo className="h-7 w-auto text-sage transition-colors duration-200 group-hover:text-olive md:h-8" />
          <span className="font-display text-[28px] leading-none text-plum transition-colors duration-200 group-hover:text-cherry md:text-[32px]">
            Icons
          </span>
        </Link>

        {showSearch && (
          <div className="hidden flex-1 max-w-md items-center gap-2 md:flex">
            <div className="flex-1">
              <SearchBar initialQuery={initialQuery} compact />
            </div>
            <FiltersMenu />
          </div>
        )}

        <nav className="ml-auto flex items-center gap-4 text-sm font-medium text-ink-soft">
          {/* Primary navigation — collapses first on narrower screens. */}
          <div className="hidden items-center gap-5 lg:flex">
            <Link
              href="/"
              className="hover:text-espresso transition-colors focus-ring"
            >
              Categories
            </Link>
            <Link
              href="/browse"
              className="hover:text-espresso transition-colors focus-ring"
            >
              All icons
            </Link>
            <Link
              href="/assets"
              className="hover:text-espresso transition-colors focus-ring"
            >
              Downloads
            </Link>
            <Link
              href="/comments"
              className="inline-flex items-center gap-1.5 hover:text-espresso transition-colors focus-ring"
            >
              Notes
              {commentTotal > 0 && <CountBadge value={commentTotal} />}
            </Link>
          </div>

          {user && (
            <>
              {/* Divider between the primary links and the analytics tools. */}
              <span
                aria-hidden="true"
                className="hidden h-5 w-px bg-parchment lg:block"
              />

              {/* Analytics cluster — the matching set of data controls. */}
              <div className="hidden items-center gap-2 md:flex">
                <ColorDataMenu stats={colorStats} />
                <LiveOrderDataMenu snapshot={orderStats} />
                <ReportsMenu />
              </div>

              <UserMenu name={user.name} email={user.email} image={user.image} />
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

function UserMenu({
  name,
  email,
  image,
}: {
  name?: string | null;
  email?: string | null;
  image?: string | null;
}) {
  const initial = (name || email || "?").trim().charAt(0).toUpperCase();

  return (
    <div className="group relative">
      <button
        type="button"
        aria-label={`Account menu for ${name || email}`}
        className="font-ui flex h-9 w-9 items-center justify-center overflow-hidden rounded-full border border-parchment bg-white text-xs font-semibold text-cherry transition-shadow hover:shadow-md focus-ring"
      >
        {image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={image} alt="" className="h-full w-full object-cover" />
        ) : (
          initial
        )}
      </button>

      <div className="invisible absolute right-0 top-full z-20 mt-2 w-64 rounded-xl border border-parchment bg-white p-3 opacity-0 shadow-lg transition-all duration-150 group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">
        <div className="border-b border-parchment pb-3">
          <p className="truncate text-sm font-semibold text-espresso">
            {name || "Account"}
          </p>
          <p className="font-ui mt-0.5 truncate text-xs text-ink-muted">
            {email}
          </p>
        </div>
        <form
          action={async () => {
            "use server";
            await signOut({ redirectTo: "/login" });
          }}
        >
          <button
            type="submit"
            className="font-ui mt-2 w-full rounded-md px-2 py-2 text-left text-sm text-ink-soft hover:bg-pink-soft hover:text-cherry"
          >
            Sign out
          </button>
        </form>
      </div>
    </div>
  );
}

/**
 * Abbode wordmark, inlined as SVG so we can recolor it via `currentColor`.
 * Sizing is controlled with Tailwind `h-*` classes; width auto-scales.
 */
function AbbodeLogo({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1428.87 582.48"
      fill="currentColor"
      className={className}
      aria-hidden="true"
    >
      <path d="M846.51,287.39c-61.5,0-111.21,66-111.21,147.45s49.75,147.55,111.21,147.55,111.21-66.05,111.21-147.55-49.85-147.45-111.21-147.45ZM846.83,544.95l2.14.08c-.72,0-1.43-.03-2.14-.08ZM846.6,544.93c-35.99-2.74-47.4-67.72-47.4-112.96,0-56.81,11.39-110.23,47.31-110.23,33.23,0,42.98,44.41,42.98,110.23s-13.16,110.8-42.89,112.96Z" />
      <path d="M214.55,524.28c-7.47-1.21-9.56-5.29-11.93-10.72-2.04-5.62-1.16-11.37-1.16-22.28v-95.84c0-36.34-2.97-63.4-21.49-81.04-18.19-18.05-40.24-27.01-70.64-27.01l-.05-.05c-61.4,0-93.75,50.64-87.3,79.04,5.62,20,22.23,25.53,37.69,22.97,31.84-5.34,20.47-37.97,20.66-45.25.7-23.44,33.27-28.4,44.18-15.64,7.15,8.31,8.68,28.73,8.68,39.27v5.66c0,5.89-1.53,9.7-4.18,13.09-25.06,31.61-88.37,24.18-115.75,69.85-18.7,33.37-14.85,61.59-5.34,79.78,15.32,29.19,41.12,46.23,65.58,46.23,22.79,0,49.52-5.11,68.04-35.74,10.72,27.38,22.37,31.65,50.59,31.65,31.56.19,31.56,2.04,31.56-20.38v-23.76c0-5.57-3.02-8.86-9.14-9.84ZM71.46,525.05c-16.94-42.89,13.32-81.9,61.87-93.46v32.03c0,4.96.19,15.11,0,21.24l.19,21.49c-1.21,44.05-48.83,47.11-62.05,18.7Z" />
      <path d="M133.33,484.88s0-.01,0-.01v-.03s0,.05,0,.05Z" />
      <path d="M1202.04,541.92h.05c-3.02-2.83-5.38-6.08-7.33-9.98-1.49-4.27-2.37-9.24-2.37-15.18V10.16c0-5.62-4.59-10.16-10.16-10.16h-71.8c-5.94,0-8.86,2.41-8.86,7.01v14.25c0,4.46,2.37,7.66,7.29,10.03,10.72,4.97,16.15,14.81,16.15,29.43v238.75c-13.04-7.75-27.48-12.02-42.65-12.02-59.55,0-107.86,66-107.86,147.45s48.22,147.55,107.86,147.55c20.14,0,35.55-14.11,42.79-22.23v7.05c0,6.13,4.97,11.09,11.09,11.09h63.45c3.85,0,7.01-3.16,7.01-7.01v-16.66c0-5.94-1.53-10.16-4.64-12.76ZM1124.85,494c0,11.93-3.3,23.72-9.98,33.61-6.71,9.93-16.42,17.66-28.63,17.37v.05c-12.16-.23-22.28-8.77-27.66-19.22-14.06-27.11-13.41-67.44-12.86-97.19.37-20.42.88-40.98,5.01-60.99,2.78-14.11,11.09-37.97,26.73-44,5.52-2.04,14.06-3.53,24.13,1.16,14.25,6.64,19.73,23.49,22.46,37.5h0c.52,2.78.79,5.61.79,8.44v123.26Z" />
      <path d="M1423.81,369.32c-9-33.53-33.47-63.81-66.35-76.27-9.77-3.7-20.17-5.66-30.62-5.66-35.37,0-67.62,22.37-87.86,57.09-14.67,25.02-23.39,56.35-23.39,90.41,0,43.44,14.2,82.52,36.67,109.53,19.77,23.58,45.95,38.01,74.59,38.01,2.27,0,4.5-.14,6.73-.32.42,0,.93-.14,1.35-.14,29.89-2.83,56.58-21.4,75.24-49.57,7.1-10.77,12.07-22.93,14.3-35.65.05-.51.19-.97.23-1.53.7-3.76-2.41-7.19-6.31-7.19-10.81.19-38.89.7-48.92.88-3.11.19-3.9,1.72-4.46,4.78-2.67,14.7-8.53,32.92-18.81,44.09-10.55,11.46-26.99,7.73-36.4-3.02-8.5-9.71-12.08-23.2-14.3-35.61-3.21-17.93-3.45-36.22-3.45-54.38l71.62-.32,55.32-.23c6.5,0,8.68-3.9,9.14-10.03.32-4.27.56-8.49.7-12.58v-3.85s.96-26.26-5-48.44ZM1292.22,406.76s-.05-.05-.05-.05c1.02-19.98,3.11-40.82,9.45-59.92,1.29-3.89,2.7-7.82,4.7-11.42,3.95-7.14,11.39-12.97,19.71-13.58,11.07-.82,19.62,6.06,23.92,15.8,4.4,9.97,6.15,21.51,7.55,32.25,1.45,11.09,2.21,22.29,2.36,33.47,0,.28.03,3.44.02,3.44h-67.67Z" />
      <path d="M610.69,287.48v-.09c-15.13,0-29.43,4.27-42.47,11.88V10.16c0-5.62-4.59-10.16-10.16-10.16h-71.8c-5.94,0-8.86,2.41-8.86,7.01v14.25c0,4.46,2.37,7.66,7.29,10.03,10.72,4.97,16.15,14.81,16.15,29.43v133.9h-.19v322.2c0,5.94-.88,10.91-2.37,15.18-1.9,3.9-4.27,7.1-7.29,9.98-3.11,2.6-4.64,6.82-4.64,12.76v16.66c0,3.85,3.16,7.01,7.01,7.01h63.45c6.13,0,11.09-4.97,11.09-11.09v-7.05c7.24,8.12,22.65,22.23,42.79,22.23,59.55,0,107.86-66.05,107.86-147.55s-48.22-147.45-107.86-147.45ZM634.54,525.86v-.05c-5.38,10.4-15.55,18.94-27.66,19.22-21.72.51-35.55-24.32-38.62-41.77v-130.37c0-3.51.22-7.02.78-10.49,0-.02,0-.03,0-.05,2.74-14.06,8.17-30.91,22.46-37.5,10.07-4.69,18.61-3.2,24.13-1.16,15.69,6.08,24.04,29.89,26.73,44,4.13,20,4.64,40.57,5.01,60.99.56,29.8,1.16,70.08-12.86,97.19Z" />
      <path d="M368.92,287.48v-.09c-15.08,0-29.43,4.27-42.47,11.88V10.16c0-5.62-4.59-10.16-10.16-10.16h-71.8c-5.94,0-8.86,2.41-8.86,7.01v14.25c0,4.46,2.37,7.66,7.29,10.03,10.72,4.97,16.15,14.81,16.15,29.43v133.9h-.19v322.2c0,5.94-.88,10.91-2.37,15.18-1.9,3.9-4.27,7.1-7.29,9.98-3.11,2.6-4.64,6.82-4.64,12.76v16.66c0,3.85,3.16,7.01,7.01,7.01h63.45c6.13,0,11.09-4.97,11.09-11.09v-7.05c7.24,8.12,22.65,22.23,42.79,22.23,59.55,0,107.86-66.05,107.86-147.55s-48.22-147.45-107.86-147.45ZM392.82,525.86v-.05c-5.38,10.4-15.55,18.94-27.66,19.22-21.72.51-35.55-24.32-38.62-41.77v-130.37c0-3.51.22-7.02.78-10.49,0-.02,0-.03,0-.05,2.74-14.06,8.17-30.91,22.46-37.5,10.07-4.69,18.66-3.2,24.13-1.16,15.64,6.08,24.04,29.89,26.73,44,4.13,20,4.64,40.57,5.01,60.99.56,29.8,1.16,70.08-12.86,97.19Z" />
    </svg>
  );
}

/**
 * Small numeric pill used in the header next to "Notes" and on icon grid
 * cards when an icon has comments. Single digits render as a circle; 2+
 * digits expand to a pill. 99+ caps the display.
 */
export function CountBadge({
  value,
  tone = "cherry",
}: {
  value: number;
  tone?: "cherry" | "berry";
}) {
  const bg = tone === "berry" ? "bg-berry" : "bg-cherry";
  const label = value > 99 ? "99+" : String(value);
  return (
    <span
      aria-label={`${value} ${value === 1 ? "note" : "notes"}`}
      className={`font-ui inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none text-porcelain tabular-nums ${bg}`}
    >
      {label}
    </span>
  );
}
