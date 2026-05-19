"use client";

import { useEffect } from "react";
import { useUploadStore, type UploadItem } from "@/store/uploadStore";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";

/** 50 MB chunk size — small enough to retry cheaply, big enough to keep overhead low. */
const CHUNK_SIZE = 50 * 1024 * 1024;

function postChunk(
  blob: Blob,
  headers: Record<string, string>,
  onProgress: (loadedInChunk: number) => void,
): Promise<{ uploaded?: { id: string }[] }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload/chunk");
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
      } else {
        reject(new Error(`HTTP ${xhr.status}: ${xhr.responseText}`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.ontimeout = () => reject(new Error("Chunk timed out"));
    xhr.send(blob);
  });
}

async function uploadOne(
  item: UploadItem,
  onProgress: (p: number) => void,
): Promise<{ id?: string }> {
  const file = item.file;
  const totalSize = file.size;
  const totalChunks = Math.max(1, Math.ceil(totalSize / CHUNK_SIZE));
  const uploadId =
    (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID().replace(/-/g, "")
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  const filenameHeader = encodeURIComponent(file.name);
  const mimeType = file.type || "application/octet-stream";

  let bytesUploaded = 0;
  let lastResponse: { uploaded?: { id: string }[] } = {};

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, totalSize);
    const chunk = file.slice(start, end);
    const baseLoaded = bytesUploaded;

    lastResponse = await postChunk(
      chunk,
      {
        "Content-Type": "application/octet-stream",
        "x-upload-id": uploadId,
        "x-chunk-index": String(i),
        "x-total-chunks": String(totalChunks),
        "x-total-size": String(totalSize),
        "x-filename": filenameHeader,
        "x-mime-type": mimeType,
      },
      (loadedInChunk) => {
        const loaded = baseLoaded + loadedInChunk;
        onProgress(Math.min(100, Math.round((loaded / totalSize) * 100)));
      },
    );

    bytesUploaded = end;
    onProgress(Math.round((bytesUploaded / totalSize) * 100));
  }

  return { id: lastResponse.uploaded?.[0]?.id };
}

export function UploadQueue() {
  const items = useUploadStore((s) => s.items);
  const update = useUploadStore((s) => s.update);
  const clear = useUploadStore((s) => s.clearCompleted);

  useEffect(() => {
    const queued = items.filter((i) => i.status === "queued");
    // Sequential upload (simple, predictable). Could be parallel w/ a concurrency cap.
    (async () => {
      for (const it of queued) {
        update(it.id, { status: "uploading", progress: 0 });
        try {
          const r = await uploadOne(it, (p) => update(it.id, { progress: p }));
          update(it.id, { status: "done", progress: 100, serverId: r.id });
        } catch (e) {
          update(it.id, { status: "error", error: (e as Error).message });
        }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  if (items.length === 0) return null;

  return (
    <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-2">
        <h2 className="text-sm font-semibold">Upload queue ({items.length})</h2>
        <Button variant="ghost" size="sm" onClick={clear}>Clear completed</Button>
      </div>
      <ul className="divide-y divide-zinc-900">
        {items.map((it) => (
          <li key={it.id} className="flex items-center gap-3 px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="truncate text-sm">{it.file.name}</p>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded bg-zinc-800">
                <div
                  className={`h-full transition-all ${it.status === "error" ? "bg-red-500" : "bg-accent"}`}
                  style={{ width: `${it.progress}%` }}
                />
              </div>
              {it.error && <p className="mt-1 text-xs text-red-400">{it.error}</p>}
            </div>
            <div className="w-24 text-right">
              {it.status === "done" && <Badge tone="success">Done</Badge>}
              {it.status === "uploading" && <Badge tone="accent">{it.progress}%</Badge>}
              {it.status === "queued" && <Badge>Queued</Badge>}
              {it.status === "error" && <Badge tone="danger">Error</Badge>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
