export function StatsCard({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  tone?: "neutral" | "accent" | "success" | "warning" | "danger";
}) {
  const toneCls =
    tone === "accent" ? "text-accent" :
    tone === "success" ? "text-emerald-400" :
    tone === "warning" ? "text-amber-400" :
    tone === "danger" ? "text-red-400" :
    "text-zinc-100";
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-2 text-3xl font-semibold ${toneCls}`}>{value}</p>
    </div>
  );
}
