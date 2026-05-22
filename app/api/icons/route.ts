import { NextResponse } from "next/server";
import { getIconCatalog } from "@/lib/sheets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const forceRefresh = url.searchParams.get("refresh") === "1";

  try {
    const catalog = await getIconCatalog({ forceRefresh });
    return NextResponse.json(catalog);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Failed to load icon catalog:", error);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
