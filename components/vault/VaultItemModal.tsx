"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CATEGORIES } from "@/lib/taxonomy";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { extractFramesFromUrl } from "@/lib/video-client";

export interface VaultItem {
  id: string;
  originalName: string;
  kind: "IMAGE" | "VIDEO";
  duration: number | null;
  fileSize: string;
  autoTags: string[];
  autoTagStatus: string;
  autoTaggedAt: string | null;
  thumbnailUrl: string | null;
  mediaUrl: string;
  uploadedAt: string;
}

interface Props {
  item: VaultItem | null;
  onClose: () => void;
}

function formatDuration(s: number | null) {
  if (s == null) return null;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: string) {
  const n = parseInt(bytes, 10);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e3).toFixed(0)} KB`;
}

function FrameStrip({
  mediaUrl,
  videoRef,
}: {
  mediaUrl: string;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const [frames, setFrames] = useState<{ blob: Blob; timeSec: number; url: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setFrames([]);
    extractFramesFromUrl(mediaUrl, { intervalSec: 5, maxWidth: 480, quality: 0.75 })
      .then((results) => {
        if (cancelled) return;
        setFrames(results.map((r) => ({ ...r, url: URL.createObjectURL(r.blob) })));
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        const isCors = msg.includes("tainted") || msg.includes("cross") || msg.includes("CORS");
        setError(isCors ? "Frames blocked by CORS — enable cross-origin on your Supabase storage bucket." : msg);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [mediaUrl]);

  useEffect(() => () => { frames.forEach((f) => URL.revokeObjectURL(f.url)); }, [frames]);

  if (loading) {
    return (
      <div className="flex gap-2 overflow-x-auto py-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-16 w-28 shrink-0 animate-pulse rounded bg-zinc-800" />
        ))}
      </div>
    );
  }

  if (error) return <p className="text-xs text-zinc-500">{error}</p>;
  if (frames.length === 0) return <p className="text-xs text-zinc-500">No frames extracted.</p>;

  return (
    <div className="flex gap-2 overflow-x-auto py-1">
      {frames.map((f) => (
        <button
          key={f.timeSec}
          onClick={() => { if (videoRef.current) videoRef.current.currentTime = f.timeSec; }}
          className="relative h-16 w-28 shrink-0 overflow-hidden rounded border border-zinc-800 transition hover:border-zinc-500"
          title={`Seek to ${formatDuration(f.timeSec) ?? `${f.timeSec.toFixed(0)}s`}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={f.url} alt="" className="h-full w-full object-cover" />
          <span className="absolute bottom-0 right-0 rounded-tl bg-black/60 px-1 py-0.5 text-[9px] text-zinc-300">
            {formatDuration(f.timeSec) ?? `${f.timeSec.toFixed(0)}s`}
          </span>
        </button>
      ))}
    </div>
  );
}

export function VaultItemModal({ item, onClose }: Props) {
  const qc = useQueryClient();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Two right-panel states: "view" shows tag pills, "edit" shows checkboxes
  const [panelMode, setPanelMode] = useState<"view" | "edit">("view");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [deleteStage, setDeleteStage] = useState<"idle" | "confirm">("idle");
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (item) {
      setSelectedTags(new Set(item.autoTags));
      setPanelMode("view");
      setDeleteStage("idle");
    }
  }, [item?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!item) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (panelMode === "edit") {
        // First Escape cancels edit, second Escape closes modal
        setPanelMode("view");
        setSelectedTags(new Set(item.autoTags));
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [item, onClose, panelMode]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current); }, []);

  const saveMutation = useMutation({
    mutationFn: async (tags: string[]) => {
      const res = await fetch(`/api/sources/${item!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoTags: tags, autoTagStatus: "DONE" }),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vault"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/sources/${item!.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vault"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
      onClose();
    },
  });

  const handleDeleteClick = useCallback(() => {
    if (deleteStage === "idle") {
      setDeleteStage("confirm");
      deleteTimerRef.current = setTimeout(() => setDeleteStage("idle"), 3000);
    } else {
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      deleteMutation.mutate();
    }
  }, [deleteStage, deleteMutation]);

  const toggleTag = useCallback((id: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const cancelEdit = useCallback(() => {
    setPanelMode("view");
    if (item) setSelectedTags(new Set(item.autoTags));
  }, [item]);

  if (!item) return null;

  const isVideo = item.kind === "VIDEO";
  const isBusy = saveMutation.isPending || deleteMutation.isPending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 shadow-2xl"
        style={{ maxHeight: "92vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-zinc-100" title={item.originalName}>
              {item.originalName}
            </span>
            <Badge tone={isVideo ? "accent" : "neutral"}>{item.kind}</Badge>
          </div>
          <button
            onClick={onClose}
            className="ml-4 shrink-0 rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Close"
          >
            <svg className="h-4 w-4" viewBox="0 0 16 16" fill="currentColor">
              <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* Left — media */}
          <div className="flex w-[58%] shrink-0 flex-col border-r border-zinc-800 bg-black">
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              {isVideo ? (
                // eslint-disable-next-line jsx-a11y/media-has-caption
                <video ref={videoRef} src={item.mediaUrl} controls className="max-h-full max-w-full" playsInline />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.mediaUrl} alt={item.originalName} className="max-h-full max-w-full object-contain" />
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-zinc-900 px-4 py-2 text-xs text-zinc-500">
              <span>{formatBytes(item.fileSize)}</span>
              {item.duration != null && <span>{formatDuration(item.duration)}</span>}
              <span>{new Date(item.uploadedAt).toLocaleDateString()}</span>
            </div>
          </div>

          {/* Right — view or edit panel */}
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">

            {panelMode === "view" ? (
              /* ── VIEW: tag pills ─────────────────────────────────────── */
              <>
                <div className="flex-1 px-5 py-4">
                  <div className="mb-3 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Tags</p>
                    <button
                      onClick={() => setPanelMode("edit")}
                      className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
                    >
                      <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086ZM11.189 6.25 9.75 4.81 3.23 11.33c-.03.03-.052.067-.063.107l-.652 2.278 2.278-.651a.2.2 0 0 0 .108-.063L11.19 6.25Z"/>
                      </svg>
                      Edit tags
                    </button>
                  </div>

                  {item.autoTags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {item.autoTags.map((tag) => (
                        <span
                          key={tag}
                          className="rounded-md bg-zinc-800 px-2.5 py-1 text-sm font-semibold uppercase tracking-wider text-zinc-100"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
                      <span className="text-3xl">🏷️</span>
                      <p className="text-sm text-zinc-500">No tags yet.</p>
                      <button
                        onClick={() => setPanelMode("edit")}
                        className="mt-1 text-xs text-accent underline hover:no-underline"
                      >
                        Add tags manually
                      </button>
                    </div>
                  )}
                </div>

                {/* Frame strip (videos only, view mode) */}
                {isVideo && (
                  <div className="border-t border-zinc-800 px-5 py-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                      Frames · 1 per 5s
                    </p>
                    <FrameStrip mediaUrl={item.mediaUrl} videoRef={videoRef} />
                  </div>
                )}
              </>
            ) : (
              /* ── EDIT: checkbox grid ────────────────────────────────── */
              <div className="flex-1 px-5 py-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Edit Tags</p>
                  <button
                    onClick={cancelEdit}
                    className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
                  >
                    ✕ Cancel
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-0.5">
                  {CATEGORIES.map((cat) => (
                    <label
                      key={cat.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900"
                    >
                      <input
                        type="checkbox"
                        checked={selectedTags.has(cat.id)}
                        onChange={() => toggleTag(cat.id)}
                        className="accent-accent"
                      />
                      <span className="truncate">{cat.label}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
          <Button variant="danger" size="sm" onClick={handleDeleteClick} disabled={isBusy}>
            {deleteMutation.isPending ? "Deleting…" : deleteStage === "confirm" ? "Confirm delete?" : "Delete"}
          </Button>

          <div className="flex gap-2">
            {panelMode === "view" ? (
              <Button variant="ghost" size="sm" onClick={onClose} disabled={isBusy}>
                Close
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={isBusy}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => saveMutation.mutate(Array.from(selectedTags))}
                  disabled={isBusy}
                >
                  {saveMutation.isPending ? "Saving…" : "Save"}
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
