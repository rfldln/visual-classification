"use client";

import { useCallback, useState } from "react";
import clsx from "clsx";
import { useUploadStore } from "@/store/uploadStore";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,video/mp4,video/quicktime,video/webm";

export function DropZone({ onAdd }: { onAdd?: (files: File[]) => void }) {
  const addFiles = useUploadStore((s) => s.addFiles);
  const [over, setOver] = useState(false);

  const accept = useCallback(
    (fl: FileList | File[]) => {
      const files = Array.from(fl);
      addFiles(files);
      onAdd?.(files);
    },
    [addFiles, onAdd],
  );

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (e.dataTransfer.files) accept(e.dataTransfer.files);
      }}
      className={clsx(
        "flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed p-12 text-center transition-colors",
        over ? "border-accent bg-accent/10" : "border-zinc-800 bg-zinc-950 hover:border-zinc-700",
      )}
    >
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mb-4 text-zinc-500">
        <path d="M4 14.9A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.24" />
        <polyline points="12 12 12 21" />
        <polyline points="16 16 12 12 8 16" />
      </svg>
      <p className="font-medium text-zinc-200">Drop files here or click to browse</p>
      <p className="mt-1 text-xs text-zinc-500">Images: JPG, PNG, WEBP, GIF &nbsp;•&nbsp; Videos: MP4, MOV, WEBM</p>
      <input
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => e.target.files && accept(e.target.files)}
      />
    </label>
  );
}
