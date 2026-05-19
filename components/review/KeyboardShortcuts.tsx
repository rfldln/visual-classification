"use client";

import { useEffect } from "react";
import { CATEGORIES, CATEGORY_SHORTCUTS, type CategoryId } from "@/lib/taxonomy";
import { useReviewStore } from "@/store/reviewStore";

interface Props {
  onSave: () => void;
  onSkip: () => void;
  onFlag: () => void;
  onPrev: () => void;
  onNext?: () => void;
}

export function KeyboardShortcuts({ onSave, onSkip, onFlag, onPrev, onNext }: Props) {
  const toggle = useReviewStore((s) => s.toggleLabel);

  useEffect(() => {
    const reverse: Record<string, CategoryId> = {};
    for (const c of CATEGORIES) {
      const k = CATEGORY_SHORTCUTS[c.id as CategoryId];
      if (k) reverse[k.toLowerCase()] = c.id as CategoryId;
    }

    function handler(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable) return;

      const k = e.key.toLowerCase();

      if (k === "enter" || e.key === " ") {
        e.preventDefault();
        onSave();
        return;
      }
      if (k === "s") { e.preventDefault(); onSkip(); return; }
      if (k === "f") { e.preventDefault(); onFlag(); return; }
      if (e.key === "ArrowLeft") { e.preventDefault(); onPrev(); return; }
      if (e.key === "ArrowRight") { e.preventDefault(); onNext?.(); return; }

      const cat = reverse[k];
      if (cat) {
        e.preventDefault();
        toggle(cat);
      }
    }

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onSave, onSkip, onFlag, onPrev, onNext, toggle]);

  return null;
}
