import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getUser, unauthorizedResponse } from "@/lib/auth";
import { autoTagMediaItem } from "@/lib/autotag";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const VIDEO_MIME = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ error: "Missing 'file'" }, { status: 400 });
    }
    const originalName = (form.get("originalName") as string) || file.name || "upload.bin";
    const mimeType = file.type || (form.get("mimeType") as string) || "application/octet-stream";
    const isImage = IMAGE_MIME.includes(mimeType);
    const isVideo = VIDEO_MIME.includes(mimeType);
    if (!isImage && !isVideo) {
      return NextResponse.json({ error: `Unsupported file type: ${mimeType}` }, { status: 400 });
    }

    const duration = numOrNull(form.get("duration"));
    const width = intOrNull(form.get("width"));
    const height = intOrNull(form.get("height"));

    const storage = getStorage();
    const buf = Buffer.from(await file.arrayBuffer());
    const saved = await storage.save(buf, originalName, mimeType, { prefix: user.id });

    let thumbKey: string | null = null;
    const thumb = form.get("thumbnail");
    if (thumb instanceof File && thumb.size > 0) {
      const thumbBuf = Buffer.from(await thumb.arrayBuffer());
      const savedThumb = await storage.save(thumbBuf, "thumb.jpg", "image/jpeg", { prefix: `${user.id}/thumbs` });
      thumbKey = savedThumb.key;
    }

    const item = await prisma.mediaItem.create({
      data: {
        userId: user.id,
        filename: saved.filename,
        originalName,
        mimeType,
        fileSize: BigInt(buf.length),
        filePath: saved.key,
        thumbPath: thumbKey,
        kind: isVideo ? "VIDEO" : "IMAGE",
        purpose: "VAULT",
        duration,
        width,
        height,
      },
    });

    // Await so the tag is ready before the client refreshes the list.
    // On Vercel Hobby this typically fits within the 10s budget.
    await autoTagMediaItem(item.id).catch((err) => {
      console.error("[vault/upload] autotag error:", err);
    });

    return NextResponse.json({ id: item.id, originalName, autoTagStatus: "DONE" });
  } catch (err) {
    console.error("[vault/upload]", err);
    return NextResponse.json({ error: (err as Error).message ?? "Upload failed" }, { status: 500 });
  }
}

function numOrNull(v: FormDataEntryValue | null): number | null {
  if (typeof v !== "string" || !v) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function intOrNull(v: FormDataEntryValue | null): number | null {
  const n = numOrNull(v);
  return n === null ? null : Math.round(n);
}
