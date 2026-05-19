import crypto from "crypto";
import { CATEGORIES, type CategoryId } from "@/lib/taxonomy";

export type Split = "train" | "val" | "test";

/** Deterministic split assignment from item id. 80/10/10. */
export function assignSplit(id: string): Split {
  const hash = crypto.createHash("sha256").update(id).digest();
  const n = hash.readUInt32BE(0) / 0xffffffff;
  if (n < 0.8) return "train";
  if (n < 0.9) return "val";
  return "test";
}

export type MediaKind = "image" | "video";

export interface ExportItem {
  id: string;
  filePath: string;
  filename: string;
  kind: MediaKind;
  labels: CategoryId[];
}

/** One emitted training sample (image or single frame of a video). */
export interface ExportRow {
  path: string;
  sourceId: string;
  sourceKind: MediaKind;
  sourceFilename: string;
  frameIndex: number | null;
  frameTimeSec: number | null;
  labels: CategoryId[];
  split: Split;
}

function csvEscape(v: string | number | null): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Long format: one row per (sample, label). */
export function toLongCsv(rows: ExportRow[]): string {
  const header = "path,source_id,source_kind,source_file,frame_index,frame_time_sec,category,split\n";
  const out: string[] = [];
  for (const r of rows) {
    for (const cat of r.labels) {
      out.push([
        csvEscape(r.path),
        csvEscape(r.sourceId),
        csvEscape(r.sourceKind),
        csvEscape(r.sourceFilename),
        csvEscape(r.frameIndex),
        csvEscape(r.frameTimeSec !== null ? r.frameTimeSec.toFixed(3) : null),
        csvEscape(cat),
        csvEscape(r.split),
      ].join(","));
    }
  }
  return header + out.join("\n") + (out.length ? "\n" : "");
}

/** Wide format: one row per sample with 0/1 columns per category. */
export function toWideCsv(rows: ExportRow[]): string {
  const cats = CATEGORIES.map((c) => c.id);
  const header = [
    "path", "source_id", "source_kind", "source_file",
    "frame_index", "frame_time_sec",
    ...cats,
    "split",
  ].join(",") + "\n";
  const out: string[] = [];
  for (const r of rows) {
    const set = new Set(r.labels);
    const cols = cats.map((c) => (set.has(c) ? "1" : "0"));
    out.push([
      csvEscape(r.path),
      csvEscape(r.sourceId),
      csvEscape(r.sourceKind),
      csvEscape(r.sourceFilename),
      csvEscape(r.frameIndex),
      csvEscape(r.frameTimeSec !== null ? r.frameTimeSec.toFixed(3) : null),
      ...cols,
      csvEscape(r.split),
    ].join(","));
  }
  return header + out.join("\n") + (out.length ? "\n" : "");
}

export function labelDistribution(rows: ExportRow[]): Record<string, number> {
  const dist: Record<string, number> = {};
  for (const c of CATEGORIES) dist[c.id] = 0;
  for (const r of rows) for (const l of r.labels) dist[l] = (dist[l] ?? 0) + 1;
  return dist;
}

/**
 * Expand an item into one or more CSV rows.
 * - Images â†’ single row.
 * - Videos â†’ one row per extracted frame, or one placeholder row if no frames supplied.
 */
export function expandItemRows(
  item: ExportItem,
  videoFrames?: { index: number; timestampSec: number; relPath: string }[],
  opts: { imageRelPath?: (it: ExportItem) => string } = {},
): ExportRow[] {
  const split = assignSplit(item.id);
  if (item.kind === "image") {
    const p = opts.imageRelPath?.(item) ?? `uploads/${item.filename}`;
    return [{
      path: p,
      sourceId: item.id,
      sourceKind: "image",
      sourceFilename: item.filename,
      frameIndex: null,
      frameTimeSec: null,
      labels: item.labels,
      split,
    }];
  }
  if (!videoFrames || videoFrames.length === 0) {
    return [{
      path: `uploads/${item.filename}`,
      sourceId: item.id,
      sourceKind: "video",
      sourceFilename: item.filename,
      frameIndex: null,
      frameTimeSec: null,
      labels: item.labels,
      split,
    }];
  }
  return videoFrames.map((f) => ({
    path: f.relPath,
    sourceId: item.id,
    sourceKind: "video" as const,
    sourceFilename: item.filename,
    frameIndex: f.index,
    frameTimeSec: f.timestampSec,
    labels: item.labels,
    split,
  }));
}
