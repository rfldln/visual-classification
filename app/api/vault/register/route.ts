import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getUser, unauthorizedResponse } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Creates a MediaItem row after the browser has finished the direct
 * Supabase Storage upload. No file bytes pass through this route.
 *
 * POST body: { path, originalName, mimeType, fileSize, duration?, width?, height? }
 * Response:  { id, originalName }
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  const body = await req.json() as {
    path: string;
    originalName: string;
    mimeType: string;
    fileSize: number;
    duration?: number | null;
    width?: number | null;
    height?: number | null;
  };

  if (!body.path || !body.originalName || !body.mimeType) {
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  }

  const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  const VIDEO_MIME = ["video/mp4", "video/quicktime", "video/webm", "video/x-matroska"];
  const isImage = IMAGE_MIME.includes(body.mimeType);
  const isVideo = VIDEO_MIME.includes(body.mimeType);

  if (!isImage && !isVideo) {
    return NextResponse.json({ error: `Unsupported type: ${body.mimeType}` }, { status: 400 });
  }

  const safeName = body.path.split("/").pop() ?? body.path;

  const item = await prisma.mediaItem.create({
    data: {
      userId:       user.id,
      filename:     safeName,
      originalName: body.originalName,
      mimeType:     body.mimeType,
      fileSize:     BigInt(Math.round(body.fileSize ?? 0)),
      filePath:     body.path,
      kind:         isVideo ? "VIDEO" : "IMAGE",
      purpose:      "VAULT",
      duration:     body.duration ?? null,
      width:        body.width ?? null,
      height:       body.height ?? null,
    },
  });

  return NextResponse.json({ id: item.id, originalName: item.originalName });
}
