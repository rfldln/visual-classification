import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    { error: "ML inference is not available in this deployment. Use the Grok Test page instead." },
    { status: 503 },
  );
}
