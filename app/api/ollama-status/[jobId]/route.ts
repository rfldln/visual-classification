import { NextResponse } from "next/server";
import { getUser, unauthorizedResponse } from "@/lib/auth";
import { checkRunPodJob } from "@/lib/ollama-call";
import { filterGrokTags, parseGrokResponse } from "@/lib/grok";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  const { jobId } = await params;

  const rpKey = process.env.RUNPOD_API_KEY?.trim();
  const rpEndpoint = process.env.RUNPOD_ENDPOINT_ID?.trim();
  if (!rpKey || !rpEndpoint) {
    return NextResponse.json({ error: "RunPod not configured" }, { status: 500 });
  }

  const job = await checkRunPodJob({ endpointId: rpEndpoint, apiKey: rpKey, jobId });

  if (job.status === "pending") {
    return NextResponse.json({ status: "pending" });
  }
  if (job.status === "failed") {
    return NextResponse.json({ status: "failed", error: job.error });
  }

  // Completed — parse and filter
  const cleaned = job.content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  const parsed = parseGrokResponse(cleaned);
  parsed.tags = filterGrokTags(parsed.tags);

  return NextResponse.json({
    status: "completed",
    tags: parsed.tags,
    summary: parsed.summary,
    notes: parsed.notes,
    raw: parsed.raw ?? job.content,
    promptTokens: job.promptTokens ?? null,
    completionTokens: job.completionTokens ?? null,
  });
}
