"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SignInPage() {
  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center bg-zinc-950 text-sm text-zinc-500">Loading…</div>}>
      <SignInForm />
    </Suspense>
  );
}

function SignInForm() {
  const router = useRouter();
  const search = useSearchParams();
  const nextHref = search.get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.replace(nextHref);
    router.refresh();
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-6"
      >
        <div>
          <h1 className="text-xl font-bold text-white">Sign in</h1>
          <p className="text-sm text-zinc-400">Access your visual classification vault.</p>
        </div>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-zinc-400">Email</span>
          <input
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-wide text-zinc-400">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none"
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-white px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
        <p className="text-center text-xs text-zinc-400">
          Don't have an account?{" "}
          <Link href="/auth/signup" className="text-white underline">
            Sign up
          </Link>
        </p>
      </form>
    </div>
  );
}
