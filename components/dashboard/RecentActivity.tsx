"use client";

import Link from "next/link";
import { Badge } from "@/components/ui/Badge";

interface Activity {
  id: string;
  originalName: string;
  kind: "IMAGE" | "VIDEO";
  status: string;
  reviewedAt: string | null;
  labels: string[];
  url: string;
  timeSec: number;
}

export function RecentActivity({ items }: { items: Activity[] }) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <h2 className="mb-3 text-sm font-semibold">Recent activity</h2>
      {items.length === 0 ? (
        <p className="text-sm text-zinc-500">No reviewed frames yet.</p>
      ) : (
        <ul className="divide-y divide-zinc-900">
          {items.map((it) => (
            <li key={it.id} className="flex items-center gap-3 py-2">
              <div className="h-10 w-16 shrink-0 overflow-hidden rounded bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.url} alt="" className="h-full w-full object-cover" />
              </div>
              <div className="min-w-0 flex-1">
                <Link href={`/review/${it.id}`} className="block truncate text-sm hover:text-accent">
                  {it.originalName}
                  {it.kind === "VIDEO" && (
                    <span className="ml-1 text-xs text-zinc-500">@ {formatTime(it.timeSec)}</span>
                  )}
                </Link>
                <p className="truncate text-xs text-zinc-500">
                  {it.reviewedAt ? new Date(it.reviewedAt).toLocaleString() : ""} • {it.labels.length} labels
                </p>
              </div>
              <Badge tone={it.status === "REVIEWED" ? "success" : it.status === "FLAGGED" ? "danger" : "warning"}>
                {it.status}
              </Badge>
            </li>
          ))}
        </ul>
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
