import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();

async function main() {
  const uploadsRoot = path.resolve(process.env.LOCAL_UPLOAD_PATH ?? "./public/uploads");

  // Collect all file keys still referenced in the DB
  const [mediaItems, frames] = await Promise.all([
    prisma.mediaItem.findMany({ select: { filePath: true } }),
    prisma.frame.findMany({ select: { filePath: true } }),
  ]);

  const referenced = new Set<string>([
    ...mediaItems.map((m) => path.resolve(uploadsRoot, m.filePath)),
    ...frames.map((f) => path.resolve(uploadsRoot, f.filePath)),
  ]);

  // Walk the uploads directory
  const allFiles = fs.readdirSync(uploadsRoot).map((f) => path.join(uploadsRoot, f));
  const orphans = allFiles.filter((f) => !referenced.has(f) && fs.statSync(f).isFile());

  if (orphans.length === 0) {
    console.log("No orphaned files found.");
    return;
  }

  console.log(`Found ${orphans.length} orphaned file(s). Deleting...`);
  for (const f of orphans) {
    fs.rmSync(f);
  }
  console.log("Done.");
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
