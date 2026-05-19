"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import type { FrameDTO, PaginatedResponse, ReviewStatus } from "@/types";

const STATUSES: { value: ReviewStatus | ""; label: string }[] = [
  { value: "PENDING", label: "Pending" },
  { value: "REVIEWED", label: "Reviewed" },
  { value: "FLAGGED", label: "Flagged" },
  { value: "SKIPPED", label: "Skipped" },
  { value: "", label: "All" },
];

export default function ReviewQueuePage() {
  const [status, setStatus] = useState<ReviewStatus | "">("PENDING");
  const [type, setType] = useState<"" | "image" | "video">("");
  const [sort, setSort] = useState("newest");
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["items", { status, type, sort, page }],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (status) qs.set("status", status);
      if (type) qs.set("type", type);
      qs.set("sort", sort);
      qs.set("page", String(page));
      qs.set("limit", "48");
      const r = await fetch(`/api/items?${qs}`);
      return (await r.json()) as PaginatedResponse<FrameDTO>;
    },
  });

  const pageItems = data?.items ?? [];
  const selectedOnPage = pageItems.filter((frame) => selectedIds.has(frame.id)).length;
  const allPageSelected = pageItems.length > 0 && selectedOnPage === pageItems.length;

  function clearSelection() {
    setSelectedIds(new Set());
  }

  function toggleSelected(id: string, checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  function togglePageSelected(checked: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current);
      for (const frame of pageItems) {
        if (checked) next.add(frame.id);
        else next.delete(frame.id);
      }
      return next;
    });
  }

  async function handleBulkDelete() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const noun = ids.length === 1 ? "frame" : "frames";
    if (!confirm(`Delete ${ids.length} selected ${noun}?`)) return;

    setBulkDeleting(true);
    try {
      const r = await fetch("/api/items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!r.ok) {
        const payload = await r.json().catch(() => ({ error: "Bulk delete failed" }));
        alert(payload.error ?? "Bulk delete failed");
        return;
      }
      clearSelection();
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    } finally {
      setBulkDeleting(false);
    }
  }

  async function handleDelete(e: React.MouseEvent, frame: FrameDTO) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete this frame from "${frame.source.originalName}"?`)) return;
    setDeletingId(frame.id);
    try {
      await fetch(`/api/items/${frame.id}`, { method: "DELETE" });
      toggleSelected(frame.id, false);
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    } finally {
      setDeletingId(null);
    }
  }

  async function handleDeleteSource(e: React.MouseEvent, frame: FrameDTO) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete the whole source "${frame.source.originalName}" and all ${frame.source.frameCount} of its frames?`)) return;
    setDeletingId(frame.id);
    try {
      await fetch(`/api/sources/${frame.mediaItemId}`, { method: "DELETE" });
      clearSelection();
      qc.invalidateQueries({ queryKey: ["items"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Review queue</h1>
          <p className="text-sm text-zinc-500">Each tile is one frame. Videos contribute many frames.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Select label="Status" value={status} onChange={(v) => { setStatus(v as ReviewStatus | ""); setPage(1); clearSelection(); }}>
            {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </Select>
          <Select label="Source" value={type} onChange={(v) => { setType(v as "" | "image" | "video"); setPage(1); clearSelection(); }}>
            <option value="">All</option>
            <option value="image">Images</option>
            <option value="video">Video frames</option>
          </Select>
          <Select label="Sort" value={sort} onChange={(v) => { setSort(v); setPage(1); clearSelection(); }}>
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="filename">Filename</option>
          </Select>
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading...</p>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 p-12 text-center text-sm text-zinc-500">
          No frames found. Upload some from the Upload page.
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-zinc-800 bg-zinc-950 p-3">
            <label className="inline-flex items-center gap-2 text-sm text-zinc-300">
              <input
                type="checkbox"
                checked={allPageSelected}
                onChange={(e) => togglePageSelected(e.target.checked)}
                disabled={bulkDeleting}
                className="h-4 w-4 accent-accent"
              />
              Select page
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-zinc-500">{selectedIds.size} selected</span>
              <Button type="button" variant="ghost" size="sm" onClick={clearSelection} disabled={selectedIds.size === 0 || bulkDeleting}>
                Clear
              </Button>
              <Button type="button" variant="danger" size="sm" onClick={handleBulkDelete} disabled={selectedIds.size === 0 || bulkDeleting}>
                {bulkDeleting ? "Deleting..." : "Delete selected"}
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {pageItems.map((f) => {
              const isSelected = selectedIds.has(f.id);
              return (
              <div
                key={f.id}
                className={`group relative overflow-hidden rounded-lg border bg-zinc-950 ${isSelected ? "border-accent ring-1 ring-accent/60" : "border-zinc-800 hover:border-zinc-700"}`}
              >
                <Link
                  href={`/review/${f.id}`}
                  className="block"
                  onClick={(e) => {
                    if (selectedIds.size > 0) {
                      e.preventDefault();
                      toggleSelected(f.id, !isSelected);
                    }
                  }}
                >
                  <div className="relative aspect-video bg-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt="" className="h-full w-full object-cover" />
                    {f.source.kind === "VIDEO" && (
                      <span className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-zinc-200">
                        {formatTime(f.timeSec)} / {formatTime(f.source.duration ?? 0)}
                      </span>
                    )}
                    <span className="absolute top-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] text-zinc-400">
                      {f.source.kind === "VIDEO" ? `#${f.frameIndex + 1}/${f.source.frameCount}` : "img"}
                    </span>
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs text-zinc-400" title={f.source.originalName}>
                      {f.source.originalName}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {f.labels.slice(0, 3).map((l) => (
                        <Badge key={l}>{l}</Badge>
                      ))}
                      {f.labels.length > 3 && (
                        <span className="text-[10px] text-zinc-500">+{f.labels.length - 3}</span>
                      )}
                    </div>
                  </div>
                </Link>
                <div className="absolute right-1 top-1 z-10 flex items-center gap-1">
                  <button
                    onClick={(e) => handleDelete(e, f)}
                    disabled={deletingId === f.id || bulkDeleting}
                    title="Delete this frame"
                    className="hidden h-7 w-7 items-center justify-center rounded bg-black/70 text-zinc-400 hover:bg-red-900/80 hover:text-white group-hover:inline-flex disabled:opacity-50"
                  >
                    <TrashIcon />
                  </button>
                  {f.source.kind === "VIDEO" && (
                    <button
                      onClick={(e) => handleDeleteSource(e, f)}
                      disabled={deletingId === f.id || bulkDeleting}
                      title="Delete source video + all its frames"
                      className="hidden h-7 w-7 items-center justify-center rounded bg-black/70 text-zinc-400 hover:bg-red-900/80 hover:text-white group-hover:inline-flex disabled:opacity-50"
                    >
                      <FilmTrashIcon />
                    </button>
                  )}
                  <label
                    onClick={(e) => e.stopPropagation()}
                    title={isSelected ? "Selected" : "Select frame"}
                    className={`inline-flex h-7 w-7 items-center justify-center rounded bg-black/70 ${isSelected ? "text-white ring-1 ring-accent/70" : "text-zinc-300 hover:text-white"}`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(e) => toggleSelected(f.id, e.target.checked)}
                      disabled={bulkDeleting}
                      className="h-4 w-4 accent-accent"
                    />
                    <span className="sr-only">Select frame</span>
                  </label>
                </div>
              </div>
              );
            })}
          </div>
          <Pagination page={page} totalPages={data.totalPages} onChange={setPage} total={data.total} />
        </>
      )}
    </div>
  );
}

function formatTime(sec: number) {
  if (!Number.isFinite(sec) || sec <= 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function TrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
    </svg>
  );
}
function FilmTrashIcon() {
  return (
    <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="16" rx="1"/><path d="M2 8h4"/><path d="M2 12h4"/><path d="M2 16h4"/><path d="M18 8h4"/><path d="M18 12h4"/><path d="M18 16h4"/><line x1="10" y1="10" x2="14" y2="14"/><line x1="14" y1="10" x2="10" y2="14"/>
    </svg>
  );
}

function Select({ label, value, onChange, children }: { label: string; value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-zinc-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-accent"
      >
        {children}
      </select>
    </label>
  );
}

function Pagination({ page, totalPages, onChange, total }: { page: number; totalPages: number; onChange: (n: number) => void; total: number }) {
  if (totalPages <= 1) return <p className="mt-6 text-xs text-zinc-500">{total} total</p>;
  return (
    <div className="mt-6 flex items-center justify-between text-sm">
      <span className="text-zinc-500">{total} total</span>
      <div className="flex gap-2">
        <button
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="rounded border border-zinc-800 px-3 py-1 hover:border-zinc-600 disabled:opacity-40"
        >
          Prev
        </button>
        <span className="px-2 py-1 text-zinc-400">{page} / {totalPages}</span>
        <button
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="rounded border border-zinc-800 px-3 py-1 hover:border-zinc-600 disabled:opacity-40"
        >
          Next
        </button>
      </div>
    </div>
  );
}
