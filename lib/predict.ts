import path from "path";
import { promises as fs } from "fs";
import os from "os";
import crypto from "crypto";
import { spawn } from "child_process";
import ffmpegStatic from "ffmpeg-static";
import * as ort from "onnxruntime-node";
import sharp from "sharp";

const FFMPEG = (ffmpegStatic as unknown as string) ?? "ffmpeg";

const MODEL_DIR = path.resolve(process.env.MODEL_DIR ?? "./models");
const CLASSES_PATH = path.join(MODEL_DIR, "classes.json");

export interface ClassMeta {
  classes: string[];
  display: Record<string, string>;
  img_size: number;
  mean: [number, number, number];
  std: [number, number, number];
  arch: string;
}

export interface Prediction {
  label: string;       // raw class key
  display: string;     // pretty name
  prob: number;        // 0..1
}

let sessionPromise: Promise<ort.InferenceSession> | null = null;
let metaPromise: Promise<ClassMeta> | null = null;

export function getMeta(): Promise<ClassMeta> {
  if (!metaPromise) {
    metaPromise = fs.readFile(CLASSES_PATH, "utf-8").then((s) => JSON.parse(s));
  }
  return metaPromise;
}

async function resolveModelPath(): Promise<string> {
  // Allow override via env.
  if (process.env.MODEL_PATH) return path.resolve(process.env.MODEL_PATH);
  const meta = await getMeta();
  // Preferred: <arch>_best.onnx (matches the notebook's export).
  const arched = path.join(MODEL_DIR, `${meta.arch}_best.onnx`);
  try { await fs.access(arched); return arched; } catch {}
  // Fallback: any .onnx in MODEL_DIR.
  try {
    const entries = await fs.readdir(MODEL_DIR);
    const onnx = entries.find((e) => e.toLowerCase().endsWith(".onnx"));
    if (onnx) return path.join(MODEL_DIR, onnx);
  } catch {}
  return arched; // will throw ENOENT below with a useful message
}

export function getSession(): Promise<ort.InferenceSession> {
  if (!sessionPromise) {
    sessionPromise = resolveModelPath().then((p) =>
      ort.InferenceSession.create(p, { executionProviders: ["cpu"] }),
    );
  }
  return sessionPromise;
}

/** Resize (stretch) + normalize an image buffer to a Float32 CHW tensor.
 *
 *  Mirrors the notebook's `transforms.Resize((S, S))` + `ToTensor()` + `Normalize`:
 *    - non-uniform stretch to SxS (fit: 'fill', NOT 'cover'),
 *    - bilinear kernel (PIL's default for Resize), NOT sharp's default lanczos3,
 *    - then HWC uint8 -> CHW float / 255 -> (x - mean) / std. */
async function preprocessImage(buf: Buffer, meta: ClassMeta): Promise<Float32Array> {
  const S = meta.img_size;
  const { data, info } = await sharp(buf)
    .rotate()
    .resize(S, S, { fit: "fill", kernel: "cubic" })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.width !== S || info.height !== S || info.channels !== 3) {
    throw new Error(`Unexpected sharp output: ${info.width}x${info.height}x${info.channels}`);
  }

  const out = new Float32Array(3 * S * S);
  const [mR, mG, mB] = meta.mean;
  const [sR, sG, sB] = meta.std;
  // sharp gives HWC uint8; convert to CHW float, normalize.
  for (let i = 0, p = 0; i < S * S; i++, p += 3) {
    const r = data[p] / 255;
    const g = data[p + 1] / 255;
    const b = data[p + 2] / 255;
    out[i] = (r - mR) / sR;
    out[S * S + i] = (g - mG) / sG;
    out[2 * S * S + i] = (b - mB) / sB;
  }
  return out;
}

function softmax(logits: Float32Array | number[]): Float32Array {
  let max = -Infinity;
  for (const v of logits) if (v > max) max = v;
  const exps = new Float32Array(logits.length);
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    exps[i] = Math.exp(logits[i] - max);
    sum += exps[i];
  }
  for (let i = 0; i < exps.length; i++) exps[i] /= sum;
  return exps;
}

function topK(probs: Float32Array, classes: string[], display: Record<string, string>, k: number): Prediction[] {
  const idx = Array.from(probs.keys()).sort((a, b) => probs[b] - probs[a]).slice(0, k);
  return idx.map((i) => ({
    label: classes[i],
    display: display[classes[i]] ?? classes[i],
    prob: probs[i],
  }));
}

async function runInference(tensor: Float32Array, meta: ClassMeta): Promise<Float32Array> {
  const session = await getSession();
  const S = meta.img_size;
  const input = new ort.Tensor("float32", tensor, [1, 3, S, S]);
  const outputs = await session.run({ [session.inputNames[0]]: input });
  const logits = outputs[session.outputNames[0]].data as Float32Array;
  return softmax(logits);
}

export async function predictImageBuffer(buf: Buffer, k = 3): Promise<Prediction[]> {
  const meta = await getMeta();
  const tensor = await preprocessImage(buf, meta);
  const probs = await runInference(tensor, meta);
  return topK(probs, meta.classes, meta.display, k);
}

/** Sample N evenly-spaced frames from a video.
 *
 *  Mirrors the notebook's `cv2.VideoCapture.set(CAP_PROP_POS_FRAMES, i) + cap.read()`,
 *  which on OpenCV's ffmpeg backend is *frame-accurate* (it seeks to the previous
 *  keyframe and forward-decodes to land on exactly frame `i`). We do the same with
 *  ffmpeg's `select='eq(n, i0)+eq(n, i1)+...'` filter: it walks the stream and
 *  emits exactly those frame numbers. PNG output keeps the resize loss-less. */
async function sampleVideoFrames(videoPath: string, numFrames: number): Promise<{ dir: string; files: string[] }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "predict-"));
  const pattern = path.join(dir, "f_%04d.png");
  const ffprobe = FFMPEG.replace(/ffmpeg(\.exe)?$/, "ffprobe$1");

  // Probe nb_frames + duration. count_frames is reliable on mp4s without nb_frames.
  const probeJson = await new Promise<string>((resolve, reject) => {
    const p = spawn(ffprobe, [
      "-v", "error",
      "-select_streams", "v:0",
      "-count_frames",
      "-show_entries", "stream=nb_frames,nb_read_frames,duration:format=duration",
      "-of", "json", videoPath,
    ], { windowsHide: true });
    let out = "";
    p.stdout.on("data", (c) => (out += c.toString()));
    p.on("error", reject);
    p.on("close", () => resolve(out));
  }).catch(() => "");

  let total = NaN;
  try {
    const j = JSON.parse(probeJson);
    const s = j.streams?.[0] ?? {};
    total = parseInt(s.nb_read_frames ?? s.nb_frames ?? "", 10);
  } catch { /* ignore */ }

  if (!Number.isFinite(total) || total <= 0) {
    // Last-resort: fall back to time-based fps sampling at native resolution.
    const args = ["-y", "-i", videoPath, "-vf", `fps=${numFrames}/duration`, "-frames:v", String(numFrames), pattern];
    await new Promise<void>((resolve, reject) => {
      const p = spawn(FFMPEG, args, { windowsHide: true });
      let err = "";
      p.stderr.on("data", (c) => (err += c.toString()));
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-400)}`))));
    });
    const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(dir, f));
    return { dir, files };
  }

  // np.linspace(0, total-1, N) -> integer indices, exactly like the notebook.
  const N = Math.min(numFrames, total);
  const idxs: number[] = [];
  for (let i = 0; i < N; i++) {
    idxs.push(Math.round((i * (total - 1)) / Math.max(N - 1, 1)));
  }

  // Frame-accurate per-frame extraction. We tried a single ffmpeg call with a
  // composite `select=eq(n,i0)+eq(n,i1)+...` expression, but ffmpeg's auto-inserted
  // `d_fps` filter trips on the irregular output timestamps and dies with
  // "Error reinitializing filters! Failed to inject frame into filter network".
  // One invocation per frame avoids that entirely (single-frame output, no fps
  // filter ever gets inserted) and is still frame-accurate via forward-decode.
  const files: string[] = [];
  for (let k = 0; k < idxs.length; k++) {
    const out = path.join(dir, `f_${String(k).padStart(4, "0")}.png`);
    await new Promise<void>((resolve, reject) => {
      const p = spawn(FFMPEG, [
        "-y",
        "-i", videoPath,
        "-vf", `select=eq(n\\,${idxs[k]})`,
        "-vframes", "1",
        "-an",
        out,
      ], { windowsHide: true });
      let err = "";
      p.stderr.on("data", (c) => (err += c.toString()));
      p.on("error", reject);
      p.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${err.slice(-400)}`))));
    });
    try { await fs.access(out); files.push(out); } catch { /* skip */ }
  }

  return { dir, files };
}

export async function predictVideoFile(videoPath: string, k = 3, numFrames = 16): Promise<Prediction[]> {
  const meta = await getMeta();
  const { dir, files } = await sampleVideoFrames(videoPath, numFrames);
  try {
    if (files.length === 0) throw new Error("No frames extracted from video");
    const accum = new Float32Array(meta.classes.length);
    for (const f of files) {
      const buf = await fs.readFile(f);
      const tensor = await preprocessImage(buf, meta);
      const probs = await runInference(tensor, meta);
      for (let i = 0; i < accum.length; i++) accum[i] += probs[i];
    }
    for (let i = 0; i < accum.length; i++) accum[i] /= files.length;
    return topK(accum, meta.classes, meta.display, k);
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Save a Buffer to a temp file for ffmpeg to read; caller must clean up. */
export async function bufferToTempFile(buf: Buffer, ext: string): Promise<string> {
  const name = crypto.randomBytes(8).toString("hex") + ext;
  const p = path.join(os.tmpdir(), name);
  await fs.writeFile(p, buf);
  return p;
}
