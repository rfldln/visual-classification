"use client";

import { useState, useCallback, useRef } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { CATEGORIES } from "@/lib/taxonomy";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { probeVideoMeta, extractThumbnail } from "@/lib/video-client";

type AutoTagStatus = "PENDING" | "PROCESSING" | "DONE" | "FAILED" | "SKIPPED";

interface VaultItem {
  id: string;
  originalName: string;
  kind: "IMAGE" | "VIDEO";
  duration: number | null;
  fileSize: string;
  autoTags: string[];
  autoTagStatus: AutoTagStatus;
  autoTaggedAt: string | null;
  thumbnailUrl: string | null;
  mediaUrl: string;
  uploadedAt: string;
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
  const { label, tone } = cfg[status] ?? { label: status, tone: "neutral" as const };
  return <Badge tone={tone}>{label}</Badge>;
}

function getCategoryDisplay(id: string) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export default function VaultPage() {
  const [page, setPage]                 = useState(1);
  const [kindFilter, setKindFilter]     = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editItem, setEditItem]         = useState<VaultItem | null>(null);
  const [editTags, setEditTags]         = useState<Set<string>>(new Set());
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

  const retryMutation = useMutation({
    mutationFn: (id: string) => fetch(`/api/sources/${id}/autotag`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["vault"] }),
  });

  const saveTagsMutation = useMutation({
    mutationFn: ({ id, tags }: { id: string; tags: string[] }) =>
      fetch(`/api/sources/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoTags: tags }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vault"] });
      setEditItem(null);
    },
  });

  const openEdit = useCallback((item: VaultItem) => {
    setEditItem(item);
    setEditTags(new Set(item.autoTags));
  }, []);

  const toggleTag = useCallback((id: string) => {
    setEditTags((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const uploadFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(
      (f) => f.type.startsWith("video/") || f.type.startsWith("image/"),
    );
    if (list.length === 0) return;
    setUploading(true);
    for (const file of list) {
      try {
        const form = new FormData();
        form.set("file", file, file.name);
        form.set("originalName", file.name);
        form.set("mimeType", file.type);
        if (file.type.startsWith("video/")) {
          try {
            const meta = await probeVideoMeta(file);
            form.set("duration", String(meta.duration));
            form.set("width", String(meta.width));
            form.set("height", String(meta.height));
            const thumb = await extractThumbnail(file, { timeSec: 0.5, maxWidth: 512 });
            form.set("thumbnail", new File([thumb], "thumb.jpg", { type: "image/jpeg" }));
          } catch (err) {
            console.warn("Video probe/thumbnail failed, uploading without:", err);
          }
        } else {
          // Image dimensions are optional; let the server skip them.
          try {
            const dims = await probeImageMeta(file);
            form.set("width", String(dims.width));
            form.set("height", String(dims.height));
          } catch {}
        }
        const res = await fetch("/api/vault/upload", { method: "POST", body: form });
        if (!res.ok) {
          const text = await res.text();
          console.error("Vault upload failed:", res.status, text);
        }
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
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold">Vault</h1>
        <p className="text-sm text-zinc-500">Upload videos or images — the model tags them automatically.</p>
      </div>

      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onClick={() => !uploading && fileInputRef.current?.click()}
        className={`cursor-pointer rounded-lg border-2 border-dashed p-8 text-center transition-colors ${
          dragOver
            ? "border-accent bg-accent/10 text-accent"
            : "border-zinc-700 text-zinc-500 hover:border-zinc-500 hover:text-zinc-400"
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
        <p className="text-sm font-medium">
          {uploading ? "Uploading… please wait" : "Drop videos or images here, or click to select"}
        </p>
        <p className="mt-1 text-xs">MP4, MOV, WebM, JPG, PNG, WebP supported</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Type
          <select value={kindFilter} onChange={(e) => { setKindFilter(e.target.value); setPage(1); }}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-accent">
            <option value="">All</option>
            <option value="VIDEO">Videos</option>
            <option value="IMAGE">Images</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Status
          <select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-accent">
            <option value="">All</option>
            <option value="DONE">Tagged</option>
            <option value="PROCESSING">Processing</option>
            <option value="PENDING">Queued</option>
            <option value="FAILED">Failed</option>
            <option value="SKIPPED">Skipped</option>
          </select>
        </label>
      </div>

      {/* Grid */}
      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : isError ? (
        <div className="rounded border border-red-900 bg-red-950/30 p-6 text-sm">
          <p className="text-red-400">Failed to load vault: {String(error)}</p>
          <p className="mt-1 text-xs text-zinc-500">Check that all Vercel environment variables are set correctly.</p>
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 p-12 text-center text-sm text-zinc-500">
          {kindFilter || statusFilter ? "No items match the current filters." : "Nothing in the vault yet — upload something above."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {data.items.map((item) => (
              <div key={item.id} className="flex flex-col overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 hover:border-zinc-700">
                {/* Thumbnail */}
                <div className="relative aspect-video flex-shrink-0 bg-zinc-900">
                  {item.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xs text-zinc-600">No preview</div>
                  )}
                  <div className="absolute left-2 top-2">
                    <Badge tone={item.kind === "VIDEO" ? "accent" : "neutral"}>{item.kind}</Badge>
                  </div>
                  <div className="absolute right-2 top-2">
                    <StatusBadge status={item.autoTagStatus} />
                  </div>
                  {item.duration != null && (
                    <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-zinc-300">
                      {formatDuration(item.duration)}
                    </span>
                  )}
                </div>

                {/* Info */}
                <div className="flex flex-1 flex-col gap-2 p-3">
                  <p className="truncate text-xs font-medium text-zinc-300" title={item.originalName}>
                    {item.originalName}
                  </p>
                  <p className="text-[10px] text-zinc-500">{formatBytes(item.fileSize)}</p>

                  {/* Tags */}
                  <div className="flex min-h-[22px] flex-wrap gap-1">
                    {item.autoTags.length > 0
                      ? item.autoTags.map((tag) => (
                          <Badge key={tag}>{getCategoryDisplay(tag)}</Badge>
                        ))
                      : item.autoTagStatus === "DONE" && (
                          <span className="text-[10px] text-zinc-600">No tags predicted</span>
                        )}
                  </div>

                  {/* Actions */}
                  <div className="mt-auto flex gap-2 pt-1">
                    <button
                      onClick={() => openEdit(item)}
                      className="flex-1 rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:border-zinc-500 hover:text-white"
                    >
                      Edit tags
                    </button>
                    {item.autoTagStatus === "FAILED" && (
                      <button
                        onClick={() => retryMutation.mutate(item.id)}
                        disabled={retryMutation.isPending}
                        className="rounded border border-red-900 px-2 py-1 text-xs text-red-400 hover:border-red-700 hover:text-red-300 disabled:opacity-50"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {data.totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between text-sm">
              <span className="text-zinc-500">{data.total} total</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)}
                  className="rounded border border-zinc-800 px-3 py-1 hover:border-zinc-600 disabled:opacity-40">Prev</button>
                <span className="px-2 py-1 text-zinc-400">{page} / {data.totalPages}</span>
                <button disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}
                  className="rounded border border-zinc-800 px-3 py-1 hover:border-zinc-600 disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Tag edit modal */}
      <Modal open={editItem != null} onClose={() => setEditItem(null)} title={`Edit tags — ${editItem?.originalName ?? ""}`}>
        <div className="mb-4 grid max-h-72 grid-cols-2 gap-1 overflow-y-auto">
          {CATEGORIES.map((cat) => (
            <label key={cat.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm text-zinc-300 hover:bg-zinc-900">
              <input type="checkbox" checked={editTags.has(cat.id)} onChange={() => toggleTag(cat.id)} className="accent-accent" />
              {cat.label}
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button onClick={() => setEditItem(null)}
            className="rounded border border-zinc-700 px-4 py-1.5 text-sm text-zinc-300 hover:border-zinc-500">
            Cancel
          </button>
          <button
            onClick={() => editItem && saveTagsMutation.mutate({ id: editItem.id, tags: Array.from(editTags) })}
            disabled={saveTagsMutation.isPending}
            className="rounded bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent/80 disabled:opacity-50"
          >
            {saveTagsMutation.isPending ? "Saving…" : "Save"}
          </button>
        </div>
      </Modal>
    </div>
  );
}
