"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CATEGORIES } from "@/lib/taxonomy";
import { Badge } from "@/components/ui/Badge";
import type { FrameDTO, PaginatedResponse } from "@/types";

export default function LabeledPage() {
  const [category, setCategory] = useState("");
  const [page, setPage] = useState(1);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const qc = useQueryClient();

  async function handleDelete(e: React.MouseEvent, f: FrameDTO) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete this frame from "${f.source.originalName}"?`)) return;
    setDeletingId(f.id);
    await fetch(`/api/items/${f.id}`, { method: "DELETE" });
    setDeletingId(null);
    qc.invalidateQueries({ queryKey: ["labeled"] });
    qc.invalidateQueries({ queryKey: ["stats"] });
  }

  const { data, isLoading } = useQuery({
    queryKey: ["labeled", { category, page }],
    queryFn: async () => {
      const qs = new URLSearchParams();
      qs.set("status", "REVIEWED");
      if (category) qs.set("category", category);
      qs.set("page", String(page));
      qs.set("limit", "48");
      const r = await fetch(`/api/items?${qs}`);
      return (await r.json()) as PaginatedResponse<FrameDTO>;
    },
  });

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Labeled frames</h1>
          <p className="text-sm text-zinc-500">Browse reviewed frames. Filter by category.</p>
        </div>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Category
          <select
            value={category}
            onChange={(e) => { setCategory(e.target.value); setPage(1); }}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-100 outline-none focus:border-accent"
          >
            <option value="">All</option>
            {CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      </div>

      {isLoading ? (
        <p className="text-sm text-zinc-500">Loading...</p>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 p-12 text-center text-sm text-zinc-500">
          No frames found.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            {data.items.map((f) => {
              const params = new URLSearchParams({ from: "labeled" });
              if (category) params.set("category", category);
              const href = `/review/${f.id}?${params.toString()}`;
              return (
              <div key={f.id} className="group relative overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 hover:border-zinc-700">
                <Link href={href} className="block">
                  <div className="relative aspect-video bg-black">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={f.url} alt="" className="h-full w-full object-cover" />
                  </div>
                  <div className="p-2">
                    <p className="truncate text-xs text-zinc-400" title={f.source.originalName}>{f.source.originalName}</p>
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
                <button
                  onClick={(e) => handleDelete(e, f)}
                  disabled={deletingId === f.id}
                  title="Delete"
                  className="absolute right-1 top-1 hidden rounded bg-black/70 p-1.5 text-zinc-400 hover:bg-red-900/80 hover:text-white group-hover:flex disabled:opacity-50"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
                  </svg>
                </button>
              </div>
              );
            })}
          </div>
          {data.totalPages > 1 && (
            <div className="mt-6 flex items-center justify-between text-sm">
              <span className="text-zinc-500">{data.total} total</span>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(page - 1)} className="rounded border border-zinc-800 px-3 py-1 hover:border-zinc-600 disabled:opacity-40">Prev</button>
                <span className="px-2 py-1 text-zinc-400">{page} / {data.totalPages}</span>
                <button disabled={page >= data.totalPages} onClick={() => setPage(page + 1)} className="rounded border border-zinc-800 px-3 py-1 hover:border-zinc-600 disabled:opacity-40">Next</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
