import { NextResponse } from "next/server";
import path from "path";
import crypto from "crypto";
import { promises as fs, createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { prisma } from "@/lib/db";
import { extractFramesByInterval, probeMedia } from "@/lib/frames";

export const runtime = "nodejs";
export const maxDuration = 600;
export const dynamic = "force-dynamic";

const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_MIME = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];
const FRAME_INTERVAL_SEC = 10;
const FRAME_WIDTH = 512;

const UPLOAD_ROOT = path.resolve(process.env.LOCAL_UPLOAD_PATH ?? "./public/uploads");
const TMP_DIR = path.join(UPLOAD_ROOT, ".tmp");
/** When set, delete the original video file after frames are successfully extracted. */
const DELETE_ORIGINAL = process.env.DELETE_ORIGINAL_AFTER_EXTRACT === "1";

/** Allow only safe identifiers — prevents path traversal via x-upload-id. */
function safeId(id: string | null): string | null {
  if (!id) return null;
  return /^[a-zA-Z0-9_-]{8,128}$/.test(id) ? id : null;
}

interface SavedFile {
  name: string;
  mimeType: string;
  key: string;
  size: number;
}

async function processSavedFile(file: SavedFile) {
  const isImage = IMAGE_MIME.includes(file.mimeType);
  const isVideo = VIDEO_MIME.includes(file.mimeType);
  if (!isImage && !isVideo) {
    await fs.rm(path.join(UPLOAD_ROOT, file.key), { force: true }).catch(() => undefined);
    return { id: "", filename: file.name, kind: "IMAGE" as const, frameCount: 0, warning: "rejected" };
  }

  const absSource = path.join(UPLOAD_ROOT, file.key);
  const probed = await probeMedia(absSource);

  const item = await prisma.mediaItem.create({
    data: {
      filename: file.key,
      originalName: file.name,
      mimeType: file.mimeType,
      fileSize: BigInt(file.size),
      filePath: file.key,
      kind: isVideo ? "VIDEO" : "IMAGE",
      duration: probed.duration,
      width: probed.width,
      height: probed.height,
    },
  });

  let frameCount = 0;
  let warning: string | undefined;

  if (isImage) {
    await prisma.frame.create({
      data: {
        mediaItemId: item.id,
        frameIndex: 0,
        timeSec: 0,
        filePath: file.key,
        width: probed.width,
        height: probed.height,
      },
    });
    frameCount = 1;
  } else {
    const outRel = path.posix.join("frames", item.id);
    const outAbs = path.join(UPLOAD_ROOT, outRel);
    try {
      const frames = await extractFramesByInterval(absSource, outAbs, FRAME_INTERVAL_SEC, {
        width: FRAME_WIDTH,
      });
      if (frames.length === 0) throw new Error("no frames produced");
      await prisma.frame.createMany({
        data: frames.map((f) => ({
          mediaItemId: item.id,
          frameIndex: f.index,
          timeSec: f.timestampSec,
          filePath: path.posix.join(outRel, path.basename(f.path)),
          width: probed.width,
          height: probed.height,
        })),
      });
      frameCount = frames.length;

      // Frame extraction succeeded — original video is no longer needed for
      // labeling/export. Delete it to reclaim disk space when opted in.
      if (DELETE_ORIGINAL) {
        await fs.rm(absSource, { force: true }).catch((e) => {
          console.warn(`[upload] could not delete original ${absSource}:`, e);
        });
        console.log(`[upload] deleted original video to save space: ${file.key}`);
      }
    } catch (err) {
      warning = "frame-extraction-failed";
      console.error(`Frame extraction failed for ${file.name}:`, err);
      await fs.rm(outAbs, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  return {
    id: item.id,
    filename: item.filename,
    kind: item.kind as "IMAGE" | "VIDEO",
    frameCount,
    ...(warning ? { warning } : {}),
  };
}

/**
 * Append a single chunk of a file upload to a temp file. When the last chunk
 * arrives, finalize: rename to the canonical upload key and run probe + frame
 * extraction.
 *
 * Required request headers:
 *   x-upload-id     opaque session id (client-generated, [a-zA-Z0-9_-]{8,128})
 *   x-chunk-index   0-based chunk number
 *   x-total-chunks  total number of chunks
 *   x-filename      URI-encoded original filename
 *   x-mime-type     reported MIME type
 *   x-total-size    expected final byte count
 *
 * Body: raw chunk bytes. Client must POST chunks SEQUENTIALLY (we append).
 */
export async function POST(req: Request) {
  try {
    const uploadId = safeId(req.headers.get("x-upload-id"));
    const chunkIndex = parseInt(req.headers.get("x-chunk-index") ?? "", 10);
    const totalChunks = parseInt(req.headers.get("x-total-chunks") ?? "", 10);
    const totalSize = parseInt(req.headers.get("x-total-size") ?? "", 10);
    const rawName = req.headers.get("x-filename") ?? "upload.bin";
    const mimeType = req.headers.get("x-mime-type") ?? "application/octet-stream";

    if (!uploadId) return NextResponse.json({ error: "Bad x-upload-id" }, { status: 400 });
    if (!Number.isFinite(chunkIndex) || chunkIndex < 0)
      return NextResponse.json({ error: "Bad x-chunk-index" }, { status: 400 });
    if (!Number.isFinite(totalChunks) || totalChunks < 1)
      return NextResponse.json({ error: "Bad x-total-chunks" }, { status: 400 });
    if (!req.body) return NextResponse.json({ error: "Empty body" }, { status: 400 });

    let name = rawName;
    try { name = decodeURIComponent(rawName); } catch { /* keep raw */ }

    await fs.mkdir(TMP_DIR, { recursive: true });
    const tmpPath = path.join(TMP_DIR, `${uploadId}.part`);

    if (chunkIndex === 0) {
      // Fresh start: discard any prior partial for this id (e.g. retry).
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
    }

    const nodeStream = Readable.fromWeb(req.body as unknown as import("stream/web").ReadableStream);
    const out = createWriteStream(tmpPath, { flags: "a" });
    await pipeline(nodeStream, out);

    const isLast = chunkIndex === totalChunks - 1;
    if (!isLast) {
      return NextResponse.json({ ok: true, received: chunkIndex });
    }

    // ── Finalize ──────────────────────────────────────────────────────
    const stat = await fs.stat(tmpPath);
    if (Number.isFinite(totalSize) && totalSize > 0 && stat.size !== totalSize) {
      await fs.rm(tmpPath, { force: true }).catch(() => undefined);
      return NextResponse.json(
        { error: `Size mismatch: got ${stat.size}, expected ${totalSize}` },
        { status: 400 },
      );
    }

    const ext = path.extname(name).toLowerCase();
    const safeName = crypto.randomBytes(12).toString("hex") + ext;
    const finalPath = path.join(UPLOAD_ROOT, safeName);
    await fs.rename(tmpPath, finalPath);

    console.log(
      `[upload] finalized "${name}" (${(stat.size / 1e9).toFixed(2)} GB) -> ${safeName}`,
    );

    const result = await processSavedFile({
      name,
      mimeType,
      key: safeName,
      size: stat.size,
    });
    return NextResponse.json({ uploaded: [result] });
  } catch (err) {
    console.error("Chunk upload failed:", err);
    return NextResponse.json(
      { error: (err as Error).message || "Chunk upload failed" },
      { status: 500 },
    );
  }
}
