import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  return NextResponse.json(
    { error: "This upload endpoint is not active. Use /api/vault/upload instead." },
    { status: 503 },
  );
}
