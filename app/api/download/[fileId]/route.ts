import { NextRequest, NextResponse } from "next/server";
import { getDriveClient } from "@/lib/google";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams a file from Google Drive to the browser as a download.
 * Browser will save the file under the `filename` query parameter
 * (so the user sees "Apple LARGE.ofm" rather than "1aBcDe...").
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { fileId: string } }
) {
  const { fileId } = params;

  if (!fileId || !/^[a-zA-Z0-9_-]+$/.test(fileId)) {
    return new NextResponse("Invalid file id", { status: 400 });
  }

  const url = new URL(request.url);
  const requestedName = url.searchParams.get("filename") || "download";

  // Sanitize filename: strip any path separators or control chars
  const safeName = requestedName.replace(/[\\/\0\r\n]/g, "_").slice(0, 200);

  try {
    const drive = getDriveClient();

    const [metaResp, contentResp] = await Promise.all([
      drive.files.get({ fileId, fields: "mimeType" }),
      drive.files.get(
        { fileId, alt: "media" },
        { responseType: "arraybuffer" }
      ),
    ]);

    const buffer = Buffer.from(contentResp.data as ArrayBuffer);
    const mimeType =
      metaResp.data.mimeType || "application/octet-stream";

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(safeName)}`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Download failed for ${fileId}:`, message);
    return new NextResponse("File not found or inaccessible", { status: 404 });
  }
}
