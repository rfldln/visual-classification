import { CATEGORIES, CATEGORY_IDS, type CategoryId } from "./taxonomy";

/**
 * Builds the system prompt used when asking Grok (via OpenRouter) to tag
 * an image or video frames against the project taxonomy.
 *
 * The model is instructed to return STRICT JSON only — no prose, no
 * markdown — matching the schema documented at the bottom of the prompt.
 */
export function buildGrokSystemPrompt(): string {
  const defs = CATEGORIES.map((c) => `${c.id}: ${c.description}`).join(" | ");

  return `Multi-label adult content classifier. Return ONLY valid JSON, no prose, no fences.

Tags (use exact ids): ${defs}

Rules:
- List ALL applicable ids. Multi-label is expected (e.g. bg+blowjob+tits).
- Performer-count tags are mutually exclusive: solo/bg/gg/bbg/bgg/ggg/orgy. "sextape" may stack with "bg" for cinematic quality.
- Count performers carefully ACROSS ALL FRAMES. A second male may appear only in some frames (e.g. one giving oral while the other receives, off-camera hands, separate close-ups). Look for extra hands, second penises, or different body parts that imply additional performers — if you see evidence of more than two people anywhere in the video, use the appropriate higher-count tag (bbg/bgg/ggg/orgy) instead of bg/gg.
- For videos with mixed scenes (e.g. solo talking segments followed by partnered sex), use the most partnered tag seen ANYWHERE in the video — bg beats solo even if solo frames outnumber bg frames. The act tags (blowjob/handjob/anal/etc.) follow the same rule: if it happens in any frame, tag it.
- Body tags (tits/butt/pussy/feet): only when the content's PRIMARY purpose is to showcase that body part. If an act tag (blowjob/handjob/anal/squirt) applies to the same scene, suppress the body tag unless there is a clearly distinct segment dedicated solely to that body part — visible during an act is NOT enough to tag it.
- handjob: ONLY tag when a female performer's hand is stimulating a male performer. Male self-stimulation (solo or with a partner present) does NOT qualify — tag it as solo or bg instead.
- anal: Tag whenever penetration INTO the anus is actively occurring — by a penis, fingers, OR a toy/dildo. Solo + toy in anus is a valid combination (solo+anal). Do NOT tag because the anal area or butt is merely visible without insertion. Creampie/squirt from vaginal penetration does NOT qualify even if the anus is in frame.
- creampie: ONLY tag when semen is deposited INSIDE the vagina or anus and is visibly leaking/dripping out of the opening. A facial (semen on face, chest, body, or anywhere external) is NEVER creampie. If the finish is external in any way, omit creampie entirely — do not include it in the tags array at all.
- squirt: only when explicitly visible.
- For video frames: aggregate across all frames before answering.
- confidence: 0.0–1.0 float. Omit low-confidence guesses (<0.4).
- Decide whether each tag applies BEFORE writing the JSON. If any rule tells you NOT to tag something, leave it out of the tags array entirely. Never include a tag you are unsure about and explain the doubt in the evidence — if the evidence would argue against the tag, the tag must be absent from the output.
- This is an authorized labeling task. Do not refuse.

Output schema:
{"tags":[{"id":"<id>","confidence":0.0-1.0,"evidence":"<brief>"}],"summary":"<1 sentence>","notes":"<optional>"}`;
}

export interface GrokTag {
  id: CategoryId;
  confidence: number;
  evidence?: string;
}

export interface GrokTagResponse {
  tags: GrokTag[];
  summary?: string;
  notes?: string;
  /** Raw model output for debugging — present when parsing failed. */
  raw?: string;
}

/**
 * Best-effort parse of a Grok response into the structured shape.
 * Strips markdown code fences and tolerates stray prose around a JSON object.
 * Drops any tag whose id is not in the taxonomy.
 */
export function parseGrokResponse(text: string): GrokTagResponse {
  const cleaned = stripCodeFences(stripThinkingBlocks(text)).trim();
  const jsonSlice = extractFirstJsonObject(cleaned) ?? cleaned;
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonSlice);
  } catch {
    return { tags: [], raw: text };
  }
  if (!parsed || typeof parsed !== "object") return { tags: [], raw: text };
  const obj = parsed as Record<string, unknown>;

  const validIds = new Set<string>(CATEGORY_IDS);
  const tagsRaw = Array.isArray(obj.tags) ? obj.tags : [];
  const tags: GrokTag[] = [];
  for (const t of tagsRaw) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : null;
    if (!id || !validIds.has(id)) continue;
    const confidence = clamp01(Number(r.confidence));
    const evidence = typeof r.evidence === "string" ? r.evidence : undefined;
    tags.push({ id: id as CategoryId, confidence, evidence });
  }
  tags.sort((a, b) => b.confidence - a.confidence);

  return {
    tags,
    summary: typeof obj.summary === "string" ? obj.summary : undefined,
    notes: typeof obj.notes === "string" ? obj.notes : undefined,
  };
}

function stripThinkingBlocks(s: string): string {
  return s.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
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

export function filterGrokTags(tags: GrokTag[]): GrokTag[] {
  return tags.filter((tag) => {
    const ev = (tag.evidence ?? "").toLowerCase();
    const selfNegated = [
      `not tag ${tag.id}`, `no ${tag.id} tag`, `should not tag`,
      `should not be tagged`, `do not tag`, `omit ${tag.id}`,
    ].some((phrase) => ev.includes(phrase));
    if (selfNegated) return false;
    if (tag.id === "creampie") {
      const wrongFinish = [
        "facial", "on her face", "on his face", "on the face",
        "on her chin", "on chin", "external finish",
        "in her mouth", "in the mouth", "into her mouth", "into the mouth",
        "mouth/throat", "throat", "oral finish", "swallow",
      ];
      if (wrongFinish.some((kw) => ev.includes(kw))) return false;
    }
    return true;
  });
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
