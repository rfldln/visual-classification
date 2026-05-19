import { updateSession } from "@/lib/supabase/middleware";
import type { NextRequest } from "next/server";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Skip static assets, images, and upload routes (large bodies — handled in route handler)
    "/((?!_next/static|_next/image|favicon.ico|api/media|api/vault/upload|api/sources/.*\/thumbnail|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
