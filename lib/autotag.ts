import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { tagWithGrok } from "@/lib/grok-call";

function bufferToDataUrl(buf: Buffer, mime: string): string {
  return `data:${mime};base64,${buf.toString("base64")}`;
}

async function readStorageAsBuffer(key: string): Promise<Buffer> {
  const storage = getStorage();
  const { stream } = await storage.read(key);
  const chunks: Buffer[] = [];
  for await (const c of stream) {
    chunks.push(typeof c === "string" ? Buffer.from(c) : Buffer.from(c));
  }
  return Buffer.concat(chunks);
}

export async function autoTagMediaItem(mediaItemId: string): Promise<void> {
  const item = await prisma.mediaItem.findUnique({ where: { id: mediaItemId } });
  if (!item) return;

  if (!process.env.OPENROUTER_API_KEY) {
    await prisma.mediaItem.update({
      where: { id: mediaItemId },
      data: { autoTagStatus: "SKIPPED" },
    });
    return;
  }

  await prisma.mediaItem.update({
    where: { id: mediaItemId },
    data: { autoTagStatus: "PROCESSING" },
  });

  try {
    // For images we tag the original file. For videos we tag the client-provided
    // thumbnail (if any) — server-side ffmpeg isn't available on Vercel Hobby.
    const isVideo = item.kind === "VIDEO";
    const key = isVideo ? (item.thumbPath ?? item.filePath) : item.filePath;
    if (!key) {
      await prisma.mediaItem.update({
        where: { id: mediaItemId },
        data: { autoTagStatus: "SKIPPED" },
      });
      return;
    }
    const buf = await readStorageAsBuffer(key);
    const mime = isVideo ? "image/jpeg" : (item.mimeType || "image/jpeg");
    const dataUrl = bufferToDataUrl(buf, mime);

    const userText = isVideo
      ? "Tag this video (single representative frame). JSON only."
      : "Tag this image. JSON only.";

    const out = await tagWithGrok({ imageDataUrls: [dataUrl], userText });
    if (!out.ok) {
      console.error(`[autotag] grok call failed for ${mediaItemId}:`, out.error);
      await prisma.mediaItem.update({
        where: { id: mediaItemId },
        data: { autoTagStatus: "FAILED" },
      });
      return;
    }

    const tags = out.result.tags.map((t) => t.id);
    await prisma.mediaItem.update({
      where: { id: mediaItemId },
      data: { autoTags: tags, autoTagStatus: "DONE", autoTaggedAt: new Date() },
    });
  } catch (err) {
    console.error(`[autotag] failed for ${mediaItemId}:`, err);
    await prisma.mediaItem.update({
      where: { id: mediaItemId },
      data: { autoTagStatus: "FAILED" },
    });
  }
}
