// ONNX inference is not used in this deployment. Use Grok via /api/grok-tag instead.

export interface Prediction { label: string; prob: number }

export async function predictImageBuffer(): Promise<Prediction[]> {
  throw new Error("ONNX inference not available.");
}

export async function predictVideoFile(): Promise<Prediction[]> {
  throw new Error("ONNX inference not available.");
}
