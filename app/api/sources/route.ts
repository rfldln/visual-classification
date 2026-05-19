import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUser, unauthorizedResponse } from "@/lib/auth";
import type { Prisma, MediaKind, AutoTagStatus } from "@prisma/client";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  const url = new URL(req.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get("limit") ?? "24", 10)));
  const kind = url.searchParams.get("kind") as MediaKind | null;
  const autoTagStatus = url.searchParams.get("autoTagStatus") as AutoTagStatus | null;

  const where: Prisma.MediaItemWhereInput = { userId: user.id, purpose: "VAULT" };
  if (kind) where.kind = kind;
  if (autoTagStatus) where.autoTagStatus = autoTagStatus;

  const [total, items] = await Promise.all([
    prisma.mediaItem.count({ where }),
    prisma.mediaItem.findMany({
      where,
      orderBy: { uploadedAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  return NextResponse.json({
    items: items.map((item) => ({
      id: item.id,
      originalName: item.originalName,
      kind: item.kind,
      duration: item.duration,
      fileSize: item.fileSize.toString(),
      autoTags: item.autoTags,
      autoTagStatus: item.autoTagStatus,
      autoTaggedAt: item.autoTaggedAt?.toISOString() ?? null,
      thumbnailUrl:
        item.kind === "VIDEO"
          ? `/api/media/${item.id}?variant=thumb`
          : `/api/media/${item.id}`,
      mediaUrl: `/api/media/${item.id}`,
      uploadedAt: item.uploadedAt.toISOString(),
    })),
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  });
}
