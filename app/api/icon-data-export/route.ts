/**
 * /api/icon-data-export
 *
 * PDF of the "Icon Data" report, now window- and top-N-aware:
 *
 *   ?months=3|6|12   rolling window (default 12)
 *   ?top=30          only the top N icons (default: the whole list)
 *
 * No params = the original behavior (full 12-month list), so the header
 * dropdown's Export button keeps working unchanged. Data comes from
 * lib/iconWindows (ICON_WINDOWS tab, with an ORDER_STATS+THREAD_STATS
 * fallback); an unavailable window falls back to the nearest available one and
 * the PDF's subtitle always states the window actually used.
 *
 * Auth-gated, not cached.
 */

import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getIconWindows, sortForWindow, type WindowMonths } from "@/lib/iconWindows";
import { buildIconDataPdf } from "@/lib/iconDataPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseMonths(v: string | null): WindowMonths {
  return v === "3" ? 3 : v === "6" ? 6 : 12;
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  try {
    const url = new URL(request.url);
    const wanted = parseMonths(url.searchParams.get("months"));
    const topRaw = parseInt(url.searchParams.get("top") || "0", 10);

    const snap = await getIconWindows();
    // Clamp to a window that actually has data (fallback mode has no 6-month).
    const months: WindowMonths = snap.available.includes(wanted)
      ? wanted
      : snap.available.includes(12)
        ? 12
        : (snap.available[0] ?? 12);

    const ranked = sortForWindow(snap.stats, months).filter((s) => s.counts[months] > 0);
    const top = topRaw > 0 ? Math.min(topRaw, ranked.length) : ranked.length;
    const rows = ranked.slice(0, top).map((s) => ({
      icon: s.icon,
      category: s.category,
      count: s.counts[months],
      hexes: s.hexes,
    }));

    const bytes = await buildIconDataPdf({
      rows,
      windowLabel: `Rolling ${months} months`,
      scopeLabel:
        top < ranked.length
          ? `Top ${top} of ${ranked.length.toLocaleString()} icons`
          : `${ranked.length.toLocaleString()} icons`,
      totalOrders: snap.totals[months],
      updatedAt: snap.updatedAt,
    });

    const today = new Date().toISOString().slice(0, 10);
    const name = `abbode-icon-order-frequency-${months}mo${top < ranked.length ? `-top${top}` : ""}-${today}.pdf`;
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Icon Data PDF generation failed:", msg);
    return new NextResponse("PDF generation failed", { status: 500 });
  }
}
