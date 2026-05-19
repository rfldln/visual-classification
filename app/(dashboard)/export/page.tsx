"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExportFilters, type ExportFilterState } from "@/components/export/ExportFilters";
import { ExportPreview } from "@/components/export/ExportPreview";
import { Button } from "@/components/ui/Button";

interface PreviewResponse {
  total: number;
  images?: number;
  videos?: number;
  estimatedRows?: number;
  long?: string;
  wide?: string;
}

export default function ExportPage() {
  const [filters, setFilters] = useState<ExportFilterState>({
    statuses: ["REVIEWED"],
    categories: [],
    from: "",
    to: "",
    format: "both",
    includeMedia: true,
  });

  const qs = buildQS(filters);

  const { data, isFetching, refetch } = useQuery({
    queryKey: ["export-preview", filters],
    queryFn: async () => {
      const r = await fetch(`/api/export?${qs}&preview=1`);
      return (await r.json()) as PreviewResponse;
    },
  });

  function download() {
    window.location.href = `/api/export?${qs}`;
  }

  return (
    <div className="p-6">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Export</h1>
          <p className="text-sm text-zinc-500">Generate a training-ready CSV bundle.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => refetch()}>Refresh preview</Button>
          <Button variant="primary" onClick={download} disabled={!data || data.total === 0}>
            Download .zip
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[360px_1fr]">
        <ExportFilters value={filters} onChange={setFilters} />

        <div className="space-y-4">
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4 text-sm">
            {isFetching ? (
              <span className="text-zinc-500">Computing preview...</span>
            ) : data ? (
              <div className="space-y-1">
                <div>
                  <strong className="text-zinc-100">{data.total.toLocaleString()}</strong> items match filters
                  {typeof data.images === "number" && typeof data.videos === "number" && (
                    <span className="text-zinc-500">
                      {" "}({data.images.toLocaleString()} images, {data.videos.toLocaleString()} videos)
                    </span>
                  )}
                </div>
                {typeof data.estimatedRows === "number" && (
                  <div className="text-zinc-400">
                    → <strong className="text-zinc-100">{data.estimatedRows.toLocaleString()}</strong> training rows
                  </div>
                )}
                <div className="text-xs text-zinc-500">Showing preview of first 20 rows.</div>
              </div>
            ) : null}
          </div>

          {data?.wide && <ExportPreview title="labels_wide.csv (preview)" csv={data.wide} />}
          {data?.long && <ExportPreview title="labels_long.csv (preview)" csv={data.long} />}
        </div>
      </div>
    </div>
  );
}

function buildQS(f: ExportFilterState): string {
  const qs = new URLSearchParams();
  if (f.statuses.length) qs.set("statuses", f.statuses.join(","));
  if (f.categories.length) qs.set("categories", f.categories.join(","));
  if (f.from) qs.set("from", f.from);
  if (f.to) qs.set("to", f.to);
  qs.set("format", f.format);
  if (f.includeMedia) qs.set("includeMedia", "1");
  return qs.toString();
}
