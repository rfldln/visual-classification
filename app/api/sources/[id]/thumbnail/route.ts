import { NextResponse } from "next/server";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { createWriteStream, promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getUser, unauthorizedResponse } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  const { id } = await params;
  const item = await prisma.mediaItem.findFirst({
    where: { id, userId: user.id },
    select: { id: true, thumbPath: true },
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const tmpPath = path.join(os.tmpdir(), crypto.randomBytes(8).toString("hex") + ".jpg");
  try {
    if (!req.body) return NextResponse.json({ error: "Empty body" }, { status: 400 });
    const nodeStream = Readable.fromWeb(req.body as unknown as import("stream/web").ReadableStream);
    await pipeline(nodeStream, createWriteStream(tmpPath));

    const buf     = await fs.readFile(tmpPath);
    const storage = getStorage();

    // Delete old thumbnail if one exists
    if (item.thumbPath) await storage.delete(item.thumbPath).catch(() => undefined);

    const saved = await storage.save(buf, "thumb.jpg", "image/jpeg", { prefix: `${user.id}/thumbs` });

    await prisma.mediaItem.update({
      where: { id },
      data: { thumbPath: saved.key },
    });

    return NextResponse.json({ thumbPath: saved.key });
  } catch (err) {
    console.error("[sources/thumbnail]", err);
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}
