"use client";

import { CATEGORIES } from "@/lib/taxonomy";

export interface ExportFilterState {
  statuses: string[];
  categories: string[];
  from: string;
  to: string;
  format: "long" | "wide" | "both";
  includeMedia: boolean;
}

export function ExportFilters({
  value,
  onChange,
}: {
  value: ExportFilterState;
  onChange: (v: ExportFilterState) => void;
}) {
  const toggle = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  return (
    <div className="space-y-5 rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Status</h3>
        <div className="flex flex-wrap gap-2">
          {["REVIEWED", "FLAGGED", "SKIPPED"].map((s) => (
            <label key={s} className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm">
              <input
                type="checkbox"
                checked={value.statuses.includes(s)}
                onChange={() => onChange({ ...value, statuses: toggle(value.statuses, s) })}
              />
              {s}
            </label>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Categories (optional filter)</h3>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {CATEGORIES.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={value.categories.includes(c.id)}
                onChange={() => onChange({ ...value, categories: toggle(value.categories, c.id) })}
              />
              {c.label}
            </label>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-4">
        <label className="text-xs text-zinc-400">
          <span className="mb-1 block">From (reviewed date)</span>
          <input
            type="date"
            value={value.from}
            onChange={(e) => onChange({ ...value, from: e.target.value })}
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-accent"
          />
        </label>
        <label className="text-xs text-zinc-400">
          <span className="mb-1 block">To</span>
          <input
            type="date"
            value={value.to}
            onChange={(e) => onChange({ ...value, to: e.target.value })}
            className="w-full rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-100 outline-none focus:border-accent"
          />
        </label>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Format</h3>
        <div className="flex gap-2">
          {(["long", "wide", "both"] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => onChange({ ...value, format: f })}
              className={`rounded border px-3 py-1.5 text-sm ${value.format === f ? "border-accent bg-accent/15 text-white" : "border-zinc-800 bg-zinc-900 text-zinc-300"}`}
            >
              {f}
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-3 rounded border border-zinc-800 bg-zinc-900/50 p-3">
        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={value.includeMedia}
            onChange={(e) => onChange({ ...value, includeMedia: e.target.checked })}
          />
          <span>
            <span className="block font-medium text-zinc-100">Bundle media in zip</span>
            <span className="block text-xs text-zinc-500">
              Copies every included frame into <code>media/&lt;id&gt;.jpg</code>. Frames were already extracted at upload time.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}
