"""Patch the Colab notebook: implement training improvements + fix ONNX export."""
import json
from pathlib import Path

p = Path('notebooks/train_classifier_colab.ipynb')
nb = json.loads(p.read_text(encoding='utf-8'))

def set_cell(idx, src):
    if not src.endswith('\n'):
        src += '\n'
    lines = src.splitlines(keepends=True)
    nb['cells'][idx]['source'] = lines
    nb['cells'][idx]['outputs'] = []
    nb['cells'][idx]['execution_count'] = None

# ---------- Cell 11: transforms + dataloaders ----------
set_cell(11, r"""# Architecture-aware image size. Bigger ARCH => larger crop.
ARCH = 'efficientnet_v2_s'   # options: 'efficientnet_b0', 'efficientnet_b3', 'efficientnet_v2_s'
ARCH_IMG_SIZE = {
    'efficientnet_b0':    224,
    'efficientnet_b3':    300,
    'efficientnet_v2_s':  300,
}
IMG_SIZE = ARCH_IMG_SIZE[ARCH]
MEAN = [0.485, 0.456, 0.406]
STD  = [0.229, 0.224, 0.225]

# Stronger augmentation: RandAugment + RandomErasing. EfficientNet thrives on this.
train_tf = transforms.Compose([
    transforms.Resize((IMG_SIZE+32, IMG_SIZE+32)),
    transforms.RandomCrop(IMG_SIZE),
    transforms.RandomHorizontalFlip(),
    transforms.RandAugment(num_ops=2, magnitude=9),
    transforms.ColorJitter(0.2, 0.2, 0.2, 0.05),
    transforms.ToTensor(),
    transforms.Normalize(MEAN, STD),
    transforms.RandomErasing(p=0.25, scale=(0.02, 0.2)),
])
eval_tf = transforms.Compose([
    transforms.Resize((IMG_SIZE, IMG_SIZE)),
    transforms.ToTensor(),
    transforms.Normalize(MEAN, STD),
])

class CSVImageDataset(Dataset):
    def __init__(self, df, root, tf):
        self.df = df.reset_index(drop=True)
        self.root = Path(root)
        self.tf = tf
    def __len__(self):
        return len(self.df)
    def __getitem__(self, i):
        row = self.df.iloc[i]
        img = Image.open(self.root / row['path']).convert('RGB')
        return self.tf(img), CLASS_TO_IDX[row['category']]

train_ds = CSVImageDataset(train_df, MEDIA_DIR, train_tf)
val_ds   = CSVImageDataset(val_df,   MEDIA_DIR, eval_tf)
test_ds  = CSVImageDataset(test_df,  MEDIA_DIR, eval_tf)

# NOTE: dropped WeightedRandomSampler. It was over-amplifying rare classes
# (precision tanked on 'pussy'/'anal'). We instead use a plain shuffled loader
# and rely on a *softer* class-weighted loss below (sqrt-inverse instead of inverse).
train_labels = train_df['category'].map(CLASS_TO_IDX).values
class_counts = np.bincount(train_labels, minlength=NUM_CLASSES)

# Per-arch batch size — bigger inputs need smaller batches on Colab T4.
ARCH_BATCH = {'efficientnet_b0': 32, 'efficientnet_b3': 24, 'efficientnet_v2_s': 24}
BATCH_SIZE  = ARCH_BATCH[ARCH]
NUM_WORKERS = 2

train_loader = DataLoader(train_ds, batch_size=BATCH_SIZE, shuffle=True,
                          num_workers=NUM_WORKERS, pin_memory=True, drop_last=True)
val_loader   = DataLoader(val_ds,   batch_size=BATCH_SIZE, shuffle=False,
                          num_workers=NUM_WORKERS, pin_memory=True)
test_loader  = DataLoader(test_ds,  batch_size=BATCH_SIZE, shuffle=False,
                          num_workers=NUM_WORKERS, pin_memory=True)

print(f'ARCH = {ARCH}   IMG_SIZE = {IMG_SIZE}   BATCH = {BATCH_SIZE}')
print('Class counts (train):')
for c, n in zip(CLASSES, class_counts):
    print(f'  {c:10s} {n}')
""")

# ---------- Cell 13: build_model + loss/optim ----------
set_cell(13, r"""def build_model(num_classes, arch=ARCH):
    if arch == 'efficientnet_b0':
        m = models.efficientnet_b0(weights=models.EfficientNet_B0_Weights.IMAGENET1K_V1)
        in_feat = m.classifier[1].in_features
        m.classifier[1] = nn.Linear(in_feat, num_classes)
        head_params = list(m.classifier.parameters())
        backbone_params = [p for n,p in m.named_parameters() if not n.startswith('classifier')]
    elif arch == 'efficientnet_b3':
        m = models.efficientnet_b3(weights=models.EfficientNet_B3_Weights.IMAGENET1K_V1)
        in_feat = m.classifier[1].in_features
        m.classifier[1] = nn.Linear(in_feat, num_classes)
        head_params = list(m.classifier.parameters())
        backbone_params = [p for n,p in m.named_parameters() if not n.startswith('classifier')]
    elif arch == 'efficientnet_v2_s':
        m = models.efficientnet_v2_s(weights=models.EfficientNet_V2_S_Weights.IMAGENET1K_V1)
        in_feat = m.classifier[1].in_features
        m.classifier[1] = nn.Linear(in_feat, num_classes)
        head_params = list(m.classifier.parameters())
        backbone_params = [p for n,p in m.named_parameters() if not n.startswith('classifier')]
    else:
        raise ValueError(f'unknown arch: {arch}')
    return m, head_params, backbone_params

model, HEAD_PARAMS, BACKBONE_PARAMS = build_model(NUM_CLASSES, ARCH)
model = model.to(device)

# Softer class weighting: sqrt-inverse-frequency. Avoids the over-prediction we
# saw with hard inverse weights + sampler combo. label_smoothing dropped to 0
# since we now use stronger augmentation as the regularizer.
counts_t = np.maximum(class_counts, 1)
loss_weights = torch.tensor(np.sqrt(counts_t.sum() / counts_t),
                            dtype=torch.float32, device=device)
loss_weights = loss_weights / loss_weights.mean()
criterion = nn.CrossEntropyLoss(weight=loss_weights, label_smoothing=0.0)

# Optimizer + 20-epoch cosine schedule. Two-phase fine-tune: head-only for the
# first FREEZE_EPOCHS, then unfreeze the backbone.
EPOCHS = 20
FREEZE_EPOCHS = 2

# Phase 1: head only.
for p in BACKBONE_PARAMS:
    p.requires_grad = False
optimizer = optim.AdamW([
    {'params': HEAD_PARAMS,     'lr': 1e-3},
], weight_decay=1e-4)
scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(1, EPOCHS-FREEZE_EPOCHS))
scaler = torch.amp.GradScaler('cuda', enabled=device.type=='cuda')
""")

# ---------- Cell 15: training loop with two-phase finetune ----------
set_cell(15, r"""@torch.no_grad()
def evaluate(model, loader):
    model.eval()
    correct = total = 0
    loss_sum = 0.0
    for x, y in loader:
        x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
        with torch.amp.autocast('cuda', enabled=device.type=='cuda'):
            out = model(x)
            loss = criterion(out, y)
        loss_sum += loss.item() * x.size(0)
        correct += (out.argmax(1) == y).sum().item()
        total += x.size(0)
    return loss_sum/total, correct/total

best_acc = 0.0
best_state = None
history = {'train_loss': [], 'val_loss': [], 'val_acc': []}

for epoch in range(1, EPOCHS+1):
    # Two-phase fine-tune: unfreeze backbone after FREEZE_EPOCHS.
    if epoch == FREEZE_EPOCHS + 1:
        print(f'  >> unfreezing backbone (epoch {epoch})')
        for p in BACKBONE_PARAMS:
            p.requires_grad = True
        optimizer = optim.AdamW([
            {'params': BACKBONE_PARAMS, 'lr': 3e-4},
            {'params': HEAD_PARAMS,     'lr': 1e-3},
        ], weight_decay=1e-4)
        scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=EPOCHS-FREEZE_EPOCHS)

    model.train()
    pbar = tqdm(train_loader, desc=f'Epoch {epoch}/{EPOCHS}')
    running = 0.0; seen = 0
    for x, y in pbar:
        x, y = x.to(device, non_blocking=True), y.to(device, non_blocking=True)
        optimizer.zero_grad(set_to_none=True)
        with torch.amp.autocast('cuda', enabled=device.type=='cuda'):
            out = model(x); loss = criterion(out, y)
        scaler.scale(loss).backward()
        scaler.step(optimizer); scaler.update()
        running += loss.item()*x.size(0); seen += x.size(0)
        pbar.set_postfix(loss=f'{running/seen:.4f}')
    if epoch > FREEZE_EPOCHS:
        scheduler.step()

    val_loss, val_acc = evaluate(model, val_loader)
    history['train_loss'].append(running/seen)
    history['val_loss'].append(val_loss); history['val_acc'].append(val_acc)
    print(f'  -> val_loss={val_loss:.4f}  val_acc={val_acc:.4f}')
    if val_acc > best_acc:
        best_acc = val_acc
        best_state = copy.deepcopy(model.state_dict())
        print(f'  ** new best (val_acc={best_acc:.4f})')

model.load_state_dict(best_state)
print(f'\nBest val accuracy: {best_acc:.4f}')
""")

# ---------- Cell 18: test eval with TTA ----------
set_cell(18, r"""from sklearn.metrics import classification_report, confusion_matrix

# Test-time augmentation: average softmax of the original and the horizontally
# flipped input. Small but reliable bump (~0.3-0.8 pts).
USE_TTA = True

model.eval()
all_y, all_p = [], []
with torch.no_grad():
    for x, y in tqdm(test_loader, desc='Test'):
        x = x.to(device)
        with torch.amp.autocast('cuda', enabled=device.type=='cuda'):
            logits = model(x)
            if USE_TTA:
                logits = logits + model(torch.flip(x, dims=[3]))
        all_p.append(logits.argmax(1).cpu().numpy())
        all_y.append(y.numpy())
all_y = np.concatenate(all_y); all_p = np.concatenate(all_p)

acc = (all_y == all_p).mean()
print(f'Test accuracy: {acc:.4f}  (TTA={USE_TTA})\n')

target_names = [f'{c} ({DISPLAY[c]})' for c in CLASSES]
print(classification_report(all_y, all_p, target_names=target_names, digits=3, zero_division=0))

cm = confusion_matrix(all_y, all_p, labels=list(range(NUM_CLASSES)))
plt.figure(figsize=(max(8, NUM_CLASSES*0.7), max(6, NUM_CLASSES*0.6)))
sns.heatmap(cm, annot=True, fmt='d', cmap='Blues',
            xticklabels=CLASSES, yticklabels=CLASSES)
plt.xlabel('Predicted'); plt.ylabel('True'); plt.title('Confusion matrix (test)')
plt.tight_layout(); plt.show()
""")

# ---------- Cell 20: checkpoint save (filename uses ARCH) ----------
set_cell(20, r"""OUT_DIR = Path('/content/drive/MyDrive/visual-classification/checkpoints')
OUT_DIR.mkdir(parents=True, exist_ok=True)
ckpt_path = OUT_DIR / f'{ARCH}_best.pt'
torch.save({
    'state_dict': model.state_dict(),
    'classes': CLASSES,
    'display': DISPLAY,
    'img_size': IMG_SIZE,
    'mean': MEAN, 'std': STD,
    'arch': ARCH,
}, ckpt_path)
print('Saved ->', ckpt_path)
""")

# ---------- Cell 22: ONNX export (fix onnxscript error + arch-aware) ----------
set_cell(22, r"""# Install ONNX deps (Colab's torch>=2.5 dynamo exporter requires `onnxscript`).
!pip -q install --upgrade onnx onnxscript

import json

onnx_path    = OUT_DIR / f'{ARCH}_best.onnx'
classes_path = OUT_DIR / 'classes.json'

model.eval()
dummy = torch.randn(1, 3, IMG_SIZE, IMG_SIZE, device=device)

# Force the legacy TorchScript-based exporter (dynamo=False). Robust across
# torch versions and avoids onnxscript edge cases for torchvision EfficientNets.
torch.onnx.export(
    model, dummy, onnx_path.as_posix(),
    input_names=['input'], output_names=['logits'],
    dynamic_axes={'input': {0: 'batch'}, 'logits': {0: 'batch'}},
    opset_version=17,
    dynamo=False,
)
with open(classes_path, 'w') as f:
    json.dump({
        'classes': CLASSES,
        'display': DISPLAY,
        'img_size': IMG_SIZE,
        'mean': MEAN, 'std': STD,
        'arch': ARCH,
    }, f, indent=2)
print('ONNX ->', onnx_path)
print('Classes ->', classes_path)
""")

p.write_text(json.dumps(nb, indent=1, ensure_ascii=False), encoding='utf-8')
print('OK — patched cells 11, 13, 15, 18, 20, 22')
