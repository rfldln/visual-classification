# Labeling Tool

A production-ready Next.js app for manually reviewing images and videos, assigning multi-label tags across a configurable taxonomy, and exporting training-ready CSVs.

## Stack

- Next.js 15 App Router (Route Handlers for APIs)
- TypeScript + Tailwind CSS
- Zustand (client state) + TanStack Query (server state)
- PostgreSQL via Prisma ORM
- NextAuth.js (credentials)
- Local filesystem storage with an S3-ready `StorageAdapter` abstraction

## Setup

```bash
# 1. Install deps
npm install

# 2. Configure env
cp .env.example .env
# Edit DATABASE_URL, NEXTAUTH_SECRET, REVIEWER_EMAIL, REVIEWER_PASSWORD

# 3. Create DB schema
npx prisma db push
npx prisma generate

# 4. Run
npm run dev
```

Open http://localhost:3000 and sign in with `REVIEWER_EMAIL` / `REVIEWER_PASSWORD`.

## Features

- **Upload**: drag-and-drop bulk upload of images (JPG/PNG/WEBP/GIF) and videos (MP4/MOV/WEBM). Items enter the `PENDING` queue.
- **Review** (`/review/[id]`): 60/40 split viewer + label panel, 17 categories grouped (Solo / Partnered / Body / Acts), keyboard-driven.
- **Review queue** (`/review`): paginated grid with status/type/sort filters.
- **Labeled browser** (`/labeled`): browse reviewed items, filter by category, click to re-edit.
- **Export** (`/export`): filter by status/category/date, live preview, download `.zip` containing long + wide CSVs + manifest.
- **Dashboard**: stats cards, overall progress, per-category breakdown, recent activity.

## Keyboard shortcuts (review page)

| Key | Action |
|---|---|
| `Enter` / `Space` | Save & next |
| `S` | Skip |
| `F` | Flag (prompt for reason) |
| `←` | Previous item (history) |
| `→` | Next item |
| `1`–`0`, `q`…`m` | Toggle category (see kbd hint on each card) |

## Taxonomy

Defined in [lib/taxonomy.ts](lib/taxonomy.ts). Ships with 17 categories grouped into Solo / Partnered / Body focus / Acts. Extend by adding entries to the `CATEGORIES` array — shortcuts auto-assign.

## API

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/upload` | multipart upload (`files[]`) |
| `GET` | `/api/items` | paginated list, filters: `status`, `type`, `category`, `sort`, `page`, `limit` |
| `GET` | `/api/items/[id]` | full item + queue position |
| `DELETE` | `/api/items/[id]` | remove item |
| `POST` | `/api/items/[id]/label` | body: `{ categoryIds, action: "save"\|"skip"\|"flag", flagReason? }` → returns `nextItemId` |
| `GET` | `/api/media/[id]` | streams media with HTTP range support (video seeking) |
| `GET` | `/api/stats` | dashboard stats |
| `GET` | `/api/export` | `.zip` of CSVs. Query: `format=long\|wide\|both`, `statuses`, `categories`, `from`, `to`, `preview=1` for JSON preview |

## Export formats

**Long** (one row per label):
```
filename,category,split
uploads/abc123.jpg,solo,train
uploads/abc123.jpg,tits,train
```

**Wide** (one row per file, binary columns):
```
filename,anal,bbg,bg,...,tits,split
uploads/abc123.jpg,0,0,0,...,1,train
```

Splits are deterministic SHA-256 hashes of the item id → 80/10/10 train/val/test. Re-exports produce identical splits.

## Using the exported CSV in Google Colab

```python
import pandas as pd
import torch
from torch.utils.data import Dataset, DataLoader
from torchvision import transforms
from PIL import Image
import os

# Upload the exported zip into Colab, unzip it, and point DATA_ROOT at the folder
# containing the "uploads/" directory.
DATA_ROOT = "/content/dataset"

df = pd.read_csv(f"{DATA_ROOT}/labels_wide.csv")

LABEL_COLS = [c for c in df.columns if c not in ("filename", "split")]
train_df = df[df["split"] == "train"].reset_index(drop=True)
val_df   = df[df["split"] == "val"].reset_index(drop=True)

class MultiLabelImageDataset(Dataset):
    def __init__(self, frame, root, transform=None):
        self.frame = frame
        self.root = root
        self.transform = transform

    def __len__(self):
        return len(self.frame)

    def __getitem__(self, idx):
        row = self.frame.iloc[idx]
        img = Image.open(os.path.join(self.root, row["filename"])).convert("RGB")
        if self.transform:
            img = self.transform(img)
        labels = torch.tensor(row[LABEL_COLS].values.astype("float32"))
        return img, labels

tfm = transforms.Compose([
    transforms.Resize((224, 224)),
    transforms.ToTensor(),
])

train_ds = MultiLabelImageDataset(train_df, DATA_ROOT, tfm)
val_ds   = MultiLabelImageDataset(val_df,   DATA_ROOT, tfm)

train_loader = DataLoader(train_ds, batch_size=32, shuffle=True, num_workers=2)
val_loader   = DataLoader(val_ds,   batch_size=32, shuffle=False, num_workers=2)

# Model head: len(LABEL_COLS) sigmoid outputs + BCEWithLogitsLoss
```

For Keras/TF, the wide CSV works directly with `tf.keras.utils.image_dataset_from_dataframe` (community utility) or a `tf.data.Dataset.from_tensor_slices` pipeline.

## Storage

The `StorageAdapter` (`lib/storage.ts`) encapsulates file I/O. Default is local (`./public/uploads`). To add S3, implement an `S3Storage` class using `@aws-sdk/client-s3` and swap it in `getStorage()` when `STORAGE_TYPE=s3`.

## Production notes

- Media is never served from `/public/uploads` directly — everything routes through `/api/media/[id]` with auth and range-request support, so swapping to S3 is a drop-in change.
- Labels are transactionally replaced on save (delete + insert). Re-reviewing an item overwrites prior labels.
- The review API returns `nextItemId` so the client navigates instantly without a refetch round-trip.
- Dashboard and upload pages poll stats every 4–5s.
