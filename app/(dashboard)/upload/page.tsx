"use client";

import { DropZone } from "@/components/upload/DropZone";
import { UploadQueue } from "@/components/upload/UploadQueue";
import { useQuery } from "@tanstack/react-query";

interface Stats { total: number; pending: number; totalBytes: number }

export default function UploadPage() {
  const { data } = useQuery({
    queryKey: ["stats"],
    queryFn: async () => (await fetch("/api/stats")).json() as Promise<Stats>,
    refetchInterval: 4000,
  });

  return (
    <div className="p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold">Upload</h1>
        <p className="text-sm text-zinc-500">Add images and videos to the review queue.</p>
      </header>

      <DropZone />
      <UploadQueue />

      {data && (
        <div className="mt-6 grid grid-cols-3 gap-4 text-sm">
          <Stat label="Total items" value={data.total.toLocaleString()} />
          <Stat label="Pending review" value={data.pending.toLocaleString()} />
          <Stat label="Storage used" value={formatBytes(data.totalBytes)} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="mt-1 text-xl font-semibold text-zinc-100">{value}</p>
    </div>
  );
}

function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
