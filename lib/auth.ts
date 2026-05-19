import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface AuthedUser {
  id: string;
  email: string | null;
}

export async function getUser(): Promise<AuthedUser | null> {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? null };
}

export class UnauthorizedError extends Error {
  constructor() { super("Unauthorized"); }
}

export async function requireUser(): Promise<AuthedUser> {
  const user = await getUser();
  if (!user) throw new UnauthorizedError();
  return user;
}

export function unauthorizedResponse() {
  return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
}
