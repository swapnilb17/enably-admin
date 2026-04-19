import Link from "next/link";
import { requireSession } from "@/lib/admin-auth";

// Admin pages call FastAPI and read cookies; they must never be statically
// pre-rendered at build time.
export const dynamic = "force-dynamic";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/users", label: "Users & credits" },
  { href: "/activity", label: "Activity log" },
  { href: "/payments", label: "Payments" },
  { href: "/codes", label: "Credit codes" },
  { href: "/templates", label: "Templates" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return (
    <div className="min-h-screen flex">
      <aside
        className="w-60 border-r p-4 flex flex-col gap-1"
        style={{ borderColor: "var(--border)" }}
      >
        <div className="px-2 py-3 text-sm font-semibold tracking-wide">ENABLY ADMIN</div>
        <nav className="flex flex-col gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded px-2 py-1.5 text-sm hover:bg-white/5"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="mt-auto px-2 pt-4 text-xs" style={{ color: "var(--muted)" }}>
          Signed in as <br />
          <span className="text-foreground">{session.sub}</span>
          <form action="/api/admin/logout" method="POST" className="mt-2">
            <button className="text-xs underline" type="submit">
              Sign out
            </button>
          </form>
        </div>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  );
}
