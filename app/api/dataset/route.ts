import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUser, unauthorizedResponse } from "@/lib/auth";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "24", 10)));
  const tag = url.searchParams.get("tag");
  const sourceName = url.searchParams.get("sourceName");

  const where: Prisma.DatasetSampleWhereInput = { userId: user.id };
  if (tag) where.tags = { has: tag };
  if (sourceName) where.sourceName = sourceName;

  const [total, items, sources] = await Promise.all([
    prisma.datasetSample.count({ where }),
    prisma.datasetSample.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.datasetSample.findMany({
      where: { userId: user.id, sourceName: { not: null } },
      distinct: ["sourceName"],
      select: { sourceName: true },
      orderBy: { sourceName: "asc" },
    }),
  ]);

  return NextResponse.json({
    items: items.map((it) => ({
      id: it.id,
      caption: it.caption,
      tags: it.tags,
      sourceName: it.sourceName,
      sourceTimeSec: it.sourceTimeSec,
      fileSize: it.fileSize.toString(),
      width: it.width,
      height: it.height,
      createdAt: it.createdAt.toISOString(),
      imageUrl: `/api/dataset/${it.id}/image`,
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    sources: sources.map((s) => s.sourceName).filter((n): n is string => !!n),
  });
}
