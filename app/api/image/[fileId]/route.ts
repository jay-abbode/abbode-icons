import { NextRequest, NextResponse } from "next/server";
import { getDriveClient } from "@/lib/google";
import { recolorPng, recolorPngTwoRegion, type RGB } from "@/lib/recolor";
import { getThreadBySlot } from "@/lib/threadPalette";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a Drive PNG to the browser, optionally recolored.
 *
 *   GET /api/image/<fileId>
 *     → original file as stored on Drive
 *
 *   GET /api/image/<fileId>?slot=20
 *     → single-color recolor to Madeira slot 20 (Navy)
 *
 *   GET /api/image/<fileId>?base=29&accent=30&anchor=178,152,112
 *     → two-region recolor (multi-color designs); base/accent are Madeira
 *       slot numbers, anchor is the source-image base-region RGB used to
 *       disambiguate which cluster is base vs accent.
 *
 * An in-memory cache holds raw Drive bytes for ~5 minutes so a variations
 * page request doesn't hit Drive 24 times in a row. The recolored output
 * itself is served with aggressive HTTP cache headers, so the CDN keeps
 * each (fileId, params) combo cached after first generation.
 */

type RawCacheEntry = { buffer: Buffer; mimeType: string; expiresAt: number };

// One shared cache per server instance. On Vercel each function instance
// keeps this in memory for a few minutes — long enough to amortize the
// 24-slot variations page.
const RAW_CACHE_TTL_MS = 5 * 60 * 1000;
const RAW_CACHE_MAX_ENTRIES = 100;
const rawCache = new Map<string, RawCacheEntry>();

async function fetchRawPng(fileId: string): Promise<RawCacheEntry> {
  const cached = rawCache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const drive = getDriveClient();
  const [metaResp, contentResp] = await Promise.all([
    drive.files.get({ fileId, fields: "mimeType,name" }),
    drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    ),
  ]);

  const entry: RawCacheEntry = {
    buffer: Buffer.from(contentResp.data as ArrayBuffer),
    mimeType: metaResp.data.mimeType || "application/octet-stream",
    expiresAt: Date.now() + RAW_CACHE_TTL_MS,
  };

  // Rough LRU: if the map is full, drop the oldest entry (Map preserves
  // insertion order, so the first key is the oldest).
  if (rawCache.size >= RAW_CACHE_MAX_ENTRIES) {
    const oldestKey = rawCache.keys().next().value;
    if (oldestKey !== undefined) rawCache.delete(oldestKey);
  }
  rawCache.set(fileId, entry);

  return entry;
}

export async function GET(
  request: NextRequest,
  { params }: { params: { fileId: string } }
) {
  const { fileId } = params;

  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    return new NextResponse("Invalid file id", { status: 400 });
  }

  const searchParams = request.nextUrl.searchParams;
  const slotParam = searchParams.get("slot");
  const baseParam = searchParams.get("base");
  const accentParam = searchParams.get("accent");
  const anchorParam = searchParams.get("anchor");

  // Mode resolution. If base+accent supplied, two-region recolor. Else if
  // slot supplied, single-color recolor. Else pass through unchanged.
  let mode: "raw" | "single" | "two" = "raw";
  let targetRgb: RGB | null = null;
  let targetBase: RGB | null = null;
  let targetAccent: RGB | null = null;
  let anchorRgb: RGB = [180, 40, 50]; // sensible default; overridden below

  if (baseParam !== null && accentParam !== null && baseParam !== "" && accentParam !== "") {
    const baseSlot = Number.parseInt(baseParam, 10);
    const accentSlot = Number.parseInt(accentParam, 10);
    if (!Number.isFinite(baseSlot) || !Number.isFinite(accentSlot)) {
      return new NextResponse("Invalid base/accent slot", { status: 400 });
    }
    const baseThread = getThreadBySlot(baseSlot);
    const accentThread = getThreadBySlot(accentSlot);
    if (!baseThread || !accentThread) {
      return new NextResponse(
        `Unknown thread slot (base=${baseSlot}, accent=${accentSlot})`,
        { status: 400 },
      );
    }
    targetBase = baseThread.rgb;
    targetAccent = accentThread.rgb;
    if (anchorParam) {
      const parts = anchorParam
        .split(",")
        .map((s) => Number.parseInt(s.trim(), 10));
      if (parts.length === 3 && parts.every((n) => Number.isFinite(n) && n >= 0 && n <= 255)) {
        anchorRgb = [parts[0], parts[1], parts[2]] as RGB;
      }
    }
    mode = "two";
  } else if (slotParam !== null && slotParam !== "") {
    const slot = Number.parseInt(slotParam, 10);
    if (!Number.isFinite(slot)) {
      return new NextResponse("Invalid slot", { status: 400 });
    }
    const thread = getThreadBySlot(slot);
    if (!thread) {
      return new NextResponse(`Unknown thread slot ${slot}`, { status: 400 });
    }
    targetRgb = thread.rgb;
    mode = "single";
  }

  try {
    const raw = await fetchRawPng(fileId);

    if (mode === "raw") {
      return new NextResponse(new Uint8Array(raw.buffer), {
        headers: {
          "Content-Type": raw.mimeType,
          "Cache-Control": "public, max-age=3600, s-maxage=86400, immutable",
        },
      });
    }

    const recolored =
      mode === "single"
        ? await recolorPng(raw.buffer, targetRgb as RGB)
        : await recolorPngTwoRegion(
            raw.buffer,
            targetBase as RGB,
            targetAccent as RGB,
            anchorRgb,
          );

    return new NextResponse(new Uint8Array(recolored), {
      headers: {
        "Content-Type": "image/png",
        // Recolored output is deterministic for (fileId, params) — safe to
        // cache for a year. Browsers redownload only if the URL changes.
        "Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      `Image route failed for ${fileId} mode=${mode} ` +
        `slot=${slotParam} base=${baseParam} accent=${accentParam}:`,
      message,
    );
    return new NextResponse("File not found or inaccessible", { status: 404 });
  }
}
