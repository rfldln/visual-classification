import { NextResponse } from "next/server";
import JSZip from "jszip";
import { prisma } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getUser, unauthorizedResponse } from "@/lib/auth";

export const runtime = "nodejs";
export const maxDuration = 300;

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/**
 * Streams a ZIP of all dataset samples for the authenticated user.
 * Layout:
 *   images/{id}.jpg
 *   manifest.csv  — columns: filename, caption, tags, sourceName, sourceTimeSec
 */
export async function GET() {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  const samples = await prisma.datasetSample.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  const storage = getStorage();
  const zip = new JSZip();
  const imagesFolder = zip.folder("images");
  if (!imagesFolder) {
    return NextResponse.json({ error: "Could not create images folder" }, { status: 500 });
  }

  const csvLines: string[] = ["filename,caption,tags,sourceName,sourceTimeSec"];

  for (const s of samples) {
    const filename = `${s.id}.jpg`;
    try {
      const { stream } = await storage.read(s.filePath);
      const buf = await streamToBuffer(stream);
      imagesFolder.file(filename, buf);
      csvLines.push(
        [
          csvEscape(`images/${filename}`),
          csvEscape(s.caption),
          csvEscape(s.tags.join("|")),
          csvEscape(s.sourceName ?? ""),
          csvEscape(s.sourceTimeSec != null ? s.sourceTimeSec.toFixed(2) : ""),
        ].join(","),
      );
    } catch (err) {
      console.warn(`[dataset/export] skipped ${s.id}:`, err);
    }
  }

  zip.file("manifest.csv", csvLines.join("\n"));

  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  return new NextResponse(buffer as unknown as BodyInit, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="dataset-${stamp}.zip"`,
      "Content-Length": String(buffer.length),
    },
  });
}
