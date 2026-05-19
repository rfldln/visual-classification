import { create } from "zustand";

export interface UploadItem {
  id: string;           // client-side id
  file: File;
  progress: number;     // 0..100
  status: "queued" | "uploading" | "done" | "error";
  error?: string;
  serverId?: string;
}

interface UploadState {
  items: UploadItem[];
  addFiles: (files: File[]) => void;
  update: (id: string, patch: Partial<UploadItem>) => void;
  remove: (id: string) => void;
  clearCompleted: () => void;
}

export const useUploadStore = create<UploadState>((set) => ({
  items: [],
  addFiles: (files) =>
    set((s) => ({
      items: [
        ...s.items,
        ...files.map((file) => ({
          id: crypto.randomUUID(),
          file,
          progress: 0,
          status: "queued" as const,
        })),
      ],
    })),
  update: (id, patch) =>
    set((s) => ({
      items: s.items.map((it) => (it.id === id ? { ...it, ...patch } : it)),
    })),
  remove: (id) => set((s) => ({ items: s.items.filter((it) => it.id !== id) })),
  clearCompleted: () =>
    set((s) => ({ items: s.items.filter((it) => it.status !== "done") })),
}));
