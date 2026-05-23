"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CATEGORIES } from "@/lib/taxonomy";
import { probeVideoMeta, extractFramesEvenly, extractFramesFromRange, createContactSheet } from "@/lib/video-client";
import { DEFAULT_OLLAMA_MODEL } from "@/lib/ollama-call";

interface OllamaTag {
  id: string;
  confidence: number;
  evidence?: string;
}

interface OllamaResult {
  kind: "image" | "video";
  filename: string;
  model: string;
  frames?: number;
  frameImages?: string[];
  promptTokens?: number | null;
  completionTokens?: number | null;
  tags: OllamaTag[];
  summary?: string;
  notes?: string;
  raw?: string;
}

interface PollMeta {
  kind: "image" | "video";
  filename: string;
  model: string;
  frameCount?: number;
  frameImages?: string[];
}

const PRESET_MODELS = [
  { id: "huihui_ai/Qwen3.6-abliterated:27b", label: "Qwen3.6 27B" },
  { id: "huihui_ai/Qwen3.6-abliterated:35b", label: "Qwen3.6 35B" },
];

export default function OllamaPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"image" | "video" | null>(null);
  const [result, setResult] = useState<OllamaResult | null>(null);
  const [status, setStatus] = useState<string | null>(null); // null = idle
  const [error, setError] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);
  const [intervalSec, setIntervalSec] = useState(5);
  const [model, setModel] = useState(DEFAULT_OLLAMA_MODEL);

  const inputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollMetaRef = useRef<PollMeta | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  const labelById = useMemo(() => {
    const m = new Map<string, { label: string; description: string }>();
    for (const c of CATEGORIES) m.set(c.id, { label: c.label, description: c.description });
    return m;
  }, []);

  function stopPolling() {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  async function poll(jobId: string) {
    try {
      const res = await fetch(`/api/ollama-status/${jobId}`);
      const json = await res.json() as { status: string; error?: string; tags?: OllamaTag[]; summary?: string; notes?: string; raw?: string; promptTokens?: number | null; completionTokens?: number | null };

      if (json.status === "pending") {
        setStatus("Waiting for RunPod (inference running)…");
        pollTimerRef.current = setTimeout(() => poll(jobId), 3000);
        return;
      }
      if (json.status === "failed") {
        setError(json.error ?? "RunPod job failed");
        setStatus(null);
        return;
      }
      // completed
      const meta = pollMetaRef.current!;
      setResult({
        kind: meta.kind,
        filename: meta.filename,
        model: meta.model,
        frames: meta.frameCount,
        frameImages: meta.frameImages,
        tags: json.tags ?? [],
        summary: json.summary,
        notes: json.notes,
        raw: json.raw,
        promptTokens: json.promptTokens,
        completionTokens: json.completionTokens,
      });
      setStatus(null);
    } catch {
      // transient network error — retry
      pollTimerRef.current = setTimeout(() => poll(jobId), 3000);
    }
  }

  async function runTag(f: File) {
    stopPolling();
    setStatus("Submitting…");
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

        const mainCount = Math.min(25, Math.max(1, Math.ceil(dur / intervalSec)));
        const mainBlobs = await extractFramesEvenly(f, { count: mainCount, maxWidth: 320, quality: 0.6 });

        const END_FRACTION = 0.15;
        const endZoneDur = dur * END_FRACTION;
        const endCount = dur > 60 ? Math.min(15, Math.max(1, Math.ceil(endZoneDur / 2))) : 0;
        const endBlobs = endCount > 0
          ? await extractFramesFromRange(f, {
              startFraction: 1 - END_FRACTION,
              endFraction: 1,
              count: endCount,
              maxWidth: 320,
              quality: 0.6,
            })
          : [];

        const allBlobs = [...mainBlobs, ...endBlobs];
        frameDataUrls = allBlobs.map((b) => URL.createObjectURL(b));
        const sheet = await createContactSheet(allBlobs, {
          cols: 5,
          cellWidth: 240,
          sectionBreak: endBlobs.length > 0 ? mainBlobs.length : undefined,
        });
        form.set("frame_count", String(allBlobs.length));
        form.set("main_count", String(mainBlobs.length));
        form.set("end_count", String(endBlobs.length));
        form.append("frames", new File([sheet], "contact_sheet.jpg", { type: "image/jpeg" }));
      } else {
        form.set("kind", "image");
        form.set("image", f, f.name);
      }

      const res = await fetch("/api/ollama-submit", { method: "POST", body: form });
      const json = await res.json() as { mode?: string; jobId?: string; kind?: string; filename?: string; model?: string; frameCount?: number; error?: string } & Partial<OllamaResult>;

      if (!res.ok || json.error) {
        setError(json.error ?? `Request failed (${res.status})`);
        setStatus(null);
        return;
      }

      if (json.mode === "sync") {
        if (frameDataUrls) json.frameImages = frameDataUrls;
        setResult(json as OllamaResult);
        setStatus(null);
        return;
      }

      // async — start polling
      pollMetaRef.current = {
        kind: (json.kind ?? "image") as "image" | "video",
        filename: json.filename ?? f.name,
        model: json.model ?? model,
        frameCount: json.frameCount,
        frameImages: frameDataUrls,
      };
      setStatus("Job submitted — waiting for RunPod…");
      poll(json.jobId!);

    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus(null);
    }
  }

  function onPick(f: File | null) {
    stopPolling();
    setResult(null);
    setError(null);
    setStatus(null);
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
        <h1 className="text-2xl font-bold">Ollama Tagging Test</h1>
        <span className="text-xs text-zinc-500">via local Ollama</span>
      </div>
      <p className="mb-4 text-sm text-zinc-400">
        Upload an image or video and tag it against the project taxonomy using a local (or RunPod) Ollama model.
      </p>

      <div className="mb-4 space-y-2 text-sm">
        <div className="flex items-center gap-3">
          <label className="w-36 text-zinc-400">Model:</label>
          <div className="flex flex-1 gap-2">
            {PRESET_MODELS.map((p) => (
              <button
                key={p.id}
                onClick={() => setModel(p.id)}
                className={`rounded border px-3 py-1 text-xs ${
                  model === p.id
                    ? "border-accent bg-accent/10 text-accent"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
                }`}
              >
                {p.label}
              </button>
            ))}
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder={DEFAULT_OLLAMA_MODEL}
              className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-zinc-200 placeholder-zinc-600"
            />
          </div>
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
          <span className="text-xs text-zinc-500">max 40 frames</span>
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

      {status && (
        <div className="mb-4 flex items-center gap-3 rounded border border-zinc-700 bg-zinc-900 p-3 text-sm text-zinc-300">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-accent" />
          {status}
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

            {(result.promptTokens != null || result.completionTokens != null) && (
              <div className="mb-4 flex gap-4 rounded bg-zinc-800/60 px-3 py-2 text-xs text-zinc-400">
                {result.promptTokens != null && (
                  <span>
                    <span className="text-zinc-200">{result.promptTokens.toLocaleString()}</span> prompt
                  </span>
                )}
                {result.completionTokens != null && (
                  <>
                    <span>+</span>
                    <span>
                      <span className="text-zinc-200">{result.completionTokens.toLocaleString()}</span> completion
                    </span>
                  </>
                )}
              </div>
            )}

            {result.frameImages && result.frameImages.length > 0 && (
              <div className="mb-4">
                <p className="mb-1.5 text-xs text-zinc-500">
                  Frames sent to Ollama ({result.frameImages.length})
                </p>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {result.frameImages.map((src, i) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      key={i}
                      src={src}
                      alt={`frame ${i + 1}`}
                      title={`Frame ${i + 1}`}
                      className="h-20 w-auto flex-none rounded border border-zinc-700 object-cover"
                    />
                  ))}
                </div>
              </div>
            )}

            {result.tags.length === 0 ? (
              <p className="text-sm italic text-zinc-500">
                Ollama did not assign any tags from the taxonomy.
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
