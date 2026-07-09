import { NextResponse } from "next/server";
import { selectIconsForTheme, normalizeCount } from "@/lib/contactSheet";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/contact-sheet/match
 * Body: { theme: string, count: number }
 * Returns: { theme, requested, icons: [{slug,name,category,pngFileId}], note }
 *
 * Protected by the app's middleware, so only signed-in users reach it.
 */
export async function POST(request: Request) {
  let body: {
    theme?: unknown;
    count?: unknown;
    maxPerIcon?: unknown;
    maxPerSheet?: unknown;
    palette?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const theme = typeof body.theme === "string" ? body.theme : "";
  const count = normalizeCount(body.count);
  const toCap = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : null;
  const maxPerIcon = toCap(body.maxPerIcon);
  const maxPerSheet = toCap(body.maxPerSheet);
  const palette = Array.isArray(body.palette)
    ? body.palette
        .map((v) => (typeof v === "number" ? Math.floor(v) : NaN))
        .filter((n) => Number.isInteger(n))
    : [];

  if (!theme.trim()) {
    return NextResponse.json({ error: "Please enter a theme." }, { status: 400 });
  }

  try {
    const selection = await selectIconsForTheme(theme, count, {
      maxPerIcon,
      maxPerSheet,
      palette,
    });
    return NextResponse.json(selection);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Contact-sheet match failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
