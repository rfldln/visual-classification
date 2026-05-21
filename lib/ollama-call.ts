import { buildGrokSystemPrompt, parseGrokResponse, type GrokTagResponse } from "@/lib/grok";

export const DEFAULT_OLLAMA_MODEL = "huihui_ai/Qwen3.6-abliterated:27b";

export type OllamaCallOk = { ok: true; content: string; promptTokens?: number; completionTokens?: number };
export type OllamaCallErr = { ok: false; error: string; status: number };
export type OllamaCallResult = OllamaCallOk | OllamaCallErr;

interface OllamaResponse {
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
  error?: string;
}

export async function callOllama(opts: {
  baseUrl: string;
  model: string;
  systemPrompt: string;
  userText: string;
  imageBase64s: string[];
}): Promise<OllamaCallResult> {
  const userMessage: Record<string, unknown> = {
    role: "user",
    content: opts.userText,
  };
  if (opts.imageBase64s.length > 0) {
    userMessage.images = opts.imageBase64s;
  }

  const body = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.systemPrompt },
      userMessage,
    ],
    // stream:true keeps the connection alive through Cloudflare proxies (avoids 524 timeout).
    // We consume the NDJSON stream and reassemble the full content before returning.
    stream: true,
    think: false,
    options: { temperature: 0.1 },
  };

  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: `Cannot reach Ollama at ${opts.baseUrl}: ${msg}`, status: 503 };
  }

  if (!res.ok) {
    const text = await res.text();
    let msg = text;
    try { msg = (JSON.parse(text) as OllamaResponse).error ?? text; } catch {}
    return { ok: false, error: msg, status: res.status };
  }

  if (!res.body) {
    return { ok: false, error: "No response body from Ollama", status: 502 };
  }

  // Read the NDJSON stream and accumulate content + final token counts
  let content = "";
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const chunk = JSON.parse(trimmed) as OllamaResponse & { done?: boolean };
        content += chunk.message?.content ?? "";
        if (chunk.done) {
          promptTokens = (chunk as Record<string, unknown>).prompt_eval_count as number | undefined;
          completionTokens = (chunk as Record<string, unknown>).eval_count as number | undefined;
        }
      } catch { /* skip malformed lines */ }
    }
  }

  return {
    ok: true,
    content,
    promptTokens,
    completionTokens,
  };
}

export async function tagWithOllama(opts: {
  imageBase64s: string[];
  userText: string;
  model?: string;
}): Promise<{ ok: true; result: GrokTagResponse; promptTokens?: number; completionTokens?: number } | OllamaCallErr> {
  const baseUrl = (process.env.OLLAMA_BASE_URL ?? "http://localhost:11434").replace(/\/$/, "");
  const model = opts.model?.trim() || process.env.OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;

  const call = await callOllama({
    baseUrl,
    model,
    systemPrompt: buildGrokSystemPrompt(),
    userText: opts.userText,
    imageBase64s: opts.imageBase64s,
  });
  if (!call.ok) return call;
  return {
    ok: true,
    result: parseGrokResponse(call.content),
    promptTokens: call.promptTokens,
    completionTokens: call.completionTokens,
  };
}
