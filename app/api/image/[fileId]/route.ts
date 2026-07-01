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

type RawCacheEntry = { buffer: Buffer; mimeType: string; version: string; expiresAt: number };

// One shared cache per server instance. Kept short so that a re-uploaded file
// (e.g. a freshly cropped PNG, which keeps the same Drive ID) is reflected
// within about a minute — still long enough to amortize the near-simultaneous
// 24-slot variations page, which fires all its requests in one render.
const RAW_CACHE_TTL_MS = 60 * 1000;
const RAW_CACHE_MAX_ENTRIES = 100;
const rawCache = new Map<string, RawCacheEntry>();

async function fetchRawPng(fileId: string): Promise<RawCacheEntry> {
  const cached = rawCache.get(fileId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached;
  }

  const drive = getDriveClient();
  const [metaResp, contentResp] = await Promise.all([
    drive.files.get({ fileId, fields: "mimeType,name,md5Checksum,modifiedTime" }),
    drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    ),
  ]);

  const entry: RawCacheEntry = {
    buffer: Buffer.from(contentResp.data as ArrayBuffer),
    mimeType: metaResp.data.mimeType || "application/octet-stream",
    // Content fingerprint: Drive's md5Checksum changes whenever the bytes change
    // (an auto-crop overwrites the file in place), with modifiedTime as a
    // fallback. Used as the ETag so caches refetch only when the file changed.
    version:
      metaResp.data.md5Checksum ||
      metaResp.data.modifiedTime ||
      String(Date.now()),
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

    // Tie the cache to the file's real content (+ recolor params). A re-uploaded
    // file (freshly cropped PNG, same Drive ID) gets a new md5 -> new ETag ->
    // refetch; an unchanged file keeps serving from cache. Dropping "immutable"
    // is the key change: it lets the browser/CDN re-check after the short
    // max-age instead of assuming the bytes can never change.
    const paramsKey =
      mode === "raw"
        ? ""
        : `-${mode}-${slotParam || ""}|${baseParam || ""}|${accentParam || ""}|${anchorParam || ""}`;
    const etag = `"${raw.version}${paramsKey}"`;
    const cacheControl =
      mode === "raw"
        ? "public, max-age=60, s-maxage=60, stale-while-revalidate=604800"
        : "public, max-age=300, s-maxage=3600, stale-while-revalidate=604800";

    // Conditional request: unchanged content -> 304, skipping the body (and, for
    // recolor modes, skipping the expensive re-render entirely).
    if (request.headers.get("if-none-match") === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: { ETag: etag, "Cache-Control": cacheControl },
      });
    }

    if (mode === "raw") {
      return new NextResponse(new Uint8Array(raw.buffer), {
        headers: {
          "Content-Type": raw.mimeType,
          "Cache-Control": cacheControl,
          ETag: etag,
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
        "Cache-Control": cacheControl,
        ETag: etag,
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
