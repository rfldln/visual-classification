/**
 * Reclaim disk space by deleting original video files that already have
 * extracted frames. Frames + DB rows are untouched, so the labeling UI and
 * export pipeline keep working.
 *
 * Usage:
 *   npx tsx scripts/cleanup-originals.ts          # dry-run (default)
 *   npx tsx scripts/cleanup-originals.ts --apply  # actually delete
 */
import { promises as fs } from "fs";
import path from "path";
import { prisma } from "../lib/db";

const UPLOAD_ROOT = path.resolve(process.env.LOCAL_UPLOAD_PATH ?? "./public/uploads");
const APPLY = process.argv.includes("--apply");

async function main() {
  const items = await prisma.mediaItem.findMany({
    where: { kind: "VIDEO" },
    select: {
      id: true,
      filePath: true,
      originalName: true,
      fileSize: true,
      _count: { select: { frames: true } },
    },
  });

  let candidates = 0;
  let bytesReclaimable = 0n;
  let bytesReclaimed = 0n;
  let missing = 0;
  let skippedNoFrames = 0;

  for (const it of items) {
    if (it._count.frames === 0) {
      skippedNoFrames++;
      continue;
    }
    const abs = path.join(UPLOAD_ROOT, it.filePath);
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      missing++;
      continue;
    }
    candidates++;
    bytesReclaimable += BigInt(stat.size);

    if (APPLY) {
      await fs.rm(abs, { force: true });
      bytesReclaimed += BigInt(stat.size);
      console.log(`deleted ${it.originalName} (${(stat.size / 1e9).toFixed(2)} GB)`);
    } else {
      console.log(`would delete ${it.originalName} (${(stat.size / 1e9).toFixed(2)} GB)`);
    }
  }

  const gb = (b: bigint) => (Number(b) / 1e9).toFixed(2);
  console.log("\n— summary —");
  console.log(`videos with frames + file on disk: ${candidates}`);
  console.log(`videos with file already gone:     ${missing}`);
  console.log(`videos with no frames (skipped):   ${skippedNoFrames}`);
  if (APPLY) console.log(`reclaimed: ${gb(bytesReclaimed)} GB`);
  else console.log(`reclaimable: ${gb(bytesReclaimable)} GB  (re-run with --apply to delete)`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
