import { NextResponse } from "next/server";
import { promises as fs, createWriteStream } from "fs";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import path from "path";
import os from "os";
import crypto from "crypto";
import { predictImageBuffer, predictVideoFile } from "@/lib/predict";
import { isPyTorchBackend, predictFileWithPyTorch } from "@/lib/predict-pytorch";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"];
const VIDEO_MIME = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];

/** Stream request body directly to a temp file without buffering in memory. */
async function streamBodyToTemp(req: Request, ext: string): Promise<string> {
  const safeName = crypto.randomBytes(8).toString("hex") + ext;
  const tmp = path.join(os.tmpdir(), safeName);
  if (!req.body) throw new Error("Empty request body");
  const nodeStream = Readable.fromWeb(req.body as unknown as import("stream/web").ReadableStream);
  await pipeline(nodeStream, createWriteStream(tmp));
  return tmp;
}

export async function POST(req: Request) {
  try {
    const ct = req.headers.get("content-type") ?? "";
    const url = new URL(req.url);

    let fileName: string;
    let mime: string;
    let k: number;
    let frameInterval: number | null;
    let numFrames: number;
    let tmpPath: string | null = null;

    if (ct.includes("multipart/form-data")) {
      // Legacy FormData path (small files / curl).
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return NextResponse.json({ error: "No file uploaded (field name: 'file')" }, { status: 400 });
      }
      fileName = file.name || "upload";
      mime = file.type || "";
      k = Math.max(1, Math.min(10, Number(form.get("topK")) || 3));
      frameInterval = Number(form.get("frameInterval")) || 5;
      numFrames = Math.max(4, Number(form.get("numFrames")) || 120);
      const ext = path.extname(fileName).toLowerCase();
      const buf = Buffer.from(await file.arrayBuffer());
      tmpPath = path.join(os.tmpdir(), crypto.randomBytes(8).toString("hex") + ext);
      await fs.writeFile(tmpPath, buf);
    } else {
      // Streaming path: body is raw bytes, metadata in headers + query string.
      // Bypasses Next.js's FormData body-size limit for large videos.
      const rawName = req.headers.get("x-filename") ?? "upload.bin";
      try { fileName = decodeURIComponent(rawName); } catch { fileName = rawName; }
      mime = req.headers.get("x-mime-type") ?? ct;
      k = Math.max(1, Math.min(10, Number(url.searchParams.get("topK")) || 3));
      frameInterval = Number(url.searchParams.get("frameInterval")) || 5;
      numFrames = Math.max(4, Number(url.searchParams.get("numFrames")) || 120);
      const ext = path.extname(fileName).toLowerCase();
      tmpPath = await streamBodyToTemp(req, ext || ".bin");
    }

    try {
      const ext = path.extname(fileName).toLowerCase();
      const isImage = IMAGE_MIME.includes(mime) || [".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"].includes(ext);
      const isVideo = VIDEO_MIME.includes(mime) || [".mp4", ".mov", ".webm", ".mkv"].includes(ext);
      const usePyTorch = isPyTorchBackend();

      if (isImage) {
        if (usePyTorch) {
          const result = await predictFileWithPyTorch(tmpPath, "image", k);
          return NextResponse.json({ kind: "image", filename: fileName, predictions: result.predictions });
        }
        const buf = await fs.readFile(tmpPath);
        const preds = await predictImageBuffer(buf, k);
        return NextResponse.json({ kind: "image", filename: fileName, predictions: preds });
      }

      if (isVideo) {
        if (usePyTorch) {
          const result = await predictFileWithPyTorch(tmpPath, "video", k, numFrames, frameInterval ?? undefined);
          return NextResponse.json({
            kind: "video",
            filename: fileName,
            frames: result.frames ?? numFrames,
            predictions: result.predictions,
          });
        }
        const preds = await predictVideoFile(tmpPath, k, numFrames);
        return NextResponse.json({ kind: "video", filename: fileName, frames: numFrames, predictions: preds });
      }

      return NextResponse.json({ error: `Unsupported file type: ${mime || ext}` }, { status: 400 });
    } finally {
      if (tmpPath) await fs.unlink(tmpPath).catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("ENOENT") && msg.includes(".onnx")) {
      return NextResponse.json({
        error: "Model not found. Place <arch>_best.onnx and classes.json in ./models/ at the project root.",
      }, { status: 503 });
    }
    if (msg.includes(".pt") || msg.includes("Missing Python package")) {
      return NextResponse.json({ error: msg }, { status: 503 });
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
