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
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_MIME = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  const rawName = req.headers.get("x-filename") ?? "upload.bin";
  let originalName: string;
  try { originalName = decodeURIComponent(rawName); } catch { originalName = rawName; }

  const mimeType = req.headers.get("x-mime-type") ?? req.headers.get("content-type") ?? "application/octet-stream";
  const isImage = IMAGE_MIME.includes(mimeType);
  const isVideo = VIDEO_MIME.includes(mimeType);
  if (!isImage && !isVideo) {
    return NextResponse.json({ error: `Unsupported file type: ${mimeType}` }, { status: 400 });
  }

  const duration = numOrNull(req.headers.get("x-duration"));
  const width    = intOrNull(req.headers.get("x-width"));
  const height   = intOrNull(req.headers.get("x-height"));

  // Stream body to a temp file so we can get the size, then upload to storage
  const ext     = path.extname(originalName).toLowerCase();
  const tmpName = crypto.randomBytes(8).toString("hex") + (ext || ".bin");
  const tmpPath = path.join(os.tmpdir(), tmpName);

  try {
    if (!req.body) return NextResponse.json({ error: "Empty body" }, { status: 400 });
    const nodeStream = Readable.fromWeb(req.body as unknown as import("stream/web").ReadableStream);
    await pipeline(nodeStream, createWriteStream(tmpPath));

    const stat = await fs.stat(tmpPath);
    const buf  = await fs.readFile(tmpPath);

    const storage = getStorage();
    const saved   = await storage.save(buf, originalName, mimeType, { prefix: user.id });

    const item = await prisma.mediaItem.create({
      data: {
        userId:       user.id,
        filename:     saved.filename,
        originalName,
        mimeType,
        fileSize:     BigInt(stat.size),
        filePath:     saved.key,
        kind:         isVideo ? "VIDEO" : "IMAGE",
        purpose:      "VAULT",
        duration,
        width,
        height,
      },
    });

    return NextResponse.json({ id: item.id, originalName });
  } catch (err) {
    console.error("[vault/upload]", err);
    return NextResponse.json({ error: (err as Error).message ?? "Upload failed" }, { status: 500 });
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }
}

function numOrNull(v: string | null): number | null {
  if (!v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function intOrNull(v: string | null): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
}
