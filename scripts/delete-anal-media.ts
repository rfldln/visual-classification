import { PrismaClient } from "@prisma/client";
import fs from "fs";

const prisma = new PrismaClient();

async function main() {
  // Find all MediaItems (+ their frame file paths) that have at least one "anal" label
  const affectedItems = await prisma.mediaItem.findMany({
    where: {
      frames: {
        some: {
          labels: {
            some: { categoryId: "solo" },
          },
        },
      },
    },
    select: {
      id: true,
      originalName: true,
      kind: true,
      filePath: true,
      frames: { select: { filePath: true } },
    },
  });

  if (affectedItems.length === 0) {
    console.log("No media items found with the 'anal' label.");
    return;
  }

  console.log(`Found ${affectedItems.length} media item(s) to delete:\n`);
  for (const item of affectedItems) {
    console.log(`  [${item.kind}] ${item.originalName} (${item.frames.length} frame(s)) — id: ${item.id}`);
  }

  // Collect all file paths: original media + every extracted frame
  const filePaths: string[] = [];
  for (const item of affectedItems) {
    filePaths.push(item.filePath);
    for (const frame of item.frames) filePaths.push(frame.filePath);
  }

  // Delete DB records first (cascade removes frames + labels)
  const ids = affectedItems.map((i) => i.id);
  const { count } = await prisma.mediaItem.deleteMany({ where: { id: { in: ids } } });
  console.log(`\nDeleted ${count} media item(s) from the database.`);

  // Delete physical files
  let deleted = 0;
  let missing = 0;
  for (const p of filePaths) {
    if (fs.existsSync(p)) {
      fs.rmSync(p);
      deleted++;
    } else {
      console.warn(`  (not found on disk, skipping) ${p}`);
      missing++;
    }
  }
  console.log(`Deleted ${deleted} file(s) from disk. ${missing > 0 ? `${missing} already missing.` : ""}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
