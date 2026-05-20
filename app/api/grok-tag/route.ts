import { NextResponse } from "next/server";
import { getUser, unauthorizedResponse } from "@/lib/auth";
import { callOpenRouterGrok, DEFAULT_GROK_MODEL } from "@/lib/grok-call";
import { buildGrokSystemPrompt, parseGrokResponse } from "@/lib/grok";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"]);

function bufferToDataUrl(buf: Buffer, mime: string): string {
  const m = IMAGE_MIME.has(mime) ? mime : "image/jpeg";
  return `data:${m};base64,${buf.toString("base64")}`;
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "OPENROUTER_API_KEY not set." }, { status: 503 });
  }

  try {
    const form = await req.formData();
    const filename = (form.get("filename") as string) || "upload";
    const kind = (form.get("kind") as string) || "image"; // "image" | "video"
    const modelOverride = (form.get("model") as string) || "";
    const model = modelOverride.trim() || process.env.OPENROUTER_GROK_MODEL || DEFAULT_GROK_MODEL;

    // Accept either a single "image" or N "frames" entries.
    const frames: File[] = [];
    const single = form.get("image");
    if (single instanceof File) frames.push(single);
    for (const v of form.getAll("frames")) {
      if (v instanceof File) frames.push(v);
    }

    if (frames.length === 0) {
      return NextResponse.json({ error: "No image or frames provided" }, { status: 400 });
    }
    if (frames.length > 200) {
      return NextResponse.json({ error: "Too many frames (max 200)" }, { status: 400 });
    }

    const imageDataUrls = await Promise.all(
      frames.map(async (f) => bufferToDataUrl(Buffer.from(await f.arrayBuffer()), f.type || "image/jpeg")),
    );

    const frameCount = parseInt(form.get("frame_count") as string) || frames.length;
    const mainCount = parseInt(form.get("main_count") as string) || frameCount;
    const endCount = parseInt(form.get("end_count") as string) || 0;
    const userText =
      kind === "video"
        ? [
            `Tag this video. The image is a two-section contact sheet (grid, left-to-right top-to-bottom, cell numbers shown):`,
            `SECTION 1 (cells 1–${mainCount}): ${mainCount} frames sampled evenly across the FULL video. Early cells may be non-sexual intro/dialogue — acts appear in later cells.`,
            endCount > 0
              ? `SECTION 2 (cells ${mainCount + 1}–${frameCount}, marked with yellow "END ZONE" divider): ${endCount} frames densely sampled from the LAST 15% of the video at ~2s intervals. This is where creampie and squirt most often occur — examine these cells carefully for those tags.`
              : null,
            `Examine EVERY cell. Use the most explicit/partnered tags found anywhere. JSON only.`,
          ].filter(Boolean).join(" ")
        : "Tag this image. JSON only.";

    const grok = await callOpenRouterGrok({
      apiKey,
      model,
      systemPrompt: buildGrokSystemPrompt(),
      userText,
      imageDataUrls,
    });
    if (!grok.ok) {
      return NextResponse.json({ error: `OpenRouter: ${grok.error}` }, { status: grok.status });
    }

    const parsed = parseGrokResponse(grok.content);
    return NextResponse.json({
      kind,
      filename,
      model,
      frames: kind === "video" ? frameCount : undefined,
      usage: grok.usage ?? null,
      ...parsed,
      raw: parsed.raw ?? grok.content,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
