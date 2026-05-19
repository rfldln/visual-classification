from __future__ import annotations

import argparse
import json
import mimetypes
import os
import sys
from pathlib import Path
from typing import Any

import numpy as np
import torch
import torch.nn as nn
import torchvision.transforms.functional as TF
from PIL import Image
from torchvision import models, transforms


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp"}
VIDEO_EXTS = {".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"}

# Minimum fraction of frames that must individually score >= FRAME_VOTE_PROB for a
# label to be included in the final prediction. Filters single-frame noise.
MIN_FRAME_FRAC = 0.20
FRAME_VOTE_PROB = 0.40

# Default to one sample every N seconds when no interval is given. With no
# num_frames cap, a 60-min video = 720 frames — batch inference handles memory.
DEFAULT_FRAME_INTERVAL_SEC = 5.0
# Frames-per-batch budget. With TTA the actual forward-pass batch is INFER_BATCH/N_crops.
# Lower this if you OOM on a smaller GPU (e.g. set PREDICT_INFER_BATCH=16 for 8GB cards).
INFER_BATCH = int(os.environ.get("PREDICT_INFER_BATCH", "32"))

# Multi-crop test-time augmentation. Each crop is forwarded separately and the
# sigmoid probabilities are averaged. Trades inference time for accuracy.
#   center  -> 1x  (no TTA)
#   flip    -> 2x  (center + horizontal-flipped center)
#   5crop   -> 5x  (center + 4 corners)            <-- default
#   10crop  -> 10x (5crop + all hflipped)
TTA_MODES = {"center": 1, "flip": 2, "5crop": 5, "10crop": 10}
DEFAULT_TTA = os.environ.get("PREDICT_TTA", "5crop").lower()
if DEFAULT_TTA not in TTA_MODES:
    DEFAULT_TTA = "5crop"


def build_model(num_classes: int, arch: str) -> nn.Module:
    if arch == "efficientnet_b0":
        model = models.efficientnet_b0(weights=None)
        head_idx = 1
    elif arch == "efficientnet_b3":
        model = models.efficientnet_b3(weights=None)
        head_idx = 1
    elif arch == "efficientnet_v2_s":
        model = models.efficientnet_v2_s(weights=None)
        head_idx = 1
    elif arch == "efficientnet_v2_m":
        model = models.efficientnet_v2_m(weights=None)
        head_idx = 1
    elif arch == "efficientnet_v2_l":
        model = models.efficientnet_v2_l(weights=None)
        head_idx = 1
    elif arch == "convnext_base":
        # ConvNeXt classifier is Sequential(LayerNorm2d, Flatten, Linear) -> final Linear at [2].
        model = models.convnext_base(weights=None)
        head_idx = 2
    elif arch == "convnext_large":
        model = models.convnext_large(weights=None)
        head_idx = 2
    else:
        raise ValueError(f"unknown arch: {arch}")

    in_features = model.classifier[head_idx].in_features
    model.classifier[head_idx] = nn.Linear(in_features, num_classes)
    return model


def torch_load(path: Path) -> dict[str, Any]:
    try:
        return torch.load(path, map_location="cpu", weights_only=False)
    except TypeError:
        return torch.load(path, map_location="cpu")


def read_classes_meta(model_dir: Path) -> dict[str, Any]:
    classes_path = model_dir / "classes.json"
    if not classes_path.exists():
        return {}
    return json.loads(classes_path.read_text(encoding="utf-8"))


def resolve_checkpoint(model_dir: Path, model_path: str | None) -> Path:
    if model_path:
        path = Path(model_path).expanduser().resolve()
        if not path.exists():
            raise FileNotFoundError(f"PyTorch model not found: {path}")
        return path

    meta = read_classes_meta(model_dir)
    arch = meta.get("arch")
    if arch:
        preferred = model_dir / f"{arch}_best.pt"
        if preferred.exists():
            return preferred.resolve()

    pts = sorted(model_dir.glob("*.pt"))
    if pts:
        return pts[-1].resolve()
    raise FileNotFoundError(f"No .pt checkpoint found in {model_dir}")


def build_eval_transform(img_size: int, mean: list[float], std: list[float], tta_mode: str):
    """Returns a callable that maps PIL image -> tensor of shape [N_crops, C, H, W].
    For tta_mode='center' there is exactly 1 crop. Resize uses the int form so the
    shorter side is set (preserving aspect ratio); MUST match the training notebook."""
    resize_short = int(round(img_size * 256 / 224))
    resize = transforms.Resize(resize_short)
    normalize = transforms.Normalize(mean, std)

    def to_norm(img):
        return normalize(TF.to_tensor(img))

    if tta_mode == "center":
        crop = transforms.CenterCrop(img_size)
        def tf(img):
            return to_norm(crop(resize(img))).unsqueeze(0)
        return tf

    if tta_mode == "flip":
        crop = transforms.CenterCrop(img_size)
        def tf(img):
            c = crop(resize(img))
            return torch.stack([to_norm(c), to_norm(TF.hflip(c))])
        return tf

    if tta_mode == "5crop":
        five = transforms.FiveCrop(img_size)
        def tf(img):
            crops = five(resize(img))                       # 5 PIL images
            return torch.stack([to_norm(c) for c in crops])
        return tf

    if tta_mode == "10crop":
        ten = transforms.TenCrop(img_size)
        def tf(img):
            crops = ten(resize(img))                        # 10 PIL images (5 + flips)
            return torch.stack([to_norm(c) for c in crops])
        return tf

    raise ValueError(f"unknown TTA mode: {tta_mode}")


def load_model(checkpoint_path: Path, device: torch.device, tta_mode: str = DEFAULT_TTA):
    ckpt = torch_load(checkpoint_path)
    classes = list(ckpt["classes"])
    display = dict(ckpt.get("display", {}))
    img_size = int(ckpt.get("img_size", 300))
    mean = list(ckpt.get("mean", [0.485, 0.456, 0.406]))
    std = list(ckpt.get("std", [0.229, 0.224, 0.225]))
    arch = str(ckpt.get("arch", "efficientnet_v2_s"))
    thresholds = dict(ckpt["thresholds"]) if "thresholds" in ckpt else None

    model = build_model(len(classes), arch)
    state_dict = ckpt.get("state_dict", ckpt)
    model.load_state_dict(state_dict)
    model.to(device)
    model.eval()

    eval_tf = build_eval_transform(img_size, mean, std, tta_mode)
    return model, eval_tf, classes, display, thresholds


@torch.no_grad()
def forward_tta(model: nn.Module, x: torch.Tensor) -> torch.Tensor:
    """x is [B, N_crops, C, H, W]. Returns [B, num_classes] of averaged probabilities.
    Flattens crops into the batch dim, runs the model once, then averages crop probs."""
    B, N, C, H, W = x.shape
    flat = x.view(B * N, C, H, W)
    logits = model(flat)                                       # [B*N, num_classes]
    probs = torch.sigmoid(logits).view(B, N, -1).mean(dim=1)   # [B, num_classes]
    return probs


def topk_probs(probs: np.ndarray, classes: list[str], display: dict[str, str], top_k: int, thresholds: dict | None):
    if thresholds is not None:
        thresh_arr = np.array([thresholds.get(c, 0.5) for c in classes])
        active = np.where(probs >= thresh_arr)[0]
        idx = active[np.argsort(probs[active])[::-1]][:top_k]
    else:
        idx = probs.argsort()[::-1][:top_k]
    return [
        {
            "label": classes[i],
            "display": display.get(classes[i], classes[i]),
            "prob": float(probs[i]),
        }
        for i in idx
    ]


@torch.no_grad()
def predict_image(path: Path, model: nn.Module, eval_tf, device: torch.device, classes, display, top_k: int, thresholds: dict | None):
    image = Image.open(path).convert("RGB")
    crops = eval_tf(image).to(device)                                # [N_crops, C, H, W]
    probs = forward_tta(model, crops.unsqueeze(0))[0].cpu().numpy()  # [num_classes]
    return topk_probs(probs, classes, display, top_k, thresholds)


@torch.no_grad()
def predict_video(path: Path, model: nn.Module, eval_tf, device: torch.device, classes, display, top_k: int, num_frames: int, thresholds: dict | None, frame_interval: float | None = None):
    import cv2
    import math

    cap = cv2.VideoCapture(str(path))
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total <= 0:
        cap.release()
        raise RuntimeError("Could not read video.")

    # Default sampling: one frame every DEFAULT_FRAME_INTERVAL_SEC. The
    # num_frames argument only kicks in when caller explicitly passes interval<=0.
    use_interval = frame_interval is None or frame_interval > 0
    if use_interval:
        interval = frame_interval if (frame_interval is not None and frame_interval > 0) else DEFAULT_FRAME_INTERVAL_SEC
        fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
        step = max(1, int(round(fps * interval)))
        idxs = np.arange(0, total, step, dtype=int)
    else:
        idxs = np.linspace(0, max(total - 1, 0), num=min(num_frames, total)).astype(int)

    frames = []
    for frame_index in idxs:
        cap.set(cv2.CAP_PROP_POS_FRAMES, int(frame_index))
        ok, frame = cap.read()
        if not ok:
            continue
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        frames.append(eval_tf(Image.fromarray(rgb)))                # [N_crops, C, H, W]
    cap.release()

    if not frames:
        raise RuntimeError("No frames decoded.")

    # Batch inference with TTA: each frame contributes N_crops forward passes.
    # Shrink the per-batch frame count so total in-flight tensors stay bounded.
    n_crops = frames[0].shape[0]
    frames_per_batch = max(1, INFER_BATCH // n_crops)
    chunks = []
    for start in range(0, len(frames), frames_per_batch):
        batch = torch.stack(frames[start:start + frames_per_batch]).to(device)  # [B, N_crops, C, H, W]
        chunks.append(forward_tta(model, batch).cpu().numpy())                  # [B, num_classes]
    frame_probs = np.concatenate(chunks, axis=0)                                # (F, C)
    frame_vote = (frame_probs >= FRAME_VOTE_PROB).mean(axis=0) >= MIN_FRAME_FRAC
    probs = frame_probs.max(axis=0) * frame_vote                    # max pooling; zero out labels that don't pass voting
    return topk_probs(probs, classes, display, top_k, thresholds), len(frames)


def infer_kind(path: Path, requested: str) -> str:
    if requested != "auto":
        return requested
    mime, _ = mimetypes.guess_type(str(path))
    suffix = path.suffix.lower()
    if (mime or "").startswith("video") or suffix in VIDEO_EXTS:
        return "video"
    if (mime or "").startswith("image") or suffix in IMAGE_EXTS:
        return "image"
    raise ValueError(f"Unsupported file type: {suffix}")


def parse_args():
    parser = argparse.ArgumentParser(description="Notebook-matched PyTorch predictor")
    parser.add_argument("--file", required=True)
    parser.add_argument("--kind", choices=["auto", "image", "video"], default="auto")
    parser.add_argument("--top-k", type=int, default=3)
    parser.add_argument("--num-frames", type=int, default=16)
    parser.add_argument("--frame-interval", type=float, default=None, help="seconds per sample; overrides --num-frames")
    parser.add_argument("--model-dir", default="./checkpoint")
    parser.add_argument("--model-path", default=None)
    parser.add_argument("--device", default="cpu", choices=["cpu", "cuda", "auto"])
    parser.add_argument("--tta", default=DEFAULT_TTA, choices=list(TTA_MODES.keys()),
                        help="Multi-crop test-time augmentation. Higher = more accurate, slower.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    file_path = Path(args.file).expanduser().resolve()
    model_dir = Path(args.model_dir).expanduser().resolve()
    kind = infer_kind(file_path, args.kind)

    if args.device == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    else:
        device = torch.device(args.device)

    checkpoint_path = resolve_checkpoint(model_dir, args.model_path)
    model, eval_tf, classes, display, thresholds = load_model(checkpoint_path, device, args.tta)

    if kind == "video":
        predictions, frames = predict_video(
            file_path, model, eval_tf, device, classes, display,
            max(1, args.top_k), max(1, args.num_frames), thresholds, args.frame_interval,
        )
        payload = {"kind": "video", "frames": frames, "predictions": predictions}
    else:
        predictions = predict_image(file_path, model, eval_tf, device, classes, display, max(1, args.top_k), thresholds)
        payload = {"kind": "image", "predictions": predictions}

    print(json.dumps(payload, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ModuleNotFoundError as exc:
        print(
            f"Missing Python package '{exc.name}'. Install inference deps with: "
            "python -m pip install torch torchvision opencv-python pillow numpy",
            file=sys.stderr,
        )
        raise SystemExit(2)
    except Exception as exc:
        print(str(exc), file=sys.stderr)
        raise SystemExit(1)