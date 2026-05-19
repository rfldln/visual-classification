# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A production labeling tool for manually reviewing and categorizing images/videos for multi-label visual classification. It includes ML inference suggestions (ONNX or PyTorch), video frame extraction via FFmpeg, a keyboard-driven review UI, and a training-ready CSV export pipeline.

## Commands

### Node.js / Next.js

```bash
npm install           # Install dependencies
npm run dev           # Start dev server at http://localhost:3000
npm run build         # Production build
npm start             # Run production server
npm run lint          # Lint with Next.js ESLint config
```

### Database (Prisma + PostgreSQL)

```bash
npx prisma db push       # Apply schema changes without migrations
npx prisma generate      # Regenerate Prisma client after schema edits
npx prisma migrate dev   # Create and apply a named migration
tsx prisma/seed.ts       # Seed the database
```

### Python Inference (optional)

The Python backend lives in `.venv-inference/`. Install with:
```bash
pip install -r requirements-inference.txt
```

Run inference directly:
```bash
python scripts/predict_with_pt.py
```

## Architecture

### Data Model (`prisma/schema.prisma`)

Three core tables:
- `MediaItem` — uploaded file (image or video), with `MediaKind` enum (IMAGE/VIDEO)
- `Frame` — individual reviewable image; either the original image or an extracted video frame
- `Label` — join record between `Frame` and a category string; `ReviewStatus` enum on Frame (PENDING/REVIEWED/FLAGGED/SKIPPED)

Upload → optional FFmpeg frame extraction → `Frame` rows created → review UI labels each frame.

### API Routes (`app/api/`)

| Route | Purpose |
|---|---|
| `api/upload` | Streaming multi-part upload, calls frame extractor |
| `api/items/[id]/label` | POST to assign labels to a frame |
| `api/items/next` | Server-side cursor for next unlabeled frame |
| `api/media/[id]` | Authenticated media serving with HTTP range support |
| `api/export` | Generates CSV (long or wide format) + optional ZIP |
| `api/predict` | Runs ML inference on a frame |

### Key Library Modules (`lib/`)

- **`storage.ts`** — `StorageAdapter` interface; default is local filesystem (`./public/uploads`); S3 stub exists for future use
- **`frames.ts`** — FFmpeg-based video frame extraction; adaptive interval (max 2000 frames); single-pass efficient extraction
- **`predict.ts`** / **`predict-pytorch.ts`** — ONNX (via `onnxruntime-node`) and PyTorch (spawns `scripts/predict_with_pt.py`) inference; switched via `PREDICT_BACKEND` env var
- **`export.ts`** — CSV export in long or wide format; deterministic 80/10/10 train/val/test split via SHA256(frame id)
- **`taxonomy.ts`** — Category definitions and auto-assigned keyboard shortcuts for the 17-label taxonomy

### State Management

- **Zustand** (`store/`) — client-side label assignment state during review session
- **TanStack Query** — server state (frame lists, stats, predictions)

### Auth

NextAuth.js with a single credentials provider. Credentials set via `REVIEWER_EMAIL` and `REVIEWER_PASSWORD` env vars. All media served through `/api/media/[id]` (never directly from `/public/`) to enforce auth on every asset.

## Environment Variables

Key vars (see `.env.example`):

```
DATABASE_URL                    # PostgreSQL connection string
NEXTAUTH_SECRET                 # Auth signing secret
REVIEWER_EMAIL / REVIEWER_PASSWORD  # Login credentials
STORAGE_TYPE                    # "local" (default)
LOCAL_UPLOAD_PATH               # Default: ./public/uploads
MODEL_DIR / MODEL_PATH          # ML model file locations
PREDICT_BACKEND                 # "onnx" or "pytorch"
DELETE_ORIGINAL_AFTER_EXTRACT   # Set to "1" to delete source video after frame extraction
```

## Notable Constraints

- `next.config.ts` sets a 500 MB body size limit for server actions and marks FFmpeg/FFprobe as external packages (not bundled).
- Upload and inference routes have extended timeouts (`maxDuration: 600` and `300` seconds respectively).
- Path alias `@/*` maps to the project root.
- The taxonomy (17 labels) and keyboard shortcut assignments live in `lib/taxonomy.ts` — edit there to add/remove categories.
