import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getUser, unauthorizedResponse } from "@/lib/auth";
import type { Readable } from "stream";

export const runtime = "nodejs";

function toWebStream(node: NodeJS.ReadableStream): ReadableStream<Uint8Array> {
  const nodeStream = node as Readable;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on("data", (chunk: Buffer) => controller.enqueue(new Uint8Array(chunk)));
      nodeStream.on("end", () => controller.close());
      nodeStream.on("error", (err) => controller.error(err));
    },
    cancel() {
      nodeStream.destroy?.();
    },
  });
}

/**
 * Serves a file owned by the authenticated user. `[id]` is a MediaItem id.
 * `?variant=thumb` returns the stored thumbnail (videos); otherwise the original.
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  const { id } = await params;
  const url = new URL(req.url);
  const variant = url.searchParams.get("variant");

  const item = await prisma.mediaItem.findFirst({
    where: { id, userId: user.id },
    select: { filePath: true, thumbPath: true, mimeType: true, kind: true },
  });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const wantThumb = variant === "thumb" && !!item.thumbPath;
  const key = wantThumb ? item.thumbPath! : item.filePath;
  const contentType = wantThumb
    ? "image/jpeg"
    : (item.kind === "VIDEO" ? item.mimeType || "video/mp4" : item.mimeType || "application/octet-stream");

  const storage = getStorage();

  // Prefer a signed URL redirect when the adapter supports it (Supabase).
  if (storage.signedUrl) {
    try {
      const signed = await storage.signedUrl(key, 300);
      return NextResponse.redirect(signed, { status: 302 });
    } catch (err) {
      console.error("[media] signed URL failed, falling through to stream:", err);
    }
  }

  const { size } = await storage.stat(key);
  const range = req.headers.get("range");
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    if (!m) return NextResponse.json({ error: "Bad Range" }, { status: 416 });
    const start = m[1] ? parseInt(m[1], 10) : 0;
    const end = m[2] ? parseInt(m[2], 10) : size - 1;
    if (start >= size || end >= size) {
      return new NextResponse(null, {
        status: 416,
        headers: { "Content-Range": `bytes */${size}` },
      });
    }
    const stream = await storage.readRange(key, start, end);
    return new NextResponse(toWebStream(stream), {
      status: 206,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(end - start + 1),
        "Content-Range": `bytes ${start}-${end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=0, no-cache",
      },
    });
  }

  const { stream } = await storage.read(key);
  return new NextResponse(toWebStream(stream), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=0, no-cache",
    },
  });
}
