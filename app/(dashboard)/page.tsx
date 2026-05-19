"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { StatsCard } from "@/components/dashboard/StatsCard";
import { Badge } from "@/components/ui/Badge";
import { CATEGORIES } from "@/lib/taxonomy";

interface Stats {
  totalItems: number;
  images: number;
  videos: number;
  totalBytes: number;
  autoTag: {
    pending: number;
    processing: number;
    done: number;
    failed: number;
    skipped: number;
  };
  topTags: { id: string; count: number }[];
  recent: {
    id: string;
    originalName: string;
    kind: "IMAGE" | "VIDEO";
    uploadedAt: string;
    autoTags: string[];
    autoTagStatus: string;
    thumbnailUrl: string;
  }[];
}

function formatBytes(n: number) {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} GB`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)} MB`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)} KB`;
  return `${n} B`;
}

function tagLabel(id: string) {
  return CATEGORIES.find((c) => c.id === id)?.label ?? id;
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["stats"],
    queryFn: async () => (await fetch("/api/stats")).json() as Promise<Stats>,
    refetchInterval: 5000,
  });

  if (isLoading || !data) {
    return <div className="p-6 text-sm text-zinc-500">Loading…</div>;
  }

  const taggedPct = data.totalItems > 0
    ? Math.round((data.autoTag.done / data.totalItems) * 100)
    : 0;
  const topMax = Math.max(1, ...data.topTags.map((t) => t.count));

  return (
    <div className="space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-zinc-500">Your vault at a glance. Grok-generated tags update live.</p>
      </header>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatsCard label="Total items" value={data.totalItems} />
        <StatsCard label="Images" value={data.images} />
        <StatsCard label="Videos" value={data.videos} tone="accent" />
        <StatsCard label="Storage used" value={formatBytes(data.totalBytes)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Auto-tag status</h2>
            <span className="text-xs text-zinc-500">{taggedPct}% tagged</span>
          </div>
          <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-5">
            <StatusPill label="Tagged" value={data.autoTag.done} tone="success" />
            <StatusPill label="Processing" value={data.autoTag.processing} tone="accent" />
            <StatusPill label="Queued" value={data.autoTag.pending} />
            <StatusPill label="Failed" value={data.autoTag.failed} tone="danger" />
            <StatusPill label="Skipped" value={data.autoTag.skipped} />
          </ul>
          <div className="mt-4 h-2 overflow-hidden rounded bg-zinc-800">
            <div className="h-full bg-emerald-500" style={{ width: `${taggedPct}%` }} />
          </div>
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
          <h2 className="mb-3 text-sm font-semibold">Top tags</h2>
          {data.topTags.length === 0 ? (
            <p className="text-sm text-zinc-500">
              No tags yet — upload something to <Link className="underline" href="/vault">your vault</Link>.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.topTags.map((t) => {
                const pct = (t.count / topMax) * 100;
                return (
                  <li key={t.id} className="flex items-center gap-3 text-sm">
                    <span className="w-24 shrink-0 truncate text-zinc-300" title={tagLabel(t.id)}>
                      {tagLabel(t.id)}
                    </span>
                    <div className="relative h-2 flex-1 overflow-hidden rounded bg-zinc-800">
                      <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-10 shrink-0 text-right text-xs text-zinc-400">{t.count}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Recent uploads</h2>
          <Link href="/vault" className="text-xs text-zinc-400 hover:text-zinc-100">
            View vault →
          </Link>
        </div>
        {data.recent.length === 0 ? (
          <p className="text-sm text-zinc-500">Nothing in the vault yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-900">
            {data.recent.map((it) => (
              <li key={it.id} className="flex items-center gap-3 py-2">
                <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-black">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={it.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-zinc-200" title={it.originalName}>
                    {it.originalName}
                  </p>
                  <p className="truncate text-xs text-zinc-500">
                    {new Date(it.uploadedAt).toLocaleString()}
                    {it.autoTags.length > 0 && (
                      <> • {it.autoTags.map(tagLabel).join(", ")}</>
                    )}
                  </p>
                </div>
                <Badge tone={it.kind === "VIDEO" ? "accent" : "neutral"}>{it.kind}</Badge>
                <Badge
                  tone={
                    it.autoTagStatus === "DONE"
                      ? "success"
                      : it.autoTagStatus === "FAILED"
                        ? "danger"
                        : it.autoTagStatus === "PROCESSING"
                          ? "accent"
                          : "neutral"
                  }
                >
                  {it.autoTagStatus}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function StatusPill({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "accent" | "success" | "danger";
}) {
  const cls =
    tone === "success" ? "text-emerald-400" :
    tone === "accent" ? "text-accent" :
    tone === "danger" ? "text-red-400" :
    "text-zinc-200";
  return (
    <li className="rounded bg-zinc-900 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold ${cls}`}>{value}</p>
    </li>
  );
}
