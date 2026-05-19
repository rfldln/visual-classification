"use client";

import { useState, useRef } from "react";

interface Prediction {
  label: string;
  display: string;
  prob: number;
}

interface PredictResponse {
  kind: "image" | "video";
  filename: string;
  predictions: Prediction[];
  frames?: number;
  error?: string;
}

export default function PredictPage() {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewKind, setPreviewKind] = useState<"image" | "video" | null>(null);
  const [result, setResult] = useState<PredictResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function runPredict(f: File) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      // Send as raw bytes to avoid Next.js's FormData body-size limit on API routes.
      // topK / frameInterval go in the query string instead.
      const res = await fetch("/api/predict?topK=5&frameInterval=5", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "x-filename": encodeURIComponent(f.name),
          "x-mime-type": f.type || "application/octet-stream",
        },
        body: f,
      });
      const json = (await res.json()) as PredictResponse;
      if (!res.ok) {
        setError(json.error ?? `Request failed (${res.status})`);
      } else {
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
    runPredict(f);
  }

  return (
    <div className="mx-auto max-w-3xl p-6">
      <h1 className="mb-1 text-2xl font-bold">Predict</h1>
      <p className="mb-6 text-sm text-zinc-400">
        Upload an image or video and the trained model will tag it. Video: 1 frame sampled per 5 seconds, softmax-averaged.
      </p>

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
          Analyzing{previewKind === "video" ? " video (1 frame / 5 s)…" : "…"}
        </div>
      )}

      {error && (
        <div className="mb-4 rounded border border-red-700 bg-red-950/50 p-3 text-sm text-red-300">
          {error}
        </div>
      )}

      {result && (
        <div className="rounded border border-zinc-800 bg-zinc-900 p-4">
          <h2 className="mb-3 text-lg font-semibold">
            Top {result.predictions.length}{" "}
            {result.kind === "video" && result.frames ? `(${result.frames} frames averaged)` : ""}
          </h2>
          <ol className="space-y-2">
            {result.predictions.map((p, i) => (
              <li key={p.label} className="flex items-center gap-3">
                <span className={`w-6 text-right text-sm ${i === 0 ? "font-bold text-accent" : "text-zinc-500"}`}>{i + 1}.</span>
                <div className="flex-1">
                  <div className="mb-1 flex justify-between text-sm">
                    <span className={i === 0 ? "font-semibold" : ""}>
                      {p.display} <span className="text-zinc-500">({p.label})</span>
                    </span>
                    <span className="text-zinc-400">{(p.prob * 100).toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 overflow-hidden rounded bg-zinc-800">
                    <div
                      className={`h-full ${i === 0 ? "bg-accent" : "bg-zinc-600"}`}
                      style={{ width: `${(p.prob * 100).toFixed(1)}%` }}
                    />
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
