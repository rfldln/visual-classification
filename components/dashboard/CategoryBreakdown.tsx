"use client";

import { CATEGORIES } from "@/lib/taxonomy";

export function CategoryBreakdown({ counts }: { counts: Record<string, number> }) {
  const max = Math.max(1, ...Object.values(counts));
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <h2 className="mb-3 text-sm font-semibold">Items per category</h2>
      <ul className="space-y-2">
        {CATEGORIES.map((c) => {
          const v = counts[c.id] ?? 0;
          const pct = (v / max) * 100;
          return (
            <li key={c.id} className="flex items-center gap-3 text-sm">
              <span className="w-24 shrink-0 text-zinc-300">{c.label}</span>
              <div className="relative h-2 flex-1 overflow-hidden rounded bg-zinc-800">
                <div className="h-full bg-accent" style={{ width: `${pct}%` }} />
              </div>
              <span className="w-12 shrink-0 text-right text-xs text-zinc-400">{v}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
