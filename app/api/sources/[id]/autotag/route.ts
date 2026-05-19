import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUser, unauthorizedResponse } from "@/lib/auth";
import { autoTagMediaItem } from "@/lib/autotag";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();
  const { id } = await params;
  const item = await prisma.mediaItem.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await autoTagMediaItem(id);
  const fresh = await prisma.mediaItem.findUnique({
    where: { id },
    select: { autoTags: true, autoTagStatus: true, autoTaggedAt: true },
  });
  return NextResponse.json({
    id,
    autoTags: fresh?.autoTags ?? [],
    autoTagStatus: fresh?.autoTagStatus ?? "FAILED",
    autoTaggedAt: fresh?.autoTaggedAt?.toISOString() ?? null,
  });
}
