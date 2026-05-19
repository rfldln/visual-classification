import { NextResponse } from "next/server";
import crypto from "crypto";
import path from "path";
import { getUser, unauthorizedResponse } from "@/lib/auth";
import { getSupabaseService } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Returns a Supabase signed upload URL so the browser can PUT the file
 * directly to Supabase Storage — bypassing Vercel entirely.
 *
 * POST body: { filename, mimeType }
 * Response:  { signedUrl, path }
 */
export async function POST(req: Request) {
  const user = await getUser();
  if (!user) return unauthorizedResponse();

  const body = await req.json() as { filename?: string; mimeType?: string };
  const originalName = body.filename ?? "upload.bin";
  const ext = path.extname(originalName).toLowerCase();
  const safeName = crypto.randomBytes(12).toString("hex") + ext;
  const storagePath = `${user.id}/${safeName}`;

  const bucket = process.env.SUPABASE_STORAGE_BUCKET ?? "vault";
  const supabase = getSupabaseService();

  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUploadUrl(storagePath);

  if (error || !data?.signedUrl) {
    return NextResponse.json(
      { error: error?.message ?? "Failed to create signed upload URL" },
      { status: 500 },
    );
  }

  return NextResponse.json({ signedUrl: data.signedUrl, path: storagePath });
}
