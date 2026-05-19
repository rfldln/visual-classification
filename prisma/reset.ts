/**
 * Reset labeling data without touching the database schema.
 *
 * Usage:
 *   tsx prisma/reset.ts labels   — wipe all labels + reset every frame to PENDING
 *   tsx prisma/reset.ts all      — delete all media items, frames, and labels
 */

import { PrismaClient } from "@prisma/client";
import * as readline from "readline";

const prisma = new PrismaClient();

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (ans) => { rl.close(); resolve(ans); }));
}

async function resetLabels() {
  const [labelCount, frameCount] = await Promise.all([
    prisma.label.count(),
    prisma.frame.count(),
  ]);

  console.log(`\nThis will:`);
  console.log(`  - Delete ${labelCount.toLocaleString()} label(s)`);
  console.log(`  - Reset ${frameCount.toLocaleString()} frame(s) to PENDING\n`);

  const ans = await ask("Type YES to confirm: ");
  if (ans.trim() !== "YES") { console.log("Aborted."); return; }

  const [deleted, updated] = await Promise.all([
    prisma.label.deleteMany(),
    prisma.frame.updateMany({
      data: { status: "PENDING", flagged: false, flagReason: null, reviewedAt: null },
    }),
  ]);

  console.log(`\nDone. Deleted ${deleted.count} labels, reset ${updated.count} frames to PENDING.`);
}

async function resetAll() {
  const [mediaCount, frameCount, labelCount] = await Promise.all([
    prisma.mediaItem.count(),
    prisma.frame.count(),
    prisma.label.count(),
  ]);

  console.log(`\nThis will permanently delete:`);
  console.log(`  - ${mediaCount.toLocaleString()} media item(s)`);
  console.log(`  - ${frameCount.toLocaleString()} frame(s)`);
  console.log(`  - ${labelCount.toLocaleString()} label(s)`);
  console.log(`\nUploaded files on disk are NOT deleted — only the database records.\n`);

  const ans = await ask("Type YES to confirm: ");
  if (ans.trim() !== "YES") { console.log("Aborted."); return; }

  const deleted = await prisma.mediaItem.deleteMany();
  console.log(`\nDone. Deleted ${deleted.count} media item(s) and all their frames and labels.`);
}

async function main() {
  const mode = process.argv[2];
  if (mode === "labels") {
    await resetLabels();
  } else if (mode === "all") {
    await resetAll();
  } else {
    console.log("Usage:");
    console.log("  tsx prisma/reset.ts labels   — clear labels, reset frames to PENDING");
    console.log("  tsx prisma/reset.ts all      — delete everything (media, frames, labels)");
    process.exit(1);
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
