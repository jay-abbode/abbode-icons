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
  let body: { theme?: unknown; count?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const theme = typeof body.theme === "string" ? body.theme : "";
  const count = normalizeCount(body.count);

  if (!theme.trim()) {
    return NextResponse.json({ error: "Please enter a theme." }, { status: 400 });
  }

  try {
    const selection = await selectIconsForTheme(theme, count);
    return NextResponse.json(selection);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Contact-sheet match failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
