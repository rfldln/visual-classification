import clsx from "clsx";
import type { ReactNode } from "react";

type Tone = "neutral" | "accent" | "success" | "warning" | "danger";

export function Badge({ children, tone = "neutral", className }: { children: ReactNode; tone?: Tone; className?: string }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "neutral" && "bg-zinc-800 text-zinc-300",
        tone === "accent" && "bg-accent/20 text-accent",
        tone === "success" && "bg-emerald-900/40 text-emerald-300",
        tone === "warning" && "bg-amber-900/40 text-amber-300",
        tone === "danger" && "bg-red-900/40 text-red-300",
        className,
      )}
    >
      {children}
    </span>
  );
}
