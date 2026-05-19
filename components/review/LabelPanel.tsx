"use client";

import { useEffect, useRef } from "react";
import clsx from "clsx";
import { CATEGORIES, CATEGORY_GROUPS, CATEGORY_SHORTCUTS, type CategoryId } from "@/lib/taxonomy";
import { useReviewStore } from "@/store/reviewStore";

function PinIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5v6h2v-6h5v-2l-2-2z" />
    </svg>
  );
}

export function LabelPanel() {
  const selected = useReviewStore((s) => s.selectedLabels);
  const sticky = useReviewStore((s) => s.stickyLabels);
  const toggle = useReviewStore((s) => s.toggleLabel);
  const toggleSticky = useReviewStore((s) => s.toggleSticky);
  const panelScrollTop = useReviewStore((s) => s.panelScrollTop);
  const setPanelScrollTop = useReviewStore((s) => s.setPanelScrollTop);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = panelScrollTop;
    // only on mount for this item
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => setPanelScrollTop((e.target as HTMLDivElement).scrollTop)}
      className="h-full overflow-y-auto p-4 space-y-6"
    >
      {CATEGORY_GROUPS.map((group) => {
        const cats = CATEGORIES.filter((c) => c.group === group.key);
        if (cats.length === 0) return null;
        return (
          <section key={group.key}>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">
              {group.label}
            </h3>
            <div className="grid grid-cols-1 gap-2">
              {cats.map((c) => {
                const isSel = selected.has(c.id);
                const isSticky = sticky.has(c.id);
                return (
                  <button
                    type="button"
                    key={c.id}
                    onClick={() => toggle(c.id as CategoryId)}
                    className={clsx(
                      "flex items-start gap-3 rounded-md border p-3 text-left transition-colors",
                      isSel
                        ? "border-accent bg-accent/15 text-white"
                        : "border-zinc-800 bg-zinc-900 hover:border-zinc-700 hover:bg-zinc-800",
                    )}
                  >
                    <div
                      className={clsx(
                        "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border",
                        isSel ? "border-accent bg-accent text-white" : "border-zinc-600",
                      )}
                    >
                      {isSel && (
                        <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 011.4-1.4L8.5 12l6.8-6.7a1 1 0 011.4 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                    <div className="flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="font-medium">{c.label}</span>
                        <div className="flex items-center gap-1.5">
                          {isSel && (
                            <span
                              role="button"
                              tabIndex={-1}
                              title={isSticky ? "Unpin — stop auto-tagging" : "Pin — auto-tag every next frame"}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSticky(c.id as CategoryId);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" || e.key === " ") {
                                  e.stopPropagation();
                                  toggleSticky(c.id as CategoryId);
                                }
                              }}
                              className={clsx(
                                "rounded p-0.5 transition-colors",
                                isSticky
                                  ? "text-amber-400 hover:text-amber-300"
                                  : "text-zinc-500 hover:text-zinc-300",
                              )}
                            >
                              <PinIcon />
                            </span>
                          )}
                          <kbd className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                            {CATEGORY_SHORTCUTS[c.id as CategoryId]}
                          </kbd>
                        </div>
                      </div>
                      <p className="text-xs text-zinc-400">{c.description}</p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
