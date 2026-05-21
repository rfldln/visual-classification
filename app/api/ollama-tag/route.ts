import { NextResponse } from "next/server";
import { getUser, unauthorizedResponse } from "@/lib/auth";
import { callOllama, DEFAULT_OLLAMA_MODEL } from "@/lib/ollama-call";
import { buildGrokSystemPrompt, parseGrokResponse } from "@/lib/grok";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"]);

function bufferToBase64(buf: Buffer, mime: string): string {
  // Ollama expects raw base64, not a data URL
  void mime; // mime kept for symmetry with grok-tag; Ollama doesn't need it in the field
  return buf.toString("base64");
}

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  const baseUrl = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");

  try {
    const form = await req.formData();
    const filename = (form.get("filename") as string) || "upload";
    const kind = (form.get("kind") as string) || "image";
    const modelOverride = (form.get("model") as string) || "";
    const model = modelOverride.trim() || process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;

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

    const imageBase64s = await Promise.all(
      frames.map(async (f) => {
        const mime = IMAGE_MIME.has(f.type) ? f.type : "image/jpeg";
        return bufferToBase64(Buffer.from(await f.arrayBuffer()), mime);
      }),
    );

    const frameCount = parseInt(form.get("frame_count") as string) || frames.length;
    const mainCount = parseInt(form.get("main_count") as string) || frameCount;
    const endCount = parseInt(form.get("end_count") as string) || 0;

    const userText =
      kind === "video"
        ? [
            `Tag this video. The image is a two-section contact sheet (grid, left-to-right top-to-bottom, cell numbers shown):`,
            `SECTION 1 (cells 1–${mainCount}): ${mainCount} frames sampled evenly across the FULL video.`,
            endCount > 0
              ? `SECTION 2 (cells ${mainCount + 1}–${frameCount}): ${endCount} frames densely sampled from the LAST 15% of the video. Look carefully for creampie and squirt tags here.`
              : null,
            `Examine EVERY cell. Use the most explicit/partnered tags found anywhere. JSON only.`,
          ].filter(Boolean).join(" ")
        : `Tag this image. Filename: "${filename}". JSON only.`;

    const result = await callOllama({
      baseUrl,
      model,
      systemPrompt: buildGrokSystemPrompt(),
      userText,
      imageBase64s,
    });

    if (!result.ok) {
      return NextResponse.json({ error: `Ollama: ${result.error}` }, { status: result.status });
    }

    const cleaned = result.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const parsed = parseGrokResponse(cleaned);

    // Remove tags where the model's own evidence argues against the tag, or where
    // tag-specific evidence signals the wrong scenario.
    parsed.tags = parsed.tags.filter((tag) => {
      const ev = (tag.evidence ?? "").toLowerCase();

      // General self-negation phrases
      const selfNegated = [
        `not tag ${tag.id}`,
        `no ${tag.id} tag`,
        `should not tag`,
        `should not be tagged`,
        `do not tag`,
        `omit ${tag.id}`,
      ].some((phrase) => ev.includes(phrase));
      if (selfNegated) return false;

      // creampie-specific: any mention of facial/face/mouth/throat/external finish in the evidence
      // means the model is describing the wrong finish type — drop it.
      // Creampie requires internal deposit in vagina or anus only.
      if (tag.id === "creampie") {
        const wrongFinishKeywords = [
          "facial",
          "on her face", "on his face", "on the face",
          "on her chin", "on chin",
          "external finish",
          "in her mouth", "in the mouth", "into her mouth", "into the mouth", "mouth/throat", "throat", "oral finish",
          "swallow",
        ];
        if (wrongFinishKeywords.some((kw) => ev.includes(kw))) return false;
      }

      return true;
    });

    return NextResponse.json({
      kind,
      filename,
      model,
      frames: kind === "video" ? frameCount : undefined,
      promptTokens: result.promptTokens ?? null,
      completionTokens: result.completionTokens ?? null,
      ...parsed,
      raw: parsed.raw ?? result.content,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
