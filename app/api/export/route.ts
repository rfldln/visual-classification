import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({ error: "Export is not available in this deployment." }, { status: 503 });
}

export async function POST() {
  return NextResponse.json({ error: "Export is not available in this deployment." }, { status: 503 });
}
