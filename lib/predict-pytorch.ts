// PyTorch inference is not used in this deployment. Use Grok via /api/grok-tag instead.

import type { Prediction } from "./predict";

export function isPyTorchBackend(): boolean {
  return false;
}

export async function predictFileWithPyTorch(): Promise<{ predictions: Prediction[]; frames?: number }> {
  throw new Error("PyTorch inference not available.");
}
