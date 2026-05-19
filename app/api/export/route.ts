import { NextResponse } from "next/server";
import archiver from "archiver";
import path from "path";
import { existsSync } from "fs";
import { PassThrough } from "stream";
import { prisma } from "@/lib/db";
import type { Prisma, ReviewStatus, MediaKind } from "@prisma/client";
import {
  toLongCsv, toWideCsv, labelDistribution, assignSplit,
  type ExportRow,
} from "@/lib/export";
import type { CategoryId } from "@/lib/taxonomy";

export const runtime = "nodejs";

const UPLOAD_ROOT = path.resolve(process.env.LOCAL_UPLOAD_PATH ?? "./public/uploads");

/**
 * GET /api/export
 *   preview=1                → JSON summary + CSV previews (first 20 rows)
 *   includeMedia=1           → full zip bundle (CSVs + media/ folder)
 *   default                  → CSV-only zip
 *
 * Filters: statuses, categories, from, to, format (long|wide|both)
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const preview = url.searchParams.get("preview") === "1";
  const previewLimit = Math.min(
    200,
    Math.max(1, parseInt(url.searchParams.get("previewLimit") ?? "20", 10)),
  );
  const format = (url.searchParams.get("format") ?? "both") as "long" | "wide" | "both";
  const statuses = (url.searchParams.get("statuses") ?? "REVIEWED")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean) as ReviewStatus[];
  const categories = (url.searchParams.get("categories") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const includeMedia = url.searchParams.get("includeMedia") === "1";

  const where: Prisma.FrameWhereInput = {};
  if (statuses.length) where.status = { in: statuses };
  if (categories.length) where.labels = { some: { categoryId: { in: categories } } };
  if (from || to) {
    where.reviewedAt = {};
    if (from) where.reviewedAt.gte = new Date(from);
    if (to) where.reviewedAt.lte = new Date(to);
  }

  if (preview) {
    const [total, images, videos] = await Promise.all([
      prisma.frame.count({ where }),
      prisma.frame.count({ where: { ...where, mediaItem: { kind: "IMAGE" as MediaKind } } }),
      prisma.frame.count({ where: { ...where, mediaItem: { kind: "VIDEO" as MediaKind } } }),
    ]);

    const sampleFrames = await prisma.frame.findMany({
      where,
      take: previewLimit,
      include: {
        labels: true,
        mediaItem: { select: { originalName: true, kind: true } },
      },
      orderBy: { reviewedAt: "desc" },
    });

    const rows: ExportRow[] = sampleFrames.map((f) => ({
      path: framePathInZip(f.id, f.mediaItem.kind),
      sourceId: f.mediaItemId,
      sourceKind: f.mediaItem.kind === "VIDEO" ? "video" : "image",
      sourceFilename: f.mediaItem.originalName,
      frameIndex: f.frameIndex,
      frameTimeSec: f.timeSec,
      labels: f.labels.map((l) => l.categoryId as CategoryId),
      split: assignSplit(f.mediaItemId),
    }));
    const distribution = labelDistribution(rows);
    return NextResponse.json({
      total,
      images,
      videos,
      estimatedRows: total,
      long: format !== "wide" ? toLongCsv(rows) : undefined,
      wide: format !== "long" ? toWideCsv(rows) : undefined,
      distribution,
    });
  }

  // --- Full export: stream a zip back -----------------------------------
  const pass = new PassThrough();
  const archive = archiver("zip", { zlib: { level: 6 } });
  archive.on("error", (err) => pass.destroy(err));
  archive.pipe(pass);

  (async () => {
    try {
      const frames = await prisma.frame.findMany({
        where,
        include: {
          labels: true,
          mediaItem: { select: { originalName: true, kind: true, filePath: true } },
        },
        orderBy: [{ mediaItemId: "asc" }, { frameIndex: "asc" }],
      });

      const rows: ExportRow[] = [];
      for (const f of frames) {
        const ext = f.mediaItem.kind === "VIDEO" ? ".jpg" : (path.extname(f.mediaItem.filePath) || ".bin");
        const zipPath = `media/${f.id}${ext}`;
        rows.push({
          path: zipPath,
          sourceId: f.mediaItemId,
          sourceKind: f.mediaItem.kind === "VIDEO" ? "video" : "image",
          sourceFilename: f.mediaItem.originalName,
          frameIndex: f.frameIndex,
          frameTimeSec: f.timeSec,
          labels: f.labels.map((l) => l.categoryId as CategoryId),
          split: assignSplit(f.mediaItemId),
        });

        if (includeMedia) {
          const absSource = path.join(UPLOAD_ROOT, f.filePath);
          if (existsSync(absSource)) {
            archive.file(absSource, { name: zipPath });
          }
        }
      }

      if (format !== "wide") archive.append(toLongCsv(rows), { name: "labels_long.csv" });
      if (format !== "long") archive.append(toWideCsv(rows), { name: "labels_wide.csv" });

      archive.append(
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            filters: { statuses, categories, from, to, format, includeMedia },
            totalRows: rows.length,
            distribution: labelDistribution(rows),
          },
          null,
          2,
        ),
        { name: "manifest.json" },
      );

      await archive.finalize();
    } catch (err) {
      pass.destroy(err instanceof Error ? err : new Error(String(err)));
    }
  })();

  const filename = `labeling-export-${new Date().toISOString().replace(/[:.]/g, "-")}.zip`;
  return new NextResponse(pass as unknown as ReadableStream<Uint8Array>, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

/** Stable relative path used in CSV. Videos = .jpg, images keep original ext via the full export path. */
function framePathInZip(frameId: string, kind: MediaKind): string {
  return `media/${frameId}${kind === "VIDEO" ? ".jpg" : ".img"}`;
}
