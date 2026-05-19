import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import ffmpegStatic from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const FFMPEG = (ffmpegStatic as unknown as string) ?? "ffmpeg";
const FFPROBE = ffprobeStatic.path ?? "ffprobe";

export interface FrameInfo {
  /** Absolute path to the extracted JPEG on disk. */
  path: string;
  /** Timestamp in the source video, seconds. */
  timestampSec: number;
  /** 0-based index within the extracted set. */
  index: number;
}

function run(bin: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    p.stdout.on("data", (c) => (stdout += c.toString()));
    p.stderr.on("data", (c) => (stderr += c.toString()));
    p.on("error", reject);
    p.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${path.basename(bin)} exited ${code}: ${stderr}`));
    });
  });
}

/** Probe duration (seconds) of a media file using ffprobe. */
export async function getDuration(file: string): Promise<number> {
  const { stdout } = await run(FFPROBE, [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1",
    file,
  ]);
  const d = parseFloat(stdout.trim());
  if (!isFinite(d) || d <= 0) throw new Error("Could not read duration");
  return d;
}

/** Extract a single thumbnail JPEG from a video at the given timestamp. */
export async function extractThumbnail(
  videoPath: string,
  outPath: string,
  opts: { width?: number; timeSec?: number } = {},
): Promise<void> {
  const width   = opts.width   ?? 512;
  const timeSec = opts.timeSec ?? 0;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await run(FFMPEG, [
    "-ss", String(timeSec),
    "-i",  videoPath,
    "-vframes", "1",
    "-vf", `scale=${width}:-2`,
    "-q:v", "3",
    "-y",
    outPath,
  ]);
}

/** Probe dimensions + duration for an image or video via ffprobe. */
export async function probeMedia(file: string): Promise<{
  width: number | null;
  height: number | null;
  duration: number | null;
}> {
  try {
    const { stdout } = await run(FFPROBE, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height:format=duration",
      "-of", "default=noprint_wrappers=1",
      file,
    ]);
    const out: Record<string, string> = {};
    for (const line of stdout.split(/\r?\n/)) {
      const [k, v] = line.split("=");
      if (k && v != null) out[k.trim()] = v.trim();
    }
    const w = parseInt(out.width, 10);
    const h = parseInt(out.height, 10);
    const d = parseFloat(out.duration);
    return {
      width: Number.isFinite(w) ? w : null,
      height: Number.isFinite(h) ? h : null,
      duration: Number.isFinite(d) && d > 0 ? d : null,
    };
  } catch {
    return { width: null, height: null, duration: null };
  }
}

/**
 * Extract one frame every `intervalSec` seconds from a video as JPEGs in a
 * SINGLE ffmpeg pass. Dramatically faster than seeking N times for long videos
 * (a 3-hour file goes from ~25 min to ~2 min on typical hardware).
 *
 * Caller is responsible for cleaning up `outDir` when done.
 */
export async function extractFramesByInterval(
  videoPath: string,
  outDir: string,
  intervalSec: number,
  opts: { width?: number; quality?: number; maxFrames?: number } = {},
): Promise<FrameInfo[]> {
  if (intervalSec <= 0) return [];
  const duration = await getDuration(videoPath);
  const expected = Math.max(1, Math.floor(duration / intervalSec));
  const maxFrames = opts.maxFrames ?? 2000;

  // If the video is so long we'd produce more than `maxFrames`, stretch the
  // interval so we still get even coverage without thousands of JPEGs.
  const effectiveInterval = expected > maxFrames ? duration / maxFrames : intervalSec;
  const targetCount = Math.min(expected, maxFrames);

  await fs.mkdir(outDir, { recursive: true });
  const width = opts.width ?? 512;
  const quality = opts.quality ?? 3;
  const pattern = path.join(outDir, "f_%05d.jpg");

  const t0 = Date.now();
  console.log(
    `[frames] start: ${path.basename(videoPath)} ` +
    `dur=${duration.toFixed(1)}s interval=${effectiveInterval.toFixed(2)}s ` +
    `target≈${targetCount} frames`,
  );

  // Single decode pass: `fps=1/N` outputs one frame every N seconds.
  await run(FFMPEG, [
    "-y",
    "-i", videoPath,
    "-vf", `fps=1/${effectiveInterval},scale='min(${width},iw)':-2`,
    "-q:v", String(quality),
    "-vsync", "vfr",
    pattern,
  ]);

  // Read what ffmpeg actually produced (may differ slightly from target).
  const files = (await fs.readdir(outDir))
    .filter((n) => /^f_\d{5}\.jpg$/.test(n))
    .sort();

  const frames: FrameInfo[] = files.map((name, i) => ({
    path: path.join(outDir, name),
    // ffmpeg fps filter places frame i at t = (i + 0.5) * interval (approx).
    timestampSec: (i + 0.5) * effectiveInterval,
    index: i,
  }));

  console.log(
    `[frames] done:  ${path.basename(videoPath)} ` +
    `produced=${frames.length} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  return frames;
}

/**
 * Extract `count` uniformly-spaced frames from a video as JPEGs.
 * Frames are deterministic: same video + same count = same frames.
 * Caller is responsible for cleaning up `outDir` when done.
 */
export async function extractFrames(
  videoPath: string,
  outDir: string,
  count: number,
  opts: { width?: number; quality?: number } = {},
): Promise<FrameInfo[]> {
  if (count < 1) return [];
  const duration = await getDuration(videoPath);
  await fs.mkdir(outDir, { recursive: true });

  // Place frames at the middle of N equal slices — avoids black frames at start/end.
  const step = duration / count;
  const timestamps = Array.from({ length: count }, (_, i) => step * (i + 0.5));

  const width = opts.width ?? 512;
  const quality = opts.quality ?? 3; // ffmpeg -q:v range 2..31, lower = better

  const frames: FrameInfo[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const t = timestamps[i];
    const outPath = path.join(outDir, `f_${String(i).padStart(3, "0")}.jpg`);
    // `-ss` before `-i` enables fast keyframe seeking.
    await run(FFMPEG, [
      "-y",
      "-ss", t.toFixed(3),
      "-i", videoPath,
      "-frames:v", "1",
      "-vf", `scale='min(${width},iw)':-2`,
      "-q:v", String(quality),
      outPath,
    ]);
    frames.push({ path: outPath, timestampSec: t, index: i });
  }
  return frames;
}

/** Make a unique scratch directory inside the OS temp dir. */
export async function makeTempDir(prefix = "labeling-frames-"): Promise<string> {
  const dir = path.join(os.tmpdir(), prefix + crypto.randomBytes(6).toString("hex"));
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export async function rmDir(dir: string): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}
