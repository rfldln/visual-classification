import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getUser, unauthorizedResponse } from "@/lib/auth";
import { CATEGORY_IDS } from "@/lib/taxonomy";

export const runtime = "nodejs";

async function ownedSample(id: string, userId: string) {
  return prisma.datasetSample.findFirst({ where: { id, userId } });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();
  const { id } = await params;
  const sample = await ownedSample(id, user.id);
  if (!sample) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    id: sample.id,
    caption: sample.caption,
    tags: sample.tags,
    sourceName: sample.sourceName,
    sourceTimeSec: sample.sourceTimeSec,
    fileSize: sample.fileSize.toString(),
    width: sample.width,
    height: sample.height,
    createdAt: sample.createdAt.toISOString(),
    imageUrl: `/api/dataset/${sample.id}/image`,
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();
  const { id } = await params;
  const owned = await ownedSample(id, user.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json()) as { caption?: unknown; tags?: unknown };
  const data: { caption?: string; tags?: string[] } = {};

  if (body.caption !== undefined) {
    if (typeof body.caption !== "string") {
      return NextResponse.json({ error: "caption must be a string" }, { status: 400 });
    }
    data.caption = body.caption;
  }
  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || !body.tags.every((t) => typeof t === "string")) {
      return NextResponse.json({ error: "tags must be a string array" }, { status: 400 });
    }
    const validIds = new Set<string>(CATEGORY_IDS);
    data.tags = (body.tags as string[]).filter((t) => validIds.has(t));
  }

  const updated = await prisma.datasetSample.update({
    where: { id },
    data,
    select: { id: true, caption: true, tags: true },
  });
  return NextResponse.json(updated);
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();
  const { id } = await params;
  const sample = await ownedSample(id, user.id);
  if (!sample) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.datasetSample.delete({ where: { id } });

  const storage = getStorage();
  if (sample.filePath) await storage.delete(sample.filePath).catch(() => undefined);

  return NextResponse.json({ success: true });
}
