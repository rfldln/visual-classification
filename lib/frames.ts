// Server-side FFmpeg frame extraction is not used in this deployment.
// Video thumbnails are extracted client-side (browser <video> + <canvas>).

export async function extractFramesByInterval(): Promise<never[]> {
  throw new Error("Server-side FFmpeg not available.");
}

export async function probeMedia(): Promise<{ duration: number | null; width: number | null; height: number | null }> {
  throw new Error("Server-side FFprobe not available.");
}

export async function extractThumbnail(): Promise<void> {
  throw new Error("Server-side FFmpeg not available.");
}

export async function makeTempDir(_prefix?: string): Promise<string> {
  throw new Error("Not available.");
}

export async function rmDir(_dir: string): Promise<void> {
  throw new Error("Not available.");
}
