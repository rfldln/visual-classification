import json
from pathlib import Path
p = Path("notebooks/train_classifier_colab.ipynb")
nb = json.loads(p.read_text(encoding="utf-8"))

def set_src(idx, src):
    if not src.endswith("\n"): src += "\n"
    nb["cells"][idx]["source"] = src.splitlines(keepends=True)
    if nb["cells"][idx]["cell_type"] == "code":
        nb["cells"][idx]["outputs"] = []
        nb["cells"][idx]["execution_count"] = None

# Cell 0 — intro markdown
set_src(0, """# Visual Classification — Training Notebook (Google Colab)

Trains an image classifier on the labeled dataset under `dataset/labeled/`.
Frames extracted from videos are treated as still images. Inference works on **images** *and* **videos** (videos are sampled frame-by-frame and the predictions are aggregated).

**Pipeline**
1. Mount the dataset (Google Drive *or* upload zip).
2. Read `labels_long.csv`, drop empty categories, show what's included / skipped.
3. Build PyTorch `Dataset`s using the `split` column (train/val/test).
4. Fine-tune EfficientNet (B0 / B3 / V2-S — selectable via `ARCH`) with a class-weighted loss + RandAugment + two-phase fine-tuning.
5. Evaluate: overall accuracy + per-category precision/recall/F1 + confusion matrix (with TTA).
6. Inference cell: upload an image **or** video, get the predicted tag.""")

# Cell 12 — section 5 markdown
set_src(12, """## 5. Model — EfficientNet (B0 / B3 / V2-S), fine-tuned

Set `ARCH` in the previous cell. We do a **two-phase fine-tune**: head only for the first
`FREEZE_EPOCHS`, then unfreeze the backbone with a smaller LR and a cosine schedule.""")

# Cell 21 — section 8b markdown
set_src(21, """### 8b. Export to ONNX (for the Next.js website)

Produces `<ARCH>_best.onnx` + `classes.json` next to the checkpoint.
Drop both files into the website at `models/`.""")

# Cell 27 — reload snippet (was using OLD build_model signature)
set_src(27, """# Example: reload any saved checkpoint and resume inference.
# ckpt_path = Path('/content/drive/MyDrive/visual-classification/checkpoints/efficientnet_v2_s_best.pt')
# ckpt = torch.load(ckpt_path, map_location=device)
# CLASSES     = ckpt['classes']
# DISPLAY     = ckpt['display']
# NUM_CLASSES = len(CLASSES)
# ARCH        = ckpt['arch']
# IMG_SIZE    = ckpt['img_size']
# MEAN, STD   = ckpt['mean'], ckpt['std']
# model, HEAD_PARAMS, BACKBONE_PARAMS = build_model(NUM_CLASSES, ARCH)
# model = model.to(device)
# model.load_state_dict(ckpt['state_dict'])
# model.eval()
# print('Loaded checkpoint with classes:', CLASSES)""")

# Cell 3 — imports: WeightedRandomSampler no longer used; harmless but tidy.
src3 = "".join(nb["cells"][3]["source"])
src3 = src3.replace(
    "from torch.utils.data import Dataset, DataLoader, WeightedRandomSampler\n",
    "from torch.utils.data import Dataset, DataLoader\n",
)
set_src(3, src3)

p.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding="utf-8")
print("OK — patched cells 0, 3, 12, 21, 27")
