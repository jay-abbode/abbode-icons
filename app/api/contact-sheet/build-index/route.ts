import { NextResponse } from "next/server";
import { getIndexStatus, buildIndexBatch } from "@/lib/visualIndexBuild";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60; // allow a long-ish batch within the serverless limit

/** GET -> { captioned, total }: how many active icons already have a description. */
export async function GET() {
  try {
    return NextResponse.json(await getIndexStatus());
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** POST -> caption one batch and report progress. Client calls until done. */
export async function POST() {
  try {
    return NextResponse.json(await buildIndexBatch(30000));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("build-index failed:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
