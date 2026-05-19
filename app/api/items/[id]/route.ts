import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import type { CategoryId } from "@/lib/taxonomy";

export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const frame = await prisma.frame.findUnique({
    where: { id },
    include: {
      labels: true,
      mediaItem: {
        select: {
          id: true, originalName: true, kind: true, duration: true, mimeType: true,
          _count: { select: { frames: true } },
        },
      },
    },
  });
  if (!frame) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Queue position among PENDING frames (by createdAt asc)
  let queuePosition = 0;
  let totalPending = 0;
  if (frame.status === "PENDING") {
    totalPending = await prisma.frame.count({ where: { status: "PENDING" } });
    queuePosition = (await prisma.frame.count({
      where: {
        status: "PENDING",
        OR: [
          { createdAt: { lt: frame.createdAt } },
          { createdAt: frame.createdAt, id: { lt: frame.id } },
        ],
      },
    })) + 1;
  }

  return NextResponse.json({
    frame: {
      id: frame.id,
      mediaItemId: frame.mediaItemId,
      frameIndex: frame.frameIndex,
      timeSec: frame.timeSec,
      width: frame.width,
      height: frame.height,
      status: frame.status,
      flagged: frame.flagged,
      flagReason: frame.flagReason,
      reviewedAt: frame.reviewedAt?.toISOString() ?? null,
      reviewerName: frame.reviewerName,
      createdAt: frame.createdAt.toISOString(),
      labels: frame.labels.map((l) => l.categoryId as CategoryId),
      url: `/api/media/${frame.id}`,
      source: {
        id: frame.mediaItem.id,
        originalName: frame.mediaItem.originalName,
        kind: frame.mediaItem.kind,
        duration: frame.mediaItem.duration,
        mimeType: frame.mediaItem.mimeType,
        frameCount: frame.mediaItem._count.frames,
      },
    },
    queuePosition,
    totalPending,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const frame = await prisma.frame.findUnique({
    where: { id },
    select: { filePath: true, mediaItem: { select: { kind: true, filePath: true } } },
  });
  if (!frame) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await prisma.frame.delete({ where: { id } });
  // Only delete the file if it's a dedicated frame JPEG (videos),
  // never the original image (which is shared by a single Frame row anyway,
  // but we delete that via the DELETE-source endpoint).
  if (frame.mediaItem.kind === "VIDEO" && frame.filePath !== frame.mediaItem.filePath) {
    try { await getStorage().delete(frame.filePath); } catch {}
  }
  return NextResponse.json({ success: true });
}
