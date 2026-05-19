import { NextResponse } from "next/server";
import path from "path";
import crypto from "crypto";
import { promises as fs, createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { extractFramesByInterval, probeMedia } from "@/lib/frames";

export const runtime = "nodejs";
// Allow long-running uploads + ffmpeg extraction for big videos.
export const maxDuration = 600;
export const dynamic = "force-dynamic";

const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_MIME = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];

/** Seconds between extracted frames. Change here if you want to re-tune for new uploads. */
const FRAME_INTERVAL_SEC = 10;
/** Target width (px) for extracted frames. Originals may be downscaled below this. */
const FRAME_WIDTH = 512;

// Resolve the local uploads root the same way storage.ts does, so we can pass
// absolute paths to ffmpeg and store relative keys in the DB.
const UPLOAD_ROOT = path.resolve(process.env.LOCAL_UPLOAD_PATH ?? "./public/uploads");
/** When set, delete the original video file after frames are successfully extracted. */
const DELETE_ORIGINAL = process.env.DELETE_ORIGINAL_AFTER_EXTRACT === "1";

interface IncomingFile {
  /** Original client-supplied filename. */
  name: string;
  /** Reported MIME type. */
  mimeType: string;
  /** Bytes already on disk; relative path under UPLOAD_ROOT. */
  key: string;
  /** Bytes written. */
  size: number;
}

/**
 * Stream the raw request body to disk without buffering it all in memory.
 * Used by the streaming upload path (Content-Type: application/octet-stream).
 */
async function streamBodyToDisk(req: Request): Promise<IncomingFile> {
  const rawName = req.headers.get("x-filename") ?? "upload.bin";
  // Client URI-encodes the filename so non-ASCII / spaces survive HTTP headers.
  let name = rawName;
  try { name = decodeURIComponent(rawName); } catch { /* keep raw */ }
  const mimeType = req.headers.get("x-mime-type") ?? req.headers.get("content-type") ?? "application/octet-stream";
  const ext = path.extname(name).toLowerCase();
  const safeName = crypto.randomBytes(12).toString("hex") + ext;

  await fs.mkdir(UPLOAD_ROOT, { recursive: true });
  const absPath = path.join(UPLOAD_ROOT, safeName);

  if (!req.body) throw new Error("Empty request body");
  const declared = req.headers.get("content-length");
  const declaredBytes = declared ? parseInt(declared, 10) : 0;
  console.log(
    `[upload] receiving "${name}" (${(declaredBytes / 1e9).toFixed(2)} GB) -> ${safeName}`,
  );
  const t0 = Date.now();

  const nodeStream = Readable.fromWeb(req.body as unknown as import("stream/web").ReadableStream);
  const out = createWriteStream(absPath);
  await pipeline(nodeStream, out);

  const stat = await fs.stat(absPath);
  const seconds = (Date.now() - t0) / 1000;
  console.log(
    `[upload] received "${name}" (${(stat.size / 1e9).toFixed(2)} GB) in ${seconds.toFixed(1)}s ` +
    `(${(stat.size / 1e6 / seconds).toFixed(1)} MB/s)`,
  );
  return { name, mimeType, key: safeName, size: stat.size };
}

/**
 * Process a file already saved to disk: probe, extract frames, write DB rows.
 * Shared by both the streaming and multipart paths.
 */
async function processSavedFile(file: IncomingFile) {
  const isImage = IMAGE_MIME.includes(file.mimeType);
  const isVideo = VIDEO_MIME.includes(file.mimeType);
  if (!isImage && !isVideo) {
    // Drop the orphan file we just wrote.
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

export async function POST(req: Request) {
  const ct = req.headers.get("content-type") ?? "";

  // ── Streaming path: one file per request, body is the raw bytes. ──
  // This avoids Next's formData() body-size limit and keeps memory flat
  // for multi-GB videos.
  if (!ct.includes("multipart/form-data")) {
    try {
      const saved = await streamBodyToDisk(req);
      const result = await processSavedFile(saved);
      return NextResponse.json({ uploaded: [result] });
    } catch (err) {
      console.error("Stream upload failed:", err);
      return NextResponse.json(
        { error: (err as Error).message || "Upload failed" },
        { status: 500 },
      );
    }
  }

  // ── Multipart fallback (curl, small images, legacy clients). ──
  const form = await req.formData();
  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    const single = form.get("file");
    if (single instanceof File) files.push(single);
  }
  if (files.length === 0) return NextResponse.json({ error: "No files" }, { status: 400 });

  const storage = getStorage();
  const results: Array<{
    id: string;
    filename: string;
    kind: "IMAGE" | "VIDEO";
    frameCount: number;
    warning?: string;
  }> = [];

  for (const file of files) {
    const mimeType = file.type || "application/octet-stream";
    const isImage = IMAGE_MIME.includes(mimeType);
    const isVideo = VIDEO_MIME.includes(mimeType);
    if (!isImage && !isVideo) {
      results.push({ id: "", filename: file.name, kind: "IMAGE", frameCount: 0, warning: "rejected" });
      continue;
    }

    const buf = Buffer.from(await file.arrayBuffer());
    const saved = await storage.save(buf, file.name, mimeType);
    const absSource = path.join(UPLOAD_ROOT, saved.key);
    const probed = await probeMedia(absSource);

    const item = await prisma.mediaItem.create({
      data: {
        filename: saved.filename,
        originalName: file.name,
        mimeType,
        fileSize: BigInt(saved.size),
        filePath: saved.key,
        kind: isVideo ? "VIDEO" : "IMAGE",
        duration: probed.duration,
        width: probed.width,
        height: probed.height,
      },
    });

    let frameCount = 0;
    let warning: string | undefined;

    if (isImage) {
      // One Frame per image, pointing directly at the source file.
      await prisma.frame.create({
        data: {
          mediaItemId: item.id,
          frameIndex: 0,
          timeSec: 0,
          filePath: saved.key,
          width: probed.width,
          height: probed.height,
        },
      });
      frameCount = 1;
    } else {
      // Video: extract frames into public/uploads/frames/<mediaItemId>/ and create a Frame row each.
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
      } catch (err) {
        warning = "frame-extraction-failed";
        console.error(`Frame extraction failed for ${file.name}:`, err);
        // Clean partial dir
        await fs.rm(outAbs, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    results.push({
      id: item.id,
      filename: item.filename,
      kind: item.kind,
      frameCount,
      ...(warning ? { warning } : {}),
    });
  }

  return NextResponse.json({ uploaded: results });
}
