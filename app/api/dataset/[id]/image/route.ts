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

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  const { id } = await params;
  const sample = await prisma.datasetSample.findFirst({
    where: { id, userId: user.id },
    select: { filePath: true },
  });
  if (!sample) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const storage = getStorage();

  if (storage.signedUrl) {
    try {
      const signed = await storage.signedUrl(sample.filePath, 300);
      return NextResponse.redirect(signed, { status: 302 });
    } catch (err) {
      console.error("[dataset/image] signed URL failed, falling through to stream:", err);
    }
  }

  const { stream, size } = await storage.read(sample.filePath);
  return new NextResponse(toWebStream(stream), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(size),
      "Cache-Control": "private, max-age=0, no-cache",
    },
  });
}
