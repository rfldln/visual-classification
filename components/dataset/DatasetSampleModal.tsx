"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CATEGORIES } from "@/lib/taxonomy";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";

export interface DatasetSample {
  id: string;
  caption: string;
  tags: string[];
  sourceName: string | null;
  sourceTimeSec: number | null;
  fileSize: string;
  width: number | null;
  height: number | null;
  createdAt: string;
  imageUrl: string;
}

interface Props {
  sample: DatasetSample | null;
  onClose: () => void;
}

function formatBytes(bytes: string) {
  const n = parseInt(bytes, 10);
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  return `${(n / 1e3).toFixed(0)} KB`;
}

export function DatasetSampleModal({ sample, onClose }: Props) {
  const qc = useQueryClient();
  const [caption, setCaption] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [deleteStage, setDeleteStage] = useState<"idle" | "confirm">("idle");
  const deleteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (sample) {
      setCaption(sample.caption);
      setSelectedTags(new Set(sample.tags));
      setDeleteStage("idle");
    }
  }, [sample?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sample) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sample, onClose]);

  useEffect(() => () => { if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current); }, []);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/dataset/${sample!.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ caption, tags: Array.from(selectedTags) }),
      });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dataset"] });
      onClose();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/dataset/${sample!.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await res.text());
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dataset"] });
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
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  if (!sample) return null;

  const isBusy = saveMutation.isPending || deleteMutation.isPending;
  const isDirty = caption !== sample.caption || setsDiffer(selectedTags, new Set(sample.tags));

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
            <span className="truncate text-sm font-semibold text-zinc-100" title={sample.sourceName ?? sample.id}>
              {sample.sourceName ?? sample.id}
            </span>
            {sample.sourceTimeSec != null && (
              <Badge tone="neutral">@ {sample.sourceTimeSec.toFixed(1)}s</Badge>
            )}
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
          {/* Left — image */}
          <div className="flex w-[58%] shrink-0 flex-col border-r border-zinc-800 bg-black">
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={sample.imageUrl} alt={sample.caption} className="max-h-full max-w-full object-contain" />
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-zinc-900 px-4 py-2 text-xs text-zinc-500">
              <span>{formatBytes(sample.fileSize)}</span>
              {sample.width && sample.height && (
                <span>{sample.width}×{sample.height}</span>
              )}
              <span>{new Date(sample.createdAt).toLocaleDateString()}</span>
            </div>
          </div>

          {/* Right — editable caption + tags */}
          <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
            <div className="border-b border-zinc-800 px-5 py-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Caption</p>
              <textarea
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                rows={6}
                placeholder="Describe the frame in detail…"
                className="w-full resize-y rounded border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 outline-none focus:border-accent"
              />
            </div>
            <div className="flex-1 px-5 py-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">Tags</p>
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
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-zinc-800 px-5 py-3">
          <Button variant="danger" size="sm" onClick={handleDeleteClick} disabled={isBusy}>
            {deleteMutation.isPending ? "Deleting…" : deleteStage === "confirm" ? "Confirm delete?" : "Delete"}
          </Button>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={isBusy}>
              Close
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => saveMutation.mutate()}
              disabled={isBusy || !isDirty}
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function setsDiffer<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return true;
  for (const x of a) if (!b.has(x)) return true;
  return false;
}
