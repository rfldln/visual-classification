import type { CategoryId } from "@/lib/taxonomy";

export type ReviewStatus = "PENDING" | "REVIEWED" | "FLAGGED" | "SKIPPED";
export type MediaKind = "IMAGE" | "VIDEO";

/** A labeling unit (single image or one extracted video frame). */
export interface FrameDTO {
  id: string;
  mediaItemId: string;
  frameIndex: number;
  timeSec: number;
  width: number | null;
  height: number | null;
  status: ReviewStatus;
  flagged: boolean;
  flagReason: string | null;
  reviewedAt: string | null;
  reviewerName: string | null;
  createdAt: string;
  labels: CategoryId[];
  /** URL that serves the frame JPEG (or original image). */
  url: string;
  /** Minimal info about the source media. */
  source: {
    id: string;
    originalName: string;
    kind: MediaKind;
    duration: number | null;
    frameCount: number;
  };
}

/** A source media row (image or video) with its extracted frames. */
export interface MediaItemDTO {
  id: string;
  filename: string;
  originalName: string;
  mimeType: string;
  kind: MediaKind;
  fileSize: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  uploadedAt: string;
  frameCount: number;
  reviewedFrameCount: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface LabelSavePayload {
  categoryIds: CategoryId[];
  action: "save" | "skip" | "flag";
  flagReason?: string;
}

export interface LabelSaveResponse {
  success: boolean;
  nextFrameId: string | null;
}
