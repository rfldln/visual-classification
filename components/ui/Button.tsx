"use client";

import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "secondary" | "danger" | "ghost";
type Size = "sm" | "md" | "lg";

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  children: ReactNode;
}

export function Button({ variant = "secondary", size = "md", className, children, ...rest }: Props) {
  return (
    <button
      {...rest}
      className={clsx(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" && "px-3 py-1.5 text-sm",
        size === "md" && "px-4 py-2 text-sm",
        size === "lg" && "px-5 py-2.5 text-base",
        variant === "primary" && "bg-accent text-white hover:bg-accent-hover",
        variant === "secondary" && "bg-zinc-800 text-zinc-100 hover:bg-zinc-700 border border-zinc-700",
        variant === "danger" && "bg-red-700 text-white hover:bg-red-600",
        variant === "ghost" && "text-zinc-300 hover:bg-zinc-800",
        className,
      )}
    >
      {children}
    </button>
  );
}
