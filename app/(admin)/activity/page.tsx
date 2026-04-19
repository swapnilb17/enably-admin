import { Suspense } from "react";
import Link from "next/link";
import {
  listActivity,
  type ActivityKind,
  type AdminActivityEvent,
} from "@/lib/admin-api";
import { RefreshButton } from "@/components/refresh-button";

export const metadata = { title: "Activity log · Enably Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type SearchParams = Promise<{
  page?: string;
  q?: string;
  reason?: string;
  kind?: string;
}>;

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);
  const q = (sp.q ?? "").trim();
  const reason = (sp.reason ?? "").trim();
  const kind = (sp.kind ?? "").trim();

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Activity log</h1>
        <RefreshButton />
      </header>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Sourced from the credit ledger — every signup grant, code redemption,
        payment, generation spend, and refund flows through here.
      </p>
      <Suspense fallback={<div className="card">Loading activity…</div>}>
        <ActivityTable page={page} q={q} reason={reason} kind={kind} />
      </Suspense>
    </div>
  );
}

function buildLink(params: Record<string, string | number | undefined>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === "" || v === 0) continue;
    qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `/activity?${s}` : "/activity";
}

function KindBadge({ kind }: { kind: ActivityKind }) {
  const palette: Record<ActivityKind, { bg: string; fg: string; text: string }> =
    {
      grant: { bg: "rgba(80,180,120,0.15)", fg: "#5fcf91", text: "Grant" },
      spend: { bg: "rgba(220,140,90,0.12)", fg: "#e0a36b", text: "Spend" },
      refund: { bg: "rgba(120,160,220,0.12)", fg: "#7faedf", text: "Refund" },
      other: { bg: "rgba(255,255,255,0.06)", fg: "var(--muted)", text: "Other" },
    };
  const p = palette[kind] ?? palette.other;
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium"
      style={{ background: p.bg, color: p.fg }}
    >
      {p.text}
    </span>
  );
}

function MetaCell({ meta }: { meta: AdminActivityEvent["meta"] }) {
  if (!meta) return <span style={{ color: "var(--muted)" }}>—</span>;
  // Surface the most useful keys first; everything else falls into a tooltip.
  const known = [
    "code",
    "campaign",
    "payment_id",
    "order_id",
    "job_id",
    "model",
    "duration",
    "count",
    "char_count",
    "source",
    "target_balance",
  ];
  const parts: string[] = [];
  for (const k of known) {
    const v = (meta as Record<string, unknown>)[k];
    if (v !== undefined && v !== null && v !== "") {
      parts.push(`${k}=${String(v)}`);
    }
  }
  const txt = parts.length > 0 ? parts.join(" · ") : JSON.stringify(meta);
  return (
    <span
      className="text-[11px] font-mono"
      style={{ color: "var(--muted)" }}
      title={JSON.stringify(meta, null, 2)}
    >
      {txt.length > 90 ? txt.slice(0, 87) + "…" : txt}
    </span>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().replace("T", " ").slice(0, 19) + "Z";
  } catch {
    return iso;
  }
}

async function ActivityTable({
  page,
  q,
  reason,
  kind,
}: {
  page: number;
  q: string;
  reason: string;
  kind: string;
}) {
  let data;
  try {
    data = await listActivity(page, PAGE_SIZE, q, reason, kind);
  } catch (e) {
    return (
      <div className="card text-sm">
        Could not load activity. The backend may not yet expose{" "}
        <code>/internal/admin/activity</code>.
        <br />
        <span style={{ color: "var(--muted)" }}>
          {String((e as Error).message)}
        </span>
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const hasPrev = page > 1;
  const hasNext = page < totalPages;

  return (
    <>
      <form
        className="card flex flex-col gap-3 text-sm sm:flex-row sm:items-end"
        method="GET"
      >
        <label className="flex flex-col gap-1 flex-1">
          <span style={{ color: "var(--muted)" }}>Email contains</span>
          <input
            name="q"
            defaultValue={q}
            placeholder="user@example.com"
            className="rounded border px-2 py-1 bg-transparent"
            style={{ borderColor: "var(--border)" }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span style={{ color: "var(--muted)" }}>Kind</span>
          <select
            name="kind"
            defaultValue={kind}
            className="rounded border px-2 py-1 bg-transparent"
            style={{ borderColor: "var(--border)" }}
          >
            <option value="">All</option>
            <option value="grant">Grant</option>
            <option value="spend">Spend</option>
            <option value="refund">Refund</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span style={{ color: "var(--muted)" }}>Reason</span>
          <select
            name="reason"
            defaultValue={reason}
            className="rounded border px-2 py-1 bg-transparent"
            style={{ borderColor: "var(--border)" }}
          >
            <option value="">All</option>
            {data.reasons.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          className="rounded border px-3 py-1.5"
          style={{ borderColor: "var(--border)" }}
        >
          Apply
        </button>
        <Link
          href="/activity"
          className="rounded px-3 py-1.5 text-xs"
          style={{ color: "var(--muted)" }}
        >
          Clear
        </Link>
      </form>

      <div className="card overflow-x-auto">
        {data.items.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No matching events.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead style={{ color: "var(--muted)" }}>
              <tr className="text-left">
                <th className="py-2 pr-3">When</th>
                <th className="py-2 pr-3">User</th>
                <th className="py-2 pr-3">Kind</th>
                <th className="py-2 pr-3">Activity</th>
                <th className="py-2 pr-3 text-right">Δ</th>
                <th className="py-2 pr-3 text-right">Balance</th>
                <th className="py-2">Details</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => {
                const deltaColor =
                  row.delta > 0 ? "#5fcf91" : row.delta < 0 ? "#e0a36b" : "var(--muted)";
                const deltaSign =
                  row.delta > 0 ? "+" : row.delta < 0 ? "" : "";
                return (
                  <tr
                    key={row.id}
                    className="border-t"
                    style={{ borderColor: "var(--border)" }}
                  >
                    <td className="py-2 pr-3 text-[11px] font-mono" style={{ color: "var(--muted)" }}>
                      {formatTime(row.created_at)}
                    </td>
                    <td className="py-2 pr-3">{row.user_email}</td>
                    <td className="py-2 pr-3">
                      <KindBadge kind={row.kind} />
                    </td>
                    <td className="py-2 pr-3">
                      <span>{row.label}</span>
                      <br />
                      <span
                        className="text-[11px] font-mono"
                        style={{ color: "var(--muted)" }}
                      >
                        {row.reason}
                      </span>
                    </td>
                    <td
                      className="py-2 pr-3 text-right tabular-nums"
                      style={{ color: deltaColor }}
                    >
                      {deltaSign}
                      {row.delta}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {row.balance_after}
                    </td>
                    <td className="py-2 max-w-[28rem]">
                      <MetaCell meta={row.meta} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div className="flex items-center justify-between text-xs" style={{ color: "var(--muted)" }}>
        <span>
          Page {page} of {totalPages} · {data.total} total events
        </span>
        <div className="flex gap-2">
          {hasPrev ? (
            <Link
              href={buildLink({ page: page - 1, q, reason, kind })}
              className="rounded border px-2 py-1"
              style={{ borderColor: "var(--border)" }}
            >
              ← Prev
            </Link>
          ) : (
            <span
              className="rounded border px-2 py-1 opacity-40"
              style={{ borderColor: "var(--border)" }}
            >
              ← Prev
            </span>
          )}
          {hasNext ? (
            <Link
              href={buildLink({ page: page + 1, q, reason, kind })}
              className="rounded border px-2 py-1"
              style={{ borderColor: "var(--border)" }}
            >
              Next →
            </Link>
          ) : (
            <span
              className="rounded border px-2 py-1 opacity-40"
              style={{ borderColor: "var(--border)" }}
            >
              Next →
            </span>
          )}
        </div>
      </div>
    </>
  );
}
