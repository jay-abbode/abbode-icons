/**
 * POST /api/category-export
 *
 * Turns the edited suggested-category list from /reports/icons/compare into a
 * branded PDF with the actual icon images. The client posts its current list
 * (including brand-keeps, swaps, and reorders) plus the remaining cuts; this
 * route pulls each icon's PNG from Drive, normalizes it to a small thumbnail
 * with sharp, and lays everything out via lib/categoryPdf.
 *
 * Image references are accepted ONLY as /api/image/<driveFileId> URLs — the
 * fileId is extracted and fetched through the Drive client, never an arbitrary
 * URL. Icons without an image fall back to thread swatches.
 *
 * Auth-gated, not cached.
 */

import { NextResponse } from "next/server";
import sharp from "sharp";
import { auth } from "@/auth";
import { getDriveClient } from "@/lib/google";
import { buildCategoryPdf, type CategoryPdfItem } from "@/lib/categoryPdf";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_ITEMS = 150;
const THUMB_PX = 96;
const FILE_ID_RE = /^\/api\/image\/([A-Za-z0-9_-]{10,})$/;

type WireItem = {
  icon?: unknown;
  category?: unknown;
  count?: unknown;
  rank?: unknown;
  tag?: unknown;
  hexes?: unknown;
  img?: unknown;
  sitePos?: unknown;
};

function cleanItem(w: WireItem): (CategoryPdfItem & { fileId?: string }) | null {
  const icon = typeof w.icon === "string" ? w.icon.trim().slice(0, 120) : "";
  if (!icon) return null;
  const hexes = Array.isArray(w.hexes)
    ? w.hexes.filter((h): h is string => typeof h === "string" && /^#[0-9A-Fa-f]{6}$/.test(h)).slice(0, 4)
    : [];
  const fileId = typeof w.img === "string" ? FILE_ID_RE.exec(w.img)?.[1] : undefined;
  return {
    icon,
    category: typeof w.category === "string" ? w.category.slice(0, 80) : "",
    count: typeof w.count === "number" && Number.isFinite(w.count) ? Math.max(0, Math.floor(w.count)) : 0,
    rank: typeof w.rank === "number" && Number.isFinite(w.rank) ? Math.max(0, Math.floor(w.rank)) : 0,
    tag: typeof w.tag === "string" ? w.tag.slice(0, 20) : undefined,
    sitePos:
      typeof w.sitePos === "number" && Number.isFinite(w.sitePos) ? Math.max(0, Math.floor(w.sitePos)) : undefined,
    hexes,
    fileId,
  };
}

/** Drive PNG -> small normalized PNG thumbnail, or undefined on any failure. */
async function fetchThumb(fileId: string): Promise<Uint8Array | undefined> {
  try {
    const drive = getDriveClient();
    const res = await drive.files.get(
      { fileId, alt: "media", supportsAllDrives: true },
      { responseType: "arraybuffer" }
    );
    const raw = Buffer.from(res.data as ArrayBuffer);
    const thumb = await sharp(raw)
      .resize(THUMB_PX, THUMB_PX, { fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();
    return new Uint8Array(thumb);
  } catch {
    return undefined;
  }
}

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  try {
    const body = (await request.json()) as {
      title?: unknown;
      months?: unknown;
      top?: unknown;
      edits?: unknown;
      updatedAt?: unknown;
      items?: unknown;
      cuts?: unknown;
    };

    const title = typeof body.title === "string" && body.title.trim() ? body.title.trim().slice(0, 80) : "Most Popular";
    const months = body.months === 6 ? 6 : body.months === 12 ? 12 : 3;
    const top =
      typeof body.top === "number" && Number.isFinite(body.top) ? Math.min(150, Math.max(1, Math.floor(body.top))) : 30;
    const edits = (Array.isArray(body.edits) ? body.edits : [])
      .filter((e): e is string => typeof e === "string" && e.trim().length > 0)
      .map((e) => e.trim().slice(0, 240))
      .slice(0, 100);
    const updatedAt = typeof body.updatedAt === "string" ? body.updatedAt.slice(0, 40) : null;

    const items = (Array.isArray(body.items) ? body.items : [])
      .map((w) => cleanItem(w as WireItem))
      .filter((i): i is NonNullable<typeof i> => i !== null)
      .slice(0, MAX_ITEMS);
    const cuts = (Array.isArray(body.cuts) ? body.cuts : [])
      .map((w) => cleanItem(w as WireItem))
      .filter((i): i is NonNullable<typeof i> => i !== null)
      .slice(0, MAX_ITEMS);

    if (items.length === 0) {
      return new NextResponse("Empty list", { status: 400 });
    }

    // Fetch every distinct image once, a few at a time.
    const fileIds = [...new Set([...items, ...cuts].map((i) => i.fileId).filter((f): f is string => Boolean(f)))];
    const thumbs = new Map<string, Uint8Array>();
    const CONCURRENCY = 5;
    for (let i = 0; i < fileIds.length; i += CONCURRENCY) {
      const batch = fileIds.slice(i, i + CONCURRENCY);
      const fetched = await Promise.all(batch.map((id) => fetchThumb(id)));
      batch.forEach((id, k) => {
        const bytes = fetched[k];
        if (bytes) thumbs.set(id, bytes);
      });
    }
    for (const item of [...items, ...cuts]) {
      if (item.fileId) item.imageBytes = thumbs.get(item.fileId);
    }

    const bytes = await buildCategoryPdf({
      categoryTitle: title,
      windowLabel: months === 3 ? "Rolling 3 months (90 days)" : `Rolling ${months} months`,
      top,
      items,
      cuts,
      edits,
      updatedAt,
    });

    const today = new Date().toISOString().slice(0, 10);
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "category";
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="abbode-suggested-category-${slug}-${today}.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Category PDF generation failed:", msg);
    return new NextResponse("PDF generation failed", { status: 500 });
  }
}
