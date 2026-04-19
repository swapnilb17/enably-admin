import { Suspense } from "react";
import { listUsers } from "@/lib/admin-api";
import { RefreshButton } from "@/components/refresh-button";

export const metadata = { title: "Users · Enably Admin" };

type SearchParams = Promise<{ page?: string; q?: string }>;

export default async function UsersPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const q = (sp.q ?? "").trim();
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Users & credits</h1>
        <RefreshButton />
      </header>
      <form className="flex gap-2 text-sm" method="GET">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search by email"
          className="rounded border px-2 py-1 bg-transparent"
          style={{ borderColor: "var(--border)" }}
        />
        <button className="rounded border px-3 py-1" style={{ borderColor: "var(--border)" }}>
          Search
        </button>
      </form>
      <Suspense fallback={<div className="card">Loading users…</div>}>
        <UsersTable page={page} q={q} />
      </Suspense>
    </div>
  );
}

async function UsersTable({ page, q }: { page: number; q: string }) {
  let data;
  try {
    data = await listUsers(page, 25, q);
  } catch (e) {
    return (
      <div className="card text-sm">
        Could not load users. Backend may not yet expose <code>/internal/admin/users</code>.
        <br />
        <span style={{ color: "var(--muted)" }}>{String((e as Error).message)}</span>
      </div>
    );
  }
  if (!data.items.length) {
    return <div className="card text-sm">No users found.</div>;
  }
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead style={{ color: "var(--muted)" }}>
          <tr className="text-left">
            <th className="py-2">Email</th>
            <th className="py-2">Plan</th>
            <th className="py-2 text-right">Credits</th>
            <th className="py-2">Last seen</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((u) => (
            <tr key={u.id} className="border-t" style={{ borderColor: "var(--border)" }}>
              <td className="py-2">{u.email}</td>
              <td className="py-2">{u.plan ?? "free"}</td>
              <td className="py-2 text-right tabular-nums">{u.credit_balance ?? 0}</td>
              <td className="py-2">{u.last_seen_at ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-xs" style={{ color: "var(--muted)" }}>
        Showing page {page} · total {data.total}
      </p>
    </div>
  );
}
