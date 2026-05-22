import { NextRequest, NextResponse } from "next/server";
import { getDriveClient } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a file from Google Drive to the browser for inline display.
 * Used for PNG previews in the grid and detail modal.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: { fileId: string } }
) {
  const { fileId } = params;

  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    return new NextResponse("Invalid file id", { status: 400 });
  }

  try {
    const drive = getDriveClient();

    // Fetch metadata + content in parallel
    const [metaResp, contentResp] = await Promise.all([
      drive.files.get({ fileId, fields: "mimeType,name" }),
      drive.files.get(
        { fileId, alt: "media" },
        { responseType: "arraybuffer" }
      ),
    ]);

    const buffer = Buffer.from(contentResp.data as ArrayBuffer);
    const mimeType = metaResp.data.mimeType || "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mimeType,
        // Cache aggressively in the browser; PNGs in the catalog rarely change
        "Cache-Control": "public, max-age=3600, s-maxage=86400, immutable",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Image fetch failed for ${fileId}:`, message);
    return new NextResponse("File not found or inaccessible", { status: 404 });
  }
}
