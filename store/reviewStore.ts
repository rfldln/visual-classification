import { create } from "zustand";
import type { CategoryId } from "@/lib/taxonomy";
import type { FrameDTO } from "@/types";

interface ReviewState {
  currentFrame: FrameDTO | null;
  selectedLabels: Set<CategoryId>;
  stickyLabels: Set<CategoryId>;
  queuePosition: number;
  totalPending: number;
  panelScrollTop: number;
  setCurrentFrame: (frame: FrameDTO | null) => void;
  setQueueInfo: (position: number, total: number) => void;
  toggleLabel: (id: CategoryId) => void;
  setLabels: (ids: CategoryId[]) => void;
  clearLabels: () => void;
  toggleSticky: (id: CategoryId) => void;
  clearSticky: () => void;
  setPanelScrollTop: (n: number) => void;
}

export const useReviewStore = create<ReviewState>((set) => ({
  currentFrame: null,
  selectedLabels: new Set(),
  stickyLabels: new Set(),
  queuePosition: 0,
  totalPending: 0,
  panelScrollTop: 0,
  setCurrentFrame: (frame) =>
    set((s) => ({
      currentFrame: frame,
      selectedLabels: new Set([...(frame?.labels ?? []), ...s.stickyLabels]),
    })),
  setQueueInfo: (queuePosition, totalPending) => set({ queuePosition, totalPending }),
  toggleLabel: (id) =>
    set((s) => {
      const next = new Set(s.selectedLabels);
      if (next.has(id)) {
        next.delete(id);
        const nextSticky = new Set(s.stickyLabels);
        nextSticky.delete(id);
        return { selectedLabels: next, stickyLabels: nextSticky };
      }
      next.add(id);
      return { selectedLabels: next };
    }),
  setLabels: (ids) => set({ selectedLabels: new Set(ids) }),
  clearLabels: () => set({ selectedLabels: new Set() }),
  toggleSticky: (id) =>
    set((s) => {
      const next = new Set(s.stickyLabels);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return { stickyLabels: next };
    }),
  clearSticky: () => set({ stickyLabels: new Set() }),
  setPanelScrollTop: (n) => set({ panelScrollTop: n }),
}));
