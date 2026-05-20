import Link from "next/link";
import { getUser } from "@/lib/auth";

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  return (
    <div className="flex min-h-screen">
      <aside className="flex w-56 flex-col border-r border-zinc-800 bg-zinc-950 p-4">
        <div className="mb-6">
          <h1 className="text-lg font-bold text-accent">Visual Classification</h1>
          <p className="text-xs text-zinc-500">Vault + Grok</p>
        </div>
        <nav className="space-y-1 text-sm">
          <NavLink href="/" label="Dashboard" />
          <NavLink href="/vault" label="Vault" />
          <NavLink href="/grok" label="Grok Test" />
          <NavLink href="/dataset" label="Dataset" />
        </nav>
        <div className="mt-auto pt-6">
          {user && (
            <form action="/auth/signout" method="post" className="space-y-2">
              <p className="truncate text-xs text-zinc-500" title={user.email ?? ""}>
                {user.email ?? "Signed in"}
              </p>
              <button
                type="submit"
                className="w-full rounded border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 hover:text-white"
              >
                Sign out
              </button>
            </form>
          )}
        </div>
      </aside>
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="block rounded px-3 py-2 text-zinc-300 hover:bg-zinc-800 hover:text-white"
    >
      {label}
    </Link>
  );
}
