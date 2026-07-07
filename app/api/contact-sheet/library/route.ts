import { NextResponse } from "next/server";
import { auth } from "@/auth";
import {
  listSavedSheets,
  getSavedSheet,
  saveSheet,
  deleteSheet,
  type SavedIcon,
} from "@/lib/contactSheetLibrary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/contact-sheet/library         -> { sheets: [{id,label,theme,createdAt,createdBy,count}] }
 * GET  /api/contact-sheet/library?id=xxx  -> the full saved sheet (with icons) or 404
 * POST /api/contact-sheet/library         -> save { label,theme,count,renderLogo,renderCategory,icons }
 * DELETE /api/contact-sheet/library?id=xxx
 *
 * All protected by the app middleware (signed-in users only).
 */
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  try {
    if (id) {
      const sheet = await getSavedSheet(id);
      if (!sheet) {
        return NextResponse.json({ error: "Not found." }, { status: 404 });
      }
      return NextResponse.json(sheet);
    }
    // List view: strip the (potentially large) icon arrays; keep it light.
    const sheets = (await listSavedSheets()).map((s) => ({
      id: s.id,
      label: s.label,
      theme: s.theme,
      createdAt: s.createdAt,
      createdBy: s.createdBy,
      count: s.icons.length,
    }));
    return NextResponse.json({ sheets });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Library GET failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let body: {
    label?: unknown;
    theme?: unknown;
    count?: unknown;
    renderLogo?: unknown;
    renderCategory?: unknown;
    icons?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  // Sanitize the icon list; cap length defensively.
  const icons: SavedIcon[] = Array.isArray(body.icons)
    ? body.icons
        .filter((i): i is Record<string, unknown> => !!i && typeof i === "object")
        .map((i) => ({
          slug: String(i.slug ?? ""),
          name: String(i.name ?? ""),
          pngFileId: String(i.pngFileId ?? ""),
        }))
        .filter((i) => i.slug && i.pngFileId)
        .slice(0, 60)
    : [];

  if (icons.length === 0) {
    return NextResponse.json(
      { error: "Nothing to save — generate a sheet first." },
      { status: 400 }
    );
  }

  const theme = typeof body.theme === "string" ? body.theme.trim() : "";
  const label = typeof body.label === "string" && body.label.trim() ? body.label.trim() : theme;

  try {
    const session = await auth();
    const createdBy = session?.user?.email || "unknown";
    const saved = await saveSheet({
      label,
      theme,
      count: icons.length,
      renderLogo: body.renderLogo !== false,
      renderCategory: body.renderCategory !== false,
      icons,
      createdBy,
    });
    return NextResponse.json(saved);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Library POST failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id." }, { status: 400 });
  }
  try {
    await deleteSheet(id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Library DELETE failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
