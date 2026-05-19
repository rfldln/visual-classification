import path from "path";
import { spawn } from "child_process";
import type { Prediction } from "./predict";

const MODEL_DIR = path.resolve(process.env.MODEL_DIR ?? "./checkpoint");
const SCRIPT_PATH = path.resolve("scripts/predict_with_pt.py");
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export function isPyTorchBackend(): boolean {
  const backend = (process.env.PREDICT_BACKEND ?? process.env.MODEL_BACKEND ?? "onnx").toLowerCase();
  return ["pt", "torch", "pytorch"].includes(backend);
}

function pythonExecutable(): string {
  return process.env.PYTHON_EXECUTABLE ?? process.env.PYTHON ?? "python";
}

function pytorchModelPath(): string | undefined {
  return process.env.PYTORCH_MODEL_PATH
    ?? process.env.PT_MODEL_PATH
    ?? (process.env.MODEL_PATH?.toLowerCase().endsWith(".pt") ? process.env.MODEL_PATH : undefined);
}

interface PyTorchPayload {
  kind: "image" | "video";
  frames?: number;
  predictions: Prediction[];
}

export async function predictFileWithPyTorch(
  filePath: string,
  kind: "image" | "video",
  topK: number,
  numFrames = 16,
  frameInterval: number = 5,
): Promise<PyTorchPayload> {
  const args = [
    SCRIPT_PATH,
    "--file", filePath,
    "--kind", kind,
    "--top-k", String(topK),
    "--num-frames", String(numFrames),
    "--model-dir", MODEL_DIR,
    "--frame-interval", String(frameInterval),
    "--device", process.env.PREDICT_DEVICE ?? "auto",   // auto-detects CUDA when present
  ];

  const modelPath = pytorchModelPath();
  if (modelPath) args.push("--model-path", path.resolve(modelPath));

  const timeoutMs = Number(process.env.PYTORCH_TIMEOUT_MS) || DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn(pythonExecutable(), args, {
      windowsHide: true,
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`PyTorch inference timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `PyTorch inference failed with exit code ${code}`));
        return;
      }
      try {
        const payload = JSON.parse(stdout.trim()) as PyTorchPayload;
        resolve(payload);
      } catch {
        reject(new Error(`PyTorch inference returned invalid JSON: ${stdout.slice(0, 500)}`));
      }
    });
  });
}