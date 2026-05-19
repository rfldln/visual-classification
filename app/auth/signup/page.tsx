"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function SignUpPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    const supabase = createSupabaseBrowserClient();
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    // If email confirmation is disabled, Supabase returns a session immediately.
    if (data.session) {
      router.replace("/");
      router.refresh();
      return;
    }
    setInfo("Check your email to confirm your account, then sign in.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-950 p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-zinc-800 bg-zinc-900 p-6"
      >
        <div>
          <h1 className="text-xl font-bold text-white">Create account</h1>
          <p className="text-sm text-zinc-400">One vault per user, private by default.</p>
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
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-white focus:border-zinc-500 focus:outline-none"
          />
        </label>
        {error && <p className="text-sm text-red-400">{error}</p>}
        {info && <p className="text-sm text-emerald-400">{info}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full rounded bg-white px-3 py-2 text-sm font-medium text-zinc-950 hover:bg-zinc-200 disabled:opacity-50"
        >
          {loading ? "Creating…" : "Create account"}
        </button>
        <p className="text-center text-xs text-zinc-400">
          Already registered?{" "}
          <Link href="/auth/signin" className="text-white underline">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
