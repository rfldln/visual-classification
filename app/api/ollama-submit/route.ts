import { NextResponse } from "next/server";
import { getUser, unauthorizedResponse } from "@/lib/auth";
import { callOllama, submitRunPodJob, DEFAULT_OLLAMA_MODEL } from "@/lib/ollama-call";
import { buildGrokSystemPrompt, filterGrokTags, parseGrokResponse } from "@/lib/grok";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const IMAGE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/bmp"]);

export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  try {
    const form = await req.formData();
    const filename = (form.get("filename") as string) || "upload";
    const kind = (form.get("kind") as string) || "image";
    const modelOverride = (form.get("model") as string) || "";
    const model = modelOverride.trim() || process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;

    const files: File[] = [];
    const single = form.get("image");
    if (single instanceof File) files.push(single);
    for (const v of form.getAll("frames")) {
      if (v instanceof File) files.push(v);
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No image or frames provided" }, { status: 400 });
    }
    if (files.length > 200) {
      return NextResponse.json({ error: "Too many frames (max 200)" }, { status: 400 });
    }

    const imageBase64s = await Promise.all(
      files.map(async (f) => {
        void (IMAGE_MIME.has(f.type) ? f.type : "image/jpeg");
        return Buffer.from(await f.arrayBuffer()).toString("base64");
      }),
    );

    const frameCount = parseInt(form.get("frame_count") as string) || files.length;
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

    const rpKey = process.env.RUNPOD_API_KEY?.trim();
    const rpEndpoint = process.env.RUNPOD_ENDPOINT_ID?.trim();

    if (rpKey && rpEndpoint) {
      const sub = await submitRunPodJob({
        endpointId: rpEndpoint,
        apiKey: rpKey,
        model,
        systemPrompt: buildGrokSystemPrompt(),
        userText,
        imageBase64s,
      });
      if (!sub.ok) return NextResponse.json({ error: sub.error }, { status: sub.status });
      return NextResponse.json({
        mode: "async",
        jobId: sub.jobId,
        kind,
        filename,
        model,
        frameCount: kind === "video" ? frameCount : undefined,
      });
    }

    // Local Ollama fallback — run inline (no Vercel timeout concern at 60s)
    const baseUrl = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
    const result = await callOllama({ baseUrl, model, systemPrompt: buildGrokSystemPrompt(), userText, imageBase64s });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });

    const cleaned = result.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const parsed = parseGrokResponse(cleaned);
    parsed.tags = filterGrokTags(parsed.tags);

    return NextResponse.json({
      mode: "sync",
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
