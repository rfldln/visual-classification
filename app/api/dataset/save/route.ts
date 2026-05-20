import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getUser, unauthorizedResponse } from "@/lib/auth";
import { callOpenRouterGrok, DEFAULT_GROK_MODEL } from "@/lib/grok-call";
import { buildCaptionSystemPrompt, parseCaptionResponse } from "@/lib/grok-caption";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"]);
const MAX_FRAMES_PER_REQUEST = 8;

function bufferToDataUrl(buf: Buffer, mime: string): string {
  const m = IMAGE_MIME.has(mime) ? mime : "image/jpeg";
  return `data:${m};base64,${buf.toString("base64")}`;
}

/**
 * Saves up to N frames as DatasetSample rows. For each frame:
 *   1. Upload JPEG to storage under `{userId}/dataset/{cuid}.jpg`
 *   2. Ask Grok to caption + per-frame tag the image
 *   3. Insert a DatasetSample row
 *
 * Returns counts and ids of saved samples (failed frames are skipped, not fatal).
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENROUTER_API_KEY not set." }, { status: 503 });
  }

  const form = await req.formData();
  const sourceName = (form.get("sourceName") as string) || null;
  const frameTimesRaw = (form.get("frameTimes") as string) || "";
  const frameTimes = frameTimesRaw
    .split(",")
    .map((s) => parseFloat(s.trim()))
    .map((n) => (Number.isFinite(n) ? n : null));
  const modelOverride = (form.get("model") as string) || "";
  const model = modelOverride.trim() || process.env.OPENROUTER_GROK_MODEL || DEFAULT_GROK_MODEL;

  const frames: File[] = [];
  for (const v of form.getAll("frames")) {
    if (v instanceof File) frames.push(v);
  }
  if (frames.length === 0) {
    return NextResponse.json({ error: "No frames provided" }, { status: 400 });
  }
  if (frames.length > MAX_FRAMES_PER_REQUEST) {
    return NextResponse.json(
      { error: `Too many frames (max ${MAX_FRAMES_PER_REQUEST})` },
      { status: 400 },
    );
  }

  const storage = getStorage();
  const systemPrompt = buildCaptionSystemPrompt();
  const savedIds: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    const timeSec = frameTimes[i] ?? null;
    try {
      const buf = Buffer.from(await frame.arrayBuffer());

      const stored = await storage.save(buf, frame.name || `frame_${i}.jpg`, frame.type || "image/jpeg", {
        prefix: `${user.id}/dataset`,
      });

      const dataUrl = bufferToDataUrl(buf, frame.type || "image/jpeg");
      const grok = await callOpenRouterGrok({
        apiKey,
        model,
        systemPrompt,
        userText: "Caption this single frame. JSON only.",
        imageDataUrls: [dataUrl],
      });

      let caption = "";
      let tags: string[] = [];
      if (grok.ok) {
        const parsed = parseCaptionResponse(grok.content);
        caption = parsed.caption;
        tags = parsed.tags;
      } else {
        errors.push(`Frame ${i + 1}: ${grok.error}`);
      }

      const sample = await prisma.datasetSample.create({
        data: {
          userId: user.id,
          filePath: stored.key,
          fileSize: BigInt(stored.size),
          caption,
          tags,
          sourceName,
          sourceTimeSec: timeSec,
        },
        select: { id: true },
      });
      savedIds.push(sample.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Frame ${i + 1}: ${msg}`);
    }
  }

  return NextResponse.json({
    savedCount: savedIds.length,
    ids: savedIds,
    errors: errors.length > 0 ? errors : undefined,
  });
}
