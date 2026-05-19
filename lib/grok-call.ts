import { buildGrokSystemPrompt, parseGrokResponse, type GrokTagResponse } from "@/lib/grok";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
export const DEFAULT_GROK_MODEL = "x-ai/grok-2-vision-1212";

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenRouterChoice { message?: { content?: string } }
interface OpenRouterError { error?: { message?: string } }

export type GrokCallOk = { ok: true; content: string; usage?: TokenUsage };
export type GrokCallErr = { ok: false; error: string; status: number };
export type GrokCallResult = GrokCallOk | GrokCallErr;

export async function callOpenRouterGrok(opts: {
  apiKey: string;
  model: string;
  systemPrompt: string;
  userText: string;
  imageDataUrls: string[];
}): Promise<GrokCallResult> {
  const userContent: Array<Record<string, unknown>> = [{ type: "text", text: opts.userText }];
  for (const url of opts.imageDataUrls) {
    userContent.push({ type: "image_url", image_url: { url } });
  }
  const body = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      { role: "user", content: userContent },
    ],
    temperature: 0.1,
    max_tokens: 400,
  };

  const res = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.OPENROUTER_REFERER ?? "https://visual-classification.local",
      "X-Title": "Visual Classification",
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try { const j = JSON.parse(text) as OpenRouterError; msg = j.error?.message ?? text; } catch {}
    return { ok: false, error: msg, status: res.status };
  }
  let parsed: { choices?: OpenRouterChoice[]; usage?: TokenUsage };
  try { parsed = JSON.parse(text); }
  catch { return { ok: false, error: "Invalid JSON from OpenRouter", status: 502 }; }
  const content = parsed.choices?.[0]?.message?.content ?? "";
  return { ok: true, content, usage: parsed.usage };
}

/**
 * One-shot helper: call Grok with the standard system prompt and parse the response
 * into the structured GrokTagResponse shape.
 */
export async function tagWithGrok(opts: {
  imageDataUrls: string[];
  userText: string;
  model?: string;
}): Promise<{ ok: true; result: GrokTagResponse; usage?: TokenUsage } | GrokCallErr> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return { ok: false, error: "OPENROUTER_API_KEY not set", status: 503 };
  const model = opts.model || process.env.OPENROUTER_GROK_MODEL || DEFAULT_GROK_MODEL;
  const call = await callOpenRouterGrok({
    apiKey,
    model,
    systemPrompt: buildGrokSystemPrompt(),
    userText: opts.userText,
    imageDataUrls: opts.imageDataUrls,
  });
  if (!call.ok) return call;
  return { ok: true, result: parseGrokResponse(call.content), usage: call.usage };
}
