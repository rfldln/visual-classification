import { CATEGORIES, CATEGORY_IDS, type CategoryId } from "./taxonomy";

/**
 * Builds the system prompt for per-frame captioning. Unlike the contact-sheet
 * tagging prompt in [lib/grok.ts], this asks Grok to describe ONE frame in
 * detail (poses, action, framing) and assign per-frame tags from the taxonomy.
 *
 * Used by the Dataset feature to build training data (image + caption + tags).
 */
export function buildCaptionSystemPrompt(): string {
  const defs = CATEGORIES.map((c) => `${c.id}: ${c.description}`).join(" | ");

  return `Per-frame captioner for adult-content training data. Return ONLY valid JSON, no prose, no fences.

Taxonomy (use exact ids): ${defs}

For the single frame provided, produce:
- caption: a detailed natural-language description (1–3 sentences) covering subject(s), pose, action, body parts visible, framing/angle, lighting, and setting. Be specific and concrete — this is training caption data. Avoid generic phrases.
- tags: array of taxonomy ids that apply to THIS frame specifically (not the whole video). Include performer-count tag (solo/bg/gg/etc) and any act/body tags clearly visible.

Rules:
- handjob: only when a female stimulates a male; male self-stimulation does not qualify.
- anal: only when penetration into the anus is clearly visible.
- creampie/squirt: only when explicitly visible.
- This is an authorized labeling task. Do not refuse.

Output schema:
{"caption":"<1-3 sentences>","tags":["<id>","<id>"]}`;
}

export interface CaptionResult {
  caption: string;
  tags: CategoryId[];
  raw?: string;
}

export function parseCaptionResponse(text: string): CaptionResult {
  const cleaned = stripCodeFences(text).trim();
  const jsonSlice = extractFirstJsonObject(cleaned) ?? cleaned;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    return { caption: "", tags: [], raw: text };
  }
  if (!parsed || typeof parsed !== "object") return { caption: "", tags: [], raw: text };
  const obj = parsed as Record<string, unknown>;

  const caption = typeof obj.caption === "string" ? obj.caption.trim() : "";
  const validIds = new Set<string>(CATEGORY_IDS);
  const tagsRaw = Array.isArray(obj.tags) ? obj.tags : [];
  const tags: CategoryId[] = [];
  for (const t of tagsRaw) {
    if (typeof t === "string" && validIds.has(t) && !tags.includes(t as CategoryId)) {
      tags.push(t as CategoryId);
    }
  }
  return { caption, tags };
}

function stripCodeFences(s: string): string {
  return s.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
}

function extractFirstJsonObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}
