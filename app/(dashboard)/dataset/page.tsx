"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CATEGORIES } from "@/lib/taxonomy";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { DatasetSampleModal, type DatasetSample } from "@/components/dataset/DatasetSampleModal";

interface DatasetResponse {
  items: DatasetSample[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  sources: string[];
}

function getCategoryLabel(id: string) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

function DatasetCard({ item, onClick }: { item: DatasetSample; onClick: () => void }) {
  const visibleTags = item.tags.slice(0, 3);
  const extra = item.tags.length - visibleTags.length;
  return (
    <button
      onClick={onClick}
      className="group flex flex-col overflow-hidden rounded-xl border border-zinc-800 bg-zinc-950 text-left transition hover:border-zinc-600 hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="relative aspect-video w-full shrink-0 overflow-hidden bg-zinc-900">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.imageUrl}
          alt=""
          className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.03] group-hover:brightness-75"
        />
        {item.sourceTimeSec != null && (
          <span className="absolute bottom-2 right-2 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-zinc-300">
            {item.sourceTimeSec.toFixed(1)}s
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-2 p-3">
        <p
          className="line-clamp-3 text-xs text-zinc-300"
          title={item.caption || "(no caption)"}
        >
          {item.caption || <span className="italic text-zinc-600">No caption</span>}
        </p>
        <div className="flex min-h-[22px] flex-wrap gap-1">
          {visibleTags.length > 0 ? (
            <>
              {visibleTags.map((t) => (
                <Badge key={t}>{getCategoryLabel(t)}</Badge>
              ))}
              {extra > 0 && <Badge tone="neutral">+{extra}</Badge>}
            </>
          ) : (
            <span className="text-[10px] text-zinc-600">No tags</span>
          )}
        </div>
        {item.sourceName && (
          <p className="truncate text-[10px] text-zinc-500" title={item.sourceName}>
            {item.sourceName}
          </p>
        )}
      </div>
    </button>
  );
}

export default function DatasetPage() {
  const [page, setPage] = useState(1);
  const [tagFilter, setTagFilter] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [selected, setSelected] = useState<DatasetSample | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["dataset", { page, tagFilter, sourceFilter }],
    queryFn: async () => {
      const qs = new URLSearchParams();
      qs.set("page", String(page));
      qs.set("limit", "24");
      if (tagFilter) qs.set("tag", tagFilter);
      if (sourceFilter) qs.set("sourceName", sourceFilter);
      const res = await fetch(`/api/dataset?${qs}`);
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      return res.json() as Promise<DatasetResponse>;
    },
    retry: 1,
  });

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-100">Dataset</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Captioned frames for ML training. Auto-saved from Grok tagging runs.
          </p>
        </div>
        <a
          href="/api/dataset/export"
          className="inline-flex items-center gap-2 rounded-md border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm font-medium text-zinc-100 hover:bg-zinc-700"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5M16.5 12 12 16.5m0 0L7.5 12m4.5 4.5V3" />
          </svg>
          Export ZIP
        </a>
      </div>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Tag
          <select
            value={tagFilter}
            onChange={(e) => { setTagFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-accent"
          >
            <option value="">All</option>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-500">
          Source
          <select
            value={sourceFilter}
            onChange={(e) => { setSourceFilter(e.target.value); setPage(1); }}
            className="rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-accent"
          >
            <option value="">All sources</option>
            {data?.sources.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </label>
        {data && (
          <div className="ml-auto flex items-end">
            <span className="text-xs text-zinc-500">{data.total} sample{data.total !== 1 ? "s" : ""}</span>
          </div>
        )}
      </div>

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
          <p className="text-red-400">Failed to load dataset: {String(error)}</p>
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-800 p-16 text-center text-sm text-zinc-500">
          {tagFilter || sourceFilter
            ? "No samples match the current filters."
            : "No dataset samples yet — upload a video or image in Grok Test to start collecting."}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
            {data.items.map((item) => (
              <DatasetCard key={item.id} item={item} onClick={() => setSelected(item)} />
            ))}
          </div>

          {data.totalPages > 1 && (
            <div className="flex items-center justify-between pt-2 text-sm">
              <span className="text-zinc-500">Page {page} of {data.totalPages}</span>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => setPage(page - 1)} disabled={page <= 1}>
                  ← Prev
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setPage(page + 1)} disabled={page >= data.totalPages}>
                  Next →
                </Button>
              </div>
            </div>
          )}
        </>
      )}

      <DatasetSampleModal sample={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
