"use client";

import { useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CATEGORIES } from "@/lib/taxonomy";
import { Badge } from "@/components/ui/Badge";
import { probeVideoMeta, extractThumbnail, extractFramesEvenly } from "@/lib/video-client";
import { VaultItemModal, type VaultItem } from "@/components/vault/VaultItemModal";

type AutoTagStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED" | "SKIPPED";

/** Split frames into chunks of 20, call /api/grok-tag for each, merge results. */
async function tagInChunks(
  frameFiles: File[],
  kind: "image" | "video",
  filename: string,
  chunkSize = 20,
): Promise<string[]> {
  const chunks: File[][] = [];
  for (let i = 0; i < frameFiles.length; i += chunkSize) {
    chunks.push(frameFiles.slice(i, i + chunkSize));
  }

  const tagConfidence = new Map<string, number>();

  for (const chunk of chunks) {
    const form = new FormData();
    form.set("kind", kind);
    form.set("filename", filename);
    if (kind === "image") {
      form.set("image", chunk[0], chunk[0].name);
    } else {
      chunk.forEach((f) => form.append("frames", f));
    }
    try {
      const res = await fetch("/api/grok-tag", { method: "POST", body: form });
      if (!res.ok) { console.warn("Grok chunk failed:", res.status); continue; }
      const data = await res.json() as { tags?: { id: string; confidence: number }[] };
      for (const tag of data.tags ?? []) {
        // Keep the highest confidence seen across all chunks for each tag
        tagConfidence.set(tag.id, Math.max(tagConfidence.get(tag.id) ?? 0, tag.confidence ?? 1));
      }
    } catch (err) {
      console.warn("Grok chunk error:", err);
    }
  }

  return Array.from(tagConfidence.keys());
}

interface VaultResponse {
  items: VaultItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

function formatDuration(s: number | null) {
  if (s == null) return null;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: string) {
  const n = parseInt(bytes, 10);
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)} MB`;
  return `${(n / 1e3).toFixed(0)} KB`;
}

function StatusBadge({ status }: { status: AutoTagStatus }) {
  const cfg: Record<AutoTagStatus, { label: string; tone: "neutral" | "accent" | "success" | "warning" | "danger" }> = {
    PENDING:    { label: "Queued",      tone: "neutral"  },
    PROCESSING: { label: "Processing…", tone: "accent"   },
    DONE:       { label: "Tagged",      tone: "success"  },
    FAILED:     { label: "Failed",      tone: "danger"   },
    SKIPPED:    { label: "Skipped",     tone: "neutral"  },
  };
  const { label, tone } = cfg[status as AutoTagStatus] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={tone}>{label}</Badge>;
}

function getCategoryLabel(id: string) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

/* ─── Vault Card ──────────────────────────────────────────────────────────── */
function VaultCard({ item, onClick }: { item: VaultItem; onClick: () => void }) {
  const visibleTags = item.autoTags.slice(0, 3);
  const extraCount = item.autoTags.length - visibleTags.length;

  return (
    <button
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 text-left transition hover:border-zinc-600 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-zinc-900">
        {item.thumbnailUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03] group-hover:brightness-75"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-zinc-600">No preview</div>
        )}

        {/* Hover "View" overlay */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-sm">
            <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 3C4.667 3 1.8 5.073 1 8c.8 2.927 3.667 5 7 5s6.2-2.073 7-5c-.8-2.927-3.667-5-7-5Zm0 8a3 3 0 1 1 0-6 3 3 0 0 1 0 6Zm0-4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Z"/>
            </svg>
            View
          </span>
        </div>

        {/* Status badge — top-right */}
        <div className="absolute right-2 top-2">
          <StatusBadge status={item.autoTagStatus as AutoTagStatus} />
        </div>

        {/* Duration — bottom-right (videos) */}
        {item.duration != null && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
            {formatDuration(item.duration)}
          </span>
        )}
      </div>

      {/* Info */}
      <div className="flex flex-1 flex-col gap-2 p-3">
        {/* Filename + kind */}
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 truncate text-xs font-medium text-zinc-200" title={item.originalName}>
            {item.originalName}
          </p>
          <Badge tone={item.kind === "VIDEO" ? "accent" : "neutral"} className="shrink-0">
            {item.kind}
          </Badge>
        </div>

        {/* File size */}
        <p className="text-[11px] text-zinc-500">{formatBytes(item.fileSize)}</p>

        {/* Tags */}
        <div className="flex min-h-[22px] flex-wrap gap-1">
          {visibleTags.length > 0 ? (
            <>
              {visibleTags.map((tag) => (
                <Badge key={tag}>{getCategoryLabel(tag)}</Badge>
              ))}
              {extraCount > 0 && (
                <Badge tone="neutral">+{extraCount}</Badge>
              )}
            </>
          ) : item.autoTagStatus === "DONE" ? (
            <span className="text-[10px] text-zinc-600">No tags</span>
          ) : null}
        </div>
      </div>
    </button>
  );
}

/* ─── Main page ──────────────────────────────────────────────────────────── */
export default function VaultPage() {
  const [page, setPage]                 = useState(1);
  const [kindFilter, setKindFilter]     = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [selectedItem, setSelectedItem] = useState<VaultItem | null>(null);
  const [uploading, setUploading]       = useState(false);
  const [dragOver, setDragOver]         = useState(false);
  const fileInputRef                    = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["vault", { page, kindFilter, statusFilter }],
    queryFn: async () => {
      const qs = new URLSearchParams();
      qs.set("page", String(page));
      qs.set("limit", "24");
      if (kindFilter)   qs.set("kind", kindFilter);
      if (statusFilter) qs.set("autoTagStatus", statusFilter);
      const res = await fetch(`/api/sources?${qs}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json() as Promise<VaultResponse>;
    },
    refetchInterval: (query) => {
      const active = query.state.data?.items.some(
        (i) => i.autoTagStatus === "PENDING" || i.autoTagStatus === "PROCESSING",
      );
      return active ? 2000 : false;
    },
    retry: 1,
  });

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(
      (f) => f.type.startsWith("video/") || f.type.startsWith("image/"),
    );
    if (list.length === 0) return;
    setUploading(true);
    for (const file of list) {
      try {
        // Step 1: probe metadata + extract thumbnail client-side
        let thumbBlob: Blob | null = null;
        let videoDuration = 0;
        let width: number | null = null;
        let height: number | null = null;

        if (file.type.startsWith("video/")) {
          try {
            const meta = await probeVideoMeta(file);
            videoDuration = meta.duration;
            width = meta.width;
            height = meta.height;
            thumbBlob = await extractThumbnail(file, { timeSec: 0.5, maxWidth: 512 });
          } catch (err) {
            console.warn("Video probe/thumbnail failed:", err);
          }
        } else {
          try {
            const dims = await probeImageMeta(file);
            width = dims.width;
            height = dims.height;
          } catch {}
        }

        // Step 2: get a Supabase signed upload URL (tiny request — no file bytes)
        const urlRes = await fetch("/api/vault/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, mimeType: file.type }),
        });
        if (!urlRes.ok) {
          console.error("Failed to get upload URL:", await urlRes.text());
          continue;
        }
        const { signedUrl, path: storagePath } = await urlRes.json() as { signedUrl: string; path: string };

        // Step 3: PUT the file DIRECTLY to Supabase — never touches Vercel
        const uploadRes = await fetch(signedUrl, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        if (!uploadRes.ok) {
          console.error("Direct upload to Supabase failed:", uploadRes.status, await uploadRes.text());
          continue;
        }

        // Step 4: register the media item in the database
        const regRes = await fetch("/api/vault/register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            path: storagePath,
            originalName: file.name,
            mimeType: file.type,
            fileSize: file.size,
            duration: videoDuration || null,
            width,
            height,
          }),
        });
        if (!regRes.ok) {
          console.error("Register failed:", await regRes.text());
          continue;
        }
        const { id } = await regRes.json() as { id: string };

        // Step 5: upload thumbnail (small JPEG, fine through Vercel)
        if (thumbBlob) {
          await fetch(`/api/sources/${id}/thumbnail`, {
            method: "POST",
            headers: { "Content-Type": "image/jpeg" },
            body: thumbBlob,
          }).catch((err) => console.warn("Thumbnail upload error:", err));
        }

        // Step 6: chunked Grok tagging — 20 frames per request max
        void (async () => {
          try {
            let tags: string[] = [];
            if (file.type.startsWith("video/")) {
              const frameCount = Math.max(1, Math.ceil(Math.max(1, videoDuration) / 5));
              const blobs = await extractFramesEvenly(file, { count: frameCount, maxWidth: 320, quality: 0.6 });
              const frameFiles = blobs.map((b, i) => new File([b], `frame_${i}.jpg`, { type: "image/jpeg" }));
              tags = await tagInChunks(frameFiles, "video", file.name);
            } else {
              tags = await tagInChunks([new File([file], file.name, { type: file.type })], "image", file.name);
            }
            await fetch(`/api/sources/${id}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ autoTags: tags, autoTagStatus: "DONE" }),
            });
            qc.invalidateQueries({ queryKey: ["vault"] });
          } catch (err) {
            console.warn("Vault autotag error:", err);
          }
        })();
      } catch (err) {
        console.error("Vault upload failed for", file.name, err);
      }
    }
    setUploading(false);
    qc.invalidateQueries({ queryKey: ["vault"] });
  }, [qc]);

  async function probeImageMeta(file: File): Promise<{ width: number; height: number }> {
    const url = URL.createObjectURL(file);
    try {
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error("img load failed"));
        img.src = url;
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) void uploadFiles(e.dataTransfer.files);
  }, [uploadFiles]);

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">Vault</h1>
        <p className="mt-1 text-sm text-zinc-500">Upload media — Grok tags it automatically. Click any item to view, edit tags, or delete.</p>
      </div>

      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`cursor-pointer rounded-xl border-2 border-dashed px-8 py-10 text-center transition-colors ${
          dragOver
            ? "border-accent bg-accent/5 text-accent"
            : "border-zinc-800 text-zinc-500 hover:border-zinc-600 hover:text-zinc-400"
        } ${uploading ? "pointer-events-none opacity-60" : ""}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/*,image/*"
          className="hidden"
          onChange={(e) => e.target.files && void uploadFiles(e.target.files)}
        />
        <svg className="mx-auto mb-3 h-8 w-8 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
        </svg>
        <p className="text-sm font-medium">
          {uploading ? "Uploading and tagging… please wait" : "Drop files here, or click to select"}
        </p>
        <p className="mt-1 text-xs opacity-70">MP4, MOV, WebM, JPG, PNG, WebP · Grok tags automatically</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Type
          <select value={kindFilter} onChange={(e) => { setKindFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-accent">
            <option value="">All</option>
            <option value="VIDEO">Videos</option>
            <option value="IMAGE">Images</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Status
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-accent">
            <option value="">All</option>
            <option value="DONE">Tagged</option>
            <option value="PROCESSING">Processing</option>
            <option value="PENDING">Queued</option>
            <option value="FAILED">Failed</option>
            <option value="SKIPPED">Skipped</option>
          </select>
        </label>
        {data && (
          <div className="ml-auto flex items-end">
            <span className="text-xs text-zinc-500">{data.total} item{data.total !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950">
              <div className="aspect-video w-full animate-pulse bg-zinc-800" />
              <div className="space-y-2 p-3">
                <div className="h-3 w-3/4 animate-pulse rounded bg-zinc-800" />
                <div className="h-2.5 w-1/2 animate-pulse rounded bg-zinc-800" />
              </div>
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border border-red-900 bg-red-950/30 p-6 text-sm">
          <p className="text-red-400">Failed to load vault: {String(error)}</p>
          <p className="mt-1 text-xs text-zinc-500">Check that all Vercel environment variables are set correctly.</p>
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 p-16 text-center text-sm text-zinc-500">
          {kindFilter || statusFilter
            ? "No items match the current filters."
            : "Nothing in the vault yet — upload something above."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {data.items.map((item) => (
              <VaultCard key={item.id} item={item} onClick={() => setSelectedItem(item)} />
            ))}
          </div>

          {data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-sm">
              <span className="text-zinc-500">Page {page} of {data.totalPages}</span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                  className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs hover:border-zinc-600 disabled:opacity-40"
                >
                  ← Prev
                </button>
                <button
                  disabled={page >= data.totalPages}
                  onClick={() => setPage(page + 1)}
                  className="rounded-lg border border-zinc-800 px-3 py-1.5 text-xs hover:border-zinc-600 disabled:opacity-40"
                >
                  Next →
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Item modal */}
      <VaultItemModal
        item={selectedItem}
        onClose={() => setSelectedItem(null)}
      />
    </div>
  );
}
