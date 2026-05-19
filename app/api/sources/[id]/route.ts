import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getUser, unauthorizedResponse } from "@/lib/auth";

export const runtime = "nodejs";

async function ownedItem(id: string, userId: string) {
  return prisma.mediaItem.findFirst({ where: { id, userId } });
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();
  const { id } = await params;
  const source = await ownedItem(id, user.id);
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    id: source.id,
    originalName: source.originalName,
    kind: source.kind,
    duration: source.duration,
    fileSize: source.fileSize.toString(),
    autoTags: source.autoTags,
    autoTagStatus: source.autoTagStatus,
    autoTaggedAt: source.autoTaggedAt?.toISOString() ?? null,
    thumbnailUrl:
      source.kind === "VIDEO"
        ? `/api/media/${source.id}?variant=thumb`
        : `/api/media/${source.id}`,
    mediaUrl: `/api/media/${source.id}`,
    uploadedAt: source.uploadedAt.toISOString(),
  });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();
  const { id } = await params;
  const owned = await ownedItem(id, user.id);
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const body = (await req.json()) as { autoTags?: unknown; autoTagStatus?: unknown };
  if (!Array.isArray(body.autoTags) || !body.autoTags.every((t) => typeof t === "string")) {
    return NextResponse.json({ error: "autoTags must be a string array" }, { status: 400 });
  }
  const validStatuses = ["PENDING", "PROCESSING", "DONE", "FAILED", "SKIPPED"];
  const status = typeof body.autoTagStatus === "string" && validStatuses.includes(body.autoTagStatus)
    ? body.autoTagStatus as "PENDING" | "PROCESSING" | "DONE" | "FAILED" | "SKIPPED"
    : undefined;
  const updated = await prisma.mediaItem.update({
    where: { id },
    data: {
      autoTags: body.autoTags as string[],
      ...(status ? { autoTagStatus: status, autoTaggedAt: status === "DONE" ? new Date() : undefined } : {}),
    },
    select: { id: true, autoTags: true, autoTagStatus: true },
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
  const source = await ownedItem(id, user.id);
  if (!source) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await prisma.mediaItem.delete({ where: { id } });

  const storage = getStorage();
  if (source.filePath) await storage.delete(source.filePath).catch(() => undefined);
  if (source.thumbPath) await storage.delete(source.thumbPath).catch(() => undefined);

  return NextResponse.json({ success: true });
}
