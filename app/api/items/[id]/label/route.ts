import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { CATEGORY_IDS, type CategoryId } from "@/lib/taxonomy";
import type { Prisma, ReviewStatus } from "@prisma/client";

export const runtime = "nodejs";

interface Body {
  categoryIds?: string[];
  action?: "save" | "skip" | "flag";
  flagReason?: string;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const nextStatusParam = url.searchParams.get("nextStatus");
  const nextCategory = url.searchParams.get("nextCategory");
  const body = (await req.json()) as Body;
  const action = body.action ?? "save";

  const frame = await prisma.frame.findUnique({ where: { id } });
  if (!frame) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const valid = new Set<string>(CATEGORY_IDS as readonly string[]);
  const categoryIds = (body.categoryIds ?? []).filter((c) => valid.has(c)) as CategoryId[];
  const reviewerName = null;

  if (action === "save") {
    await prisma.$transaction([
      prisma.label.deleteMany({ where: { frameId: id } }),
      prisma.label.createMany({
        data: categoryIds.map((c) => ({ frameId: id, categoryId: c })),
        skipDuplicates: true,
      }),
      prisma.frame.update({
        where: { id },
        data: {
          status: "REVIEWED",
          reviewedAt: new Date(),
          reviewerName,
          flagged: false,
          flagReason: null,
        },
      }),
    ]);
  } else if (action === "skip") {
    await prisma.frame.update({
      where: { id },
      data: { status: "SKIPPED", reviewedAt: new Date(), reviewerName },
    });
  } else if (action === "flag") {
    await prisma.frame.update({
      where: { id },
      data: {
        status: "FLAGGED",
        flagged: true,
        flagReason: body.flagReason ?? null,
        reviewedAt: new Date(),
        reviewerName,
      },
    });
  }

  // Determine the scope to find the next frame in. Defaults to the PENDING
  // review queue, but callers (e.g. the Labeled browser) can request the next
  // frame within the REVIEWED set, optionally filtered by category, so that
  // editing a labeled frame does not jump back to the review queue.
  const validStatuses = new Set<ReviewStatus>(["PENDING", "REVIEWED", "SKIPPED", "FLAGGED"]);
  const nextStatus: ReviewStatus =
    nextStatusParam && validStatuses.has(nextStatusParam as ReviewStatus)
      ? (nextStatusParam as ReviewStatus)
      : "PENDING";

  const baseWhere: Prisma.FrameWhereInput = { status: nextStatus };
  if (nextCategory && (CATEGORY_IDS as readonly string[]).includes(nextCategory)) {
    baseWhere.labels = { some: { categoryId: nextCategory } };
  }

  // The Labeled browser orders by createdAt desc, the review queue by createdAt asc.
  const desc = nextStatus !== "PENDING";
  const cursorClause: Prisma.FrameWhereInput = desc
    ? {
        OR: [
          { createdAt: { lt: frame.createdAt } },
          { createdAt: frame.createdAt, id: { lt: frame.id } },
        ],
      }
    : {
        OR: [
          { createdAt: { gt: frame.createdAt } },
          { createdAt: frame.createdAt, id: { gt: frame.id } },
        ],
      };

  const next = await prisma.frame.findFirst({
    where: { AND: [baseWhere, cursorClause] },
    orderBy: [{ createdAt: desc ? "desc" : "asc" }, { id: desc ? "desc" : "asc" }],
  });

  const fallback = next
    ? null
    : await prisma.frame.findFirst({
        where: { ...baseWhere, id: { not: frame.id } },
        orderBy: [{ createdAt: desc ? "desc" : "asc" }, { id: desc ? "desc" : "asc" }],
      });

  return NextResponse.json({
    success: true,
    nextFrameId: (next ?? fallback)?.id ?? null,
  });
}
