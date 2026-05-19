"use client";

import { useMemo, useRef, useState } from "react";
import { CATEGORIES } from "@/lib/taxonomy";
import { probeVideoMeta, extractFramesEvenly } from "@/lib/video-client";

interface GrokTag {
  id: string;
  confidence: number;
  evidence?: string;
}

interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface GrokResponse {
  kind: "image" | "video";
  filename: string;
  model: string;
  frames?: number;
  frameImages?: string[];
  usage?: TokenUsage | null;
  tags: GrokTag[];
  summary?: string;
  notes?: string;
  raw?: string;
  error?: string;
}

const VISION_MODELS = [
  { id: "x-ai/grok-4.3",           label: "Grok 4.3 (recommended)" },
  { id: "x-ai/grok-2-vision-1212", label: "Grok 2 Vision 1212" },
  { id: "x-ai/grok-vision-beta",   label: "Grok Vision Beta" },
];

export default function GrokPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"image" | "video" | null>(null);
  const [result, setResult] = useState<GrokResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [intervalSec, setIntervalSec] = useState(5);
  const [model, setModel] = useState(VISION_MODELS[0].id);
  const inputRef = useRef<HTMLInputElement>(null);

  const labelById = useMemo(() => {
    const m = new Map<string, { label: string; description: string }>();
    for (const c of CATEGORIES) m.set(c.id, { label: c.label, description: c.description });
    return m;
  }, []);

  async function runTag(f: File) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const isVideo = f.type.startsWith("video") || /\.(mp4|mov|webm|mkv)$/i.test(f.name);
      const form = new FormData();
      form.set("filename", f.name);
      form.set("model", model);

      let frameDataUrls: string[] | undefined;
      if (isVideo) {
        form.set("kind", "video");
        const meta = await probeVideoMeta(f);
        const dur = Math.max(1, meta.duration);
        const count = Math.max(1, Math.min(12, Math.ceil(dur / intervalSec)));
        const blobs = await extractFramesEvenly(f, { count, maxWidth: 512, quality: 0.8 });
        blobs.forEach((b, i) => {
          form.append("frames", new File([b], `frame_${i}.jpg`, { type: "image/jpeg" }));
        });
        frameDataUrls = blobs.map((b) => URL.createObjectURL(b));
      } else {
        form.set("kind", "image");
        form.set("image", f, f.name);
      }

      const res = await fetch("/api/grok-tag", { method: "POST", body: form });
      const json = (await res.json()) as GrokResponse;
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
      } else {
        if (frameDataUrls) json.frameImages = frameDataUrls;
        setResult(json);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  function onPick(f: File | null) {
    setResult(null);
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!f) {
      setFile(null);
      setPreviewUrl(null);
      setPreviewKind(null);
      return;
    }
    setFile(f);
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
    setPreviewKind(f.type.startsWith("video") || /\.(mp4|mov|webm|mkv)$/i.test(f.name) ? "video" : "image");
    runTag(f);
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <div className="mb-1 flex items-baseline justify-between">
        <h1 className="text-2xl font-bold">Grok Tagging Test</h1>
        <span className="text-xs text-zinc-500">via OpenRouter</span>
      </div>
      <p className="mb-6 text-sm text-zinc-400">
        Upload an image or video and ask Grok to tag it against the project taxonomy. Results are
        sanity-check only — they don&apos;t write to the database.
      </p>

      <div className="mb-4 space-y-2 text-sm">
        <div className="flex items-center gap-3">
          <label className="w-36 text-zinc-400">Model:</label>
          <select
            value={model}
            onChange={(e) => setModel(e.target.value)}
            className="rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200"
          >
            {VISION_MODELS.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-3">
          <label className="w-36 text-zinc-400">Frame interval:</label>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={60}
              value={intervalSec}
              onChange={(e) => setIntervalSec(Math.max(1, Math.min(60, Number(e.target.value) || 5)))}
              className="w-16 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200"
            />
            <span className="text-zinc-500">sec</span>
          </div>
          <span className="text-xs text-zinc-500">
            e.g. 60s video ÷ {intervalSec}s = {Math.ceil(60 / intervalSec)} frames
          </span>
        </div>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onPick(e.dataTransfer.files?.[0] ?? null);
        }}
        className="mb-4 cursor-pointer rounded border-2 border-dashed border-zinc-700 bg-zinc-900 p-8 text-center hover:border-zinc-500"
        onClick={() => inputRef.current?.click()}
      >
        <p className="text-zinc-300">Drop an image / video here, or click to choose</p>
        <p className="mt-1 text-xs text-zinc-500">jpg, png, webp, mp4, mov, webm, mkv</p>
        <input
          ref={inputRef}
          type="file"
          accept="image/*,video/*"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
        />
      </div>

      {file && (
        <div className="mb-4 flex items-center justify-between rounded bg-zinc-900 p-3 text-sm">
          <span className="truncate text-zinc-300">{file.name}</span>
          <button
            onClick={() => onPick(null)}
            className="rounded border border-zinc-700 px-3 py-1.5 text-zinc-300 hover:bg-zinc-800"
          >
            Clear
          </button>
        </div>
      )}

      {previewUrl && (
        <div className="mb-4 overflow-hidden rounded border border-zinc-800 bg-black">
          {previewKind === "video" ? (
            <video src={previewUrl} controls className="max-h-[60vh] w-full" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="preview" className="max-h-[60vh] w-full object-contain" />
          )}
        </div>
      )}

      {loading && (
        <div className="mb-4 flex items-center gap-3 rounded border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-300">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-accent" />
          Asking Grok{previewKind === "video" ? ` (1 frame / ${intervalSec}s)…` : "…"}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded border border-red-700 bg-red-950/50 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-lg font-semibold">
                Tags ({result.tags.length})
                {result.kind === "video" && result.frames ? (
                  <span className="ml-2 text-xs font-normal text-zinc-500">
                    {result.frames} frames analyzed
                  </span>
                ) : null}
              </h2>
              <span className="text-xs text-zinc-500">{result.model}</span>
            </div>

            {result.usage && (
              <div className="mb-4 flex gap-4 rounded bg-zinc-800/60 px-3 py-2 text-xs text-zinc-400">
                <span>
                  <span className="text-zinc-200">{result.usage.prompt_tokens.toLocaleString()}</span> prompt
                </span>
                <span>+</span>
                <span>
                  <span className="text-zinc-200">{result.usage.completion_tokens.toLocaleString()}</span> completion
                </span>
                <span>=</span>
                <span>
                  <span className="font-semibold text-zinc-100">{result.usage.total_tokens.toLocaleString()}</span> total tokens
                </span>
              </div>
            )}

            {result.frameImages && result.frameImages.length > 0 && (
              <div className="mb-4">
                <p className="mb-1.5 text-xs text-zinc-500">
                  Frames sent to Grok ({result.frameImages.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {result.frameImages.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={src}
                      alt={`frame ${i + 1}`}
                      title={`Frame ${i + 1}`}
                      className="h-20 w-auto rounded border border-zinc-700 object-cover"
                    />
                  ))}
                </div>
              </div>
            )}

            {result.tags.length === 0 ? (
              <p className="text-sm italic text-zinc-500">
                Grok did not assign any tags from the taxonomy.
              </p>
            ) : (
              <ol className="space-y-3">
                {result.tags.map((t, i) => {
                  const meta = labelById.get(t.id);
                  const pct = (t.confidence * 100).toFixed(1);
                  return (
                    <li key={t.id} className="flex items-start gap-3">
                      <span className={`w-6 text-right text-sm ${i === 0 ? "font-bold text-accent" : "text-zinc-500"}`}>
                        {i + 1}.
                      </span>
                      <div className="flex-1">
                        <div className="mb-1 flex justify-between text-sm">
                          <span className={i === 0 ? "font-semibold" : ""}>
                            {meta?.label ?? t.id}{" "}
                            <span className="text-zinc-500">({t.id})</span>
                          </span>
                          <span className="text-zinc-400">{pct}%</span>
                        </div>
                        <div className="mb-1 h-1.5 overflow-hidden rounded bg-zinc-800">
                          <div
                            className={`h-full ${i === 0 ? "bg-accent" : "bg-zinc-600"}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        {t.evidence && (
                          <p className="text-xs text-zinc-400">&ldquo;{t.evidence}&rdquo;</p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>

          {(result.summary || result.notes) && (
            <div className="rounded border border-zinc-800 bg-zinc-900 p-4 text-sm">
              {result.summary && (
                <div className="mb-2">
                  <span className="text-zinc-500">Summary: </span>
                  <span className="text-zinc-200">{result.summary}</span>
                </div>
              )}
              {result.notes && (
                <div>
                  <span className="text-zinc-500">Notes: </span>
                  <span className="text-zinc-300">{result.notes}</span>
                </div>
              )}
            </div>
          )}

          {result.raw && (
            <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
              <button
                onClick={() => setShowRaw((s) => !s)}
                className="text-xs text-zinc-400 hover:text-zinc-200"
              >
                {showRaw ? "Hide" : "Show"} raw model output
              </button>
              {showRaw && (
                <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-black/40 p-3 text-xs text-zinc-300">
                  {result.raw}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
