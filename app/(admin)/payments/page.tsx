import { Suspense } from "react";
import { listPayments } from "@/lib/admin-api";
import { RefreshButton } from "@/components/refresh-button";

export const metadata = { title: "Payments · Enably Admin" };

type SearchParams = Promise<{ page?: string }>;

export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Payments</h1>
        <RefreshButton />
      </header>
      <Suspense fallback={<div className="card">Loading payments…</div>}>
        <PaymentsTable page={page} />
      </Suspense>
    </div>
  );
}

async function PaymentsTable({ page }: { page: number }) {
  let data;
  try {
    data = await listPayments(page, 25);
  } catch (e) {
    return (
      <div className="card text-sm">
        Could not load payments. Backend may not yet expose <code>/internal/admin/payments</code>.
        <br />
        <span style={{ color: "var(--muted)" }}>{String((e as Error).message)}</span>
      </div>
    );
  }
  if (!data.items.length) return <div className="card text-sm">No payments yet.</div>;
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead style={{ color: "var(--muted)" }}>
          <tr className="text-left">
            <th className="py-2">When</th>
            <th className="py-2">Email</th>
            <th className="py-2">Provider</th>
            <th className="py-2">Status</th>
            <th className="py-2 text-right">Amount</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((p) => (
            <tr key={p.id} className="border-t" style={{ borderColor: "var(--border)" }}>
              <td className="py-2">{p.created_at}</td>
              <td className="py-2">{p.user_email}</td>
              <td className="py-2">{p.provider}</td>
              <td className="py-2">{p.status}</td>
              <td className="py-2 text-right tabular-nums">
                ₹{(p.amount_paise / 100).toFixed(2)}
              </td>
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
