"use client";

/**
 * Browser-side video helpers. We avoid loading @ffmpeg/ffmpeg unless we have to,
 * since the wasm core is ~25 MB. For metadata + a single thumbnail frame we use
 * a hidden <video> + <canvas> which is built into every browser.
 *
 * Multi-frame extraction (for the Grok Test page) uses the same canvas approach
 * by seeking the video element to evenly spaced timestamps. ffmpeg.wasm is only
 * imported lazily inside `extractFramesAtIntervalFfmpeg` for callers that want
 * higher fidelity later — not used today.
 */

export interface VideoMeta {
  duration: number;
  width: number;
  height: number;
}

export async function probeVideoMeta(file: File): Promise<VideoMeta> {
  const url = URL.createObjectURL(file);
  try {
    return await new Promise<VideoMeta>((resolve, reject) => {
      const v = document.createElement("video");
      v.preload = "metadata";
      v.muted = true;
      v.src = url;
      v.onloadedmetadata = () => {
        resolve({
          duration: Number.isFinite(v.duration) ? v.duration : 0,
          width: v.videoWidth || 0,
          height: v.videoHeight || 0,
        });
      };
      v.onerror = () => reject(new Error("Could not read video metadata"));
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Extracts a single JPEG thumbnail at `timeSec` from a video file using a
 * hidden <video> + <canvas>. Returns a Blob suitable for upload.
 */
export async function extractThumbnail(
  file: File,
  opts: { timeSec?: number; maxWidth?: number; quality?: number } = {},
): Promise<Blob> {
  const timeSec = opts.timeSec ?? 0;
  const maxWidth = opts.maxWidth ?? 512;
  const quality = opts.quality ?? 0.85;

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<Blob>((resolve, reject) => {
      const v = document.createElement("video");
      v.preload = "auto";
      v.muted = true;
      v.playsInline = true;
      v.src = url;

      const cleanup = () => {
        v.removeAttribute("src");
        v.load();
      };

      v.onloadedmetadata = () => {
        const target = Math.min(Math.max(0, timeSec), Math.max(0, (v.duration || 0) - 0.05));
        v.currentTime = target;
      };
      v.onseeked = () => {
        try {
          const w = v.videoWidth;
          const h = v.videoHeight;
          if (!w || !h) {
            cleanup();
            reject(new Error("Video has no displayable frame"));
            return;
          }
          const scale = w > maxWidth ? maxWidth / w : 1;
          const cw = Math.round(w * scale);
          const ch = Math.round(h * scale);
          const canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("No 2d canvas context");
          ctx.drawImage(v, 0, 0, cw, ch);
          canvas.toBlob(
            (blob) => {
              cleanup();
              if (!blob) reject(new Error("toBlob returned null"));
              else resolve(blob);
            },
            "image/jpeg",
            quality,
          );
        } catch (err) {
          cleanup();
          reject(err);
        }
      };
      v.onerror = () => {
        cleanup();
        reject(new Error("Could not load video for thumbnail"));
      };
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Extracts N frames evenly spaced across the video duration, capped at `maxFrames`
 * frames so we don't blow past Grok's image cap. Uses the same hidden-video
 * approach as `extractThumbnail`.
 */
export async function extractFramesEvenly(
  file: File,
  opts: { count?: number; maxWidth?: number; quality?: number } = {},
): Promise<Blob[]> {
  const count = Math.max(1, Math.min(16, opts.count ?? 6));
  const maxWidth = opts.maxWidth ?? 512;
  const quality = opts.quality ?? 0.8;

  const url = URL.createObjectURL(file);
  const blobs: Blob[] = [];
  try {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    v.src = url;

    await new Promise<void>((resolve, reject) => {
      v.onloadedmetadata = () => resolve();
      v.onerror = () => reject(new Error("Could not load video for frame extraction"));
    });
    const dur = Math.max(0.1, v.duration || 0.1);
    const stops = Array.from({ length: count }, (_, i) =>
      Math.min(dur - 0.05, ((i + 0.5) / count) * dur),
    );

    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No 2d canvas context");

    for (const t of stops) {
      await new Promise<void>((resolve, reject) => {
        v.onseeked = () => resolve();
        v.onerror = () => reject(new Error("Seek failed"));
        v.currentTime = t;
      });
      const w = v.videoWidth;
      const h = v.videoHeight;
      const scale = w > maxWidth ? maxWidth / w : 1;
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob null"))),
          "image/jpeg",
          quality,
        ),
      );
      blobs.push(blob);
    }
    v.removeAttribute("src");
    v.load();
  } finally {
    URL.revokeObjectURL(url);
  }
  return blobs;
}
