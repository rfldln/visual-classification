import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import type { Prisma, ReviewStatus, MediaKind } from "@prisma/client";
import type { CategoryId } from "@/lib/taxonomy";
import type { FrameDTO } from "@/types";

export const runtime = "nodejs";

type FrameWithRelations = Prisma.FrameGetPayload<{
  include: {
    labels: true;
    mediaItem: { select: { id: true; originalName: true; kind: true; duration: true; _count: { select: { frames: true } } } };
  };
}>;

function toDTO(frame: FrameWithRelations): FrameDTO {
  return {
    id: frame.id,
    mediaItemId: frame.mediaItemId,
    frameIndex: frame.frameIndex,
    timeSec: frame.timeSec,
    width: frame.width,
    height: frame.height,
    status: frame.status,
    flagged: frame.flagged,
    flagReason: frame.flagReason,
    reviewedAt: frame.reviewedAt ? frame.reviewedAt.toISOString() : null,
    reviewerName: frame.reviewerName,
    createdAt: frame.createdAt.toISOString(),
    labels: frame.labels.map((l) => l.categoryId as CategoryId),
    url: `/api/media/${frame.id}`,
    source: {
      id: frame.mediaItem.id,
      originalName: frame.mediaItem.originalName,
      kind: frame.mediaItem.kind,
      duration: frame.mediaItem.duration,
      frameCount: frame.mediaItem._count.frames,
    },
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const status = url.searchParams.get("status") as ReviewStatus | null;
  const type = url.searchParams.get("type"); // image | video (source kind)
  const category = url.searchParams.get("category");
  const sourceId = url.searchParams.get("sourceId");
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get("limit") ?? "24", 10)));
  const sort = url.searchParams.get("sort") ?? "newest";

  const where: Prisma.FrameWhereInput = {};
  if (status) where.status = status;
  if (sourceId) where.mediaItemId = sourceId;
  if (type === "image") where.mediaItem = { kind: "IMAGE" as MediaKind };
  if (type === "video") where.mediaItem = { kind: "VIDEO" as MediaKind };
  if (category) where.labels = { some: { categoryId: category } };

  const orderBy: Prisma.FrameOrderByWithRelationInput =
    sort === "oldest" ? { createdAt: "asc" } :
    sort === "filename" ? { mediaItem: { originalName: "asc" } } :
    { createdAt: "desc" };

  const [total, frames] = await Promise.all([
    prisma.frame.count({ where }),
    prisma.frame.findMany({
      where,
      orderBy: [orderBy, { frameIndex: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      include: {
        labels: true,
        mediaItem: {
          select: {
            id: true,
            originalName: true,
            kind: true,
            duration: true,
            _count: { select: { frames: true } },
          },
        },
      },
    }),
  ]);

  return NextResponse.json({
    items: frames.map(toDTO),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}

export async function DELETE(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Expected JSON body" }, { status: 400 });
  }

  const idsValue = (body as { ids?: unknown }).ids;
  if (!Array.isArray(idsValue)) {
    return NextResponse.json({ error: "ids must be an array" }, { status: 400 });
  }

  const ids = Array.from(new Set(idsValue.filter((id): id is string => typeof id === "string" && id.length > 0)));
  if (ids.length === 0) {
    return NextResponse.json({ error: "No frame ids provided" }, { status: 400 });
  }

  // Process in chunks to avoid huge IN clauses on large bulk deletes.
  const CHUNK = 500;
  const storage = getStorage();
  let deleted = 0;

  for (let i = 0; i < ids.length; i += CHUNK) {
    const slice = ids.slice(i, i + CHUNK);
    const frames = await prisma.frame.findMany({
      where: { id: { in: slice } },
      select: { filePath: true, mediaItem: { select: { kind: true, filePath: true } } },
    });
    const result = await prisma.frame.deleteMany({ where: { id: { in: slice } } });
    deleted += result.count;
    const videoFramePaths = frames
      .filter((frame) => frame.mediaItem.kind === "VIDEO" && frame.filePath !== frame.mediaItem.filePath)
      .map((frame) => frame.filePath);
    if (videoFramePaths.length > 0) {
      await Promise.allSettled(videoFramePaths.map((filePath) => storage.delete(filePath)));
    }
  }

  return NextResponse.json({ success: true, deleted });
}
