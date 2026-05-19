import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUser, unauthorizedResponse } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  const where = { userId: user.id, purpose: "VAULT" as const };

  const [
    totalItems,
    images,
    videos,
    pending,
    processing,
    done,
    failed,
    skipped,
    storageAgg,
    recent,
    tagged,
  ] = await Promise.all([
    prisma.mediaItem.count({ where }),
    prisma.mediaItem.count({ where: { ...where, kind: "IMAGE" } }),
    prisma.mediaItem.count({ where: { ...where, kind: "VIDEO" } }),
    prisma.mediaItem.count({ where: { ...where, autoTagStatus: "PENDING" } }),
    prisma.mediaItem.count({ where: { ...where, autoTagStatus: "PROCESSING" } }),
    prisma.mediaItem.count({ where: { ...where, autoTagStatus: "DONE" } }),
    prisma.mediaItem.count({ where: { ...where, autoTagStatus: "FAILED" } }),
    prisma.mediaItem.count({ where: { ...where, autoTagStatus: "SKIPPED" } }),
    prisma.mediaItem.aggregate({ where, _sum: { fileSize: true } }),
    prisma.mediaItem.findMany({
      where,
      orderBy: { uploadedAt: "desc" },
      take: 10,
    }),
    prisma.mediaItem.findMany({
      where: { ...where, autoTagStatus: "DONE" },
      select: { autoTags: true },
    }),
  ]);

  const tagFreq = new Map<string, number>();
  for (const row of tagged) {
    for (const t of row.autoTags) tagFreq.set(t, (tagFreq.get(t) ?? 0) + 1);
  }
  const topTags = [...tagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id, count]) => ({ id, count }));

  return NextResponse.json({
    totalItems,
    images,
    videos,
    totalBytes: Number(storageAgg._sum.fileSize ?? 0n),
    autoTag: { pending, processing, done, failed, skipped },
    topTags,
    recent: recent.map((item) => ({
      id: item.id,
      originalName: item.originalName,
      kind: item.kind,
      uploadedAt: item.uploadedAt.toISOString(),
      autoTags: item.autoTags.slice(0, 3),
      autoTagStatus: item.autoTagStatus,
      thumbnailUrl:
        item.kind === "VIDEO"
          ? `/api/media/${item.id}?variant=thumb`
          : `/api/media/${item.id}`,
    })),
  });
}
