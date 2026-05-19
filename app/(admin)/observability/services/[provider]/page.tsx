import Link from "next/link";
import { Suspense } from "react";
import {
  attrString,
  listPhoenixSpans,
  phoenixConfigured,
  PhoenixError,
  phoenixUiBase,
  spanDurationMs,
  type PhoenixSpan,
} from "@/lib/phoenix";
import { RefreshButton } from "@/components/refresh-button";

export const metadata = { title: "Provider · Enably Admin" };
export const dynamic = "force-dynamic";

const WINDOW_HOURS = 24;
const MAX_FAILURES = 50;

type SearchParams = Promise<{ service?: string }>;

export default async function ProviderPage({
  params,
  searchParams,
}: {
  params: Promise<{ provider: string }>;
  searchParams: SearchParams;
}) {
  const { provider: rawProvider } = await params;
  const provider = decodeURIComponent(rawProvider);
  const sp = await searchParams;
  const service = (sp.service ?? "").trim();

  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link
            href="/observability"
            className="text-xs underline"
            style={{ color: "var(--muted)" }}
          >
            ← Observability
          </Link>
          <h1 className="text-2xl font-semibold mt-1 font-mono">
            {provider}
            {service ? (
              <span
                className="ml-2 text-sm"
                style={{ color: "var(--muted)" }}
              >
                {service}
              </span>
            ) : null}
          </h1>
        </div>
        <RefreshButton />
      </header>
      <Suspense fallback={<div className="card">Loading provider data…</div>}>
        <ProviderBody provider={provider} service={service} />
      </Suspense>
    </div>
  );
}

async function ProviderBody({
  provider,
  service,
}: {
  provider: string;
  service: string;
}) {
  if (!phoenixConfigured()) {
    return (
      <div className="card" style={{ borderColor: "#f4a261", color: "#f4a261" }}>
        Phoenix not configured.
      </div>
    );
  }
  let spans: PhoenixSpan[] = [];
  try {
    spans = await listPhoenixSpans({
      maxSpans: 3000,
      windowHours: WINDOW_HOURS,
    });
  } catch (e) {
    return (
      <div className="card" style={{ borderColor: "#f4a261", color: "#f4a261" }}>
        {e instanceof PhoenixError
          ? `Phoenix ${e.status}: ${e.message.slice(0, 200)}`
          : `Phoenix unreachable: ${(e as Error).message?.slice(0, 200)}`}
      </div>
    );
  }
  const filtered = spans.filter((s) => {
    const p = attrString(s, "provider.name");
    if (p !== provider) return false;
    if (service) {
      const svc = attrString(s, "service.name");
      if (svc !== service) return false;
    }
    return true;
  });
  const errors = filtered
    .filter((s) => s.status_code === "ERROR")
    .sort(
      (a, b) => Date.parse(b.start_time) - Date.parse(a.start_time),
    );
  const total = filtered.length;
  const errCount = errors.length;
  const successRate =
    total === 0 ? null : ((total - errCount) / total) * 100;
  const successTone =
    successRate === null
      ? "muted"
      : successRate >= 99
        ? "ok"
        : successRate >= 95
          ? "warn"
          : "bad";
  const phoenixUi = phoenixUiBase();

  // Group failure reasons by error.type for an at-a-glance summary.
  const errorTypes = new Map<string, number>();
  for (const e of errors) {
    const t = attrString(e, "error.type") ?? "Unknown";
    errorTypes.set(t, (errorTypes.get(t) ?? 0) + 1);
  }
  const errorTypeList = [...errorTypes.entries()].sort((a, b) => b[1] - a[1]);

  // Latency stats
  const durations = filtered
    .map(spanDurationMs)
    .filter((d): d is number => d !== null);
  const sorted = [...durations].sort((a, b) => a - b);
  const median = sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)];
  const p95Val =
    sorted.length === 0
      ? null
      : sorted[Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1)];

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <KPI label="Calls (24h)" value={String(total)} />
        <KPI
          label="Success rate"
          value={successRate === null ? "—" : `${successRate.toFixed(2)}%`}
          tone={successTone}
        />
        <KPI label="Median latency" value={fmtMs(median)} />
        <KPI label="p95 latency" value={fmtMs(p95Val)} />
      </div>

      {errorTypeList.length > 0 ? (
        <section className="card flex flex-col gap-2">
          <h2 className="text-base font-medium">Failure reasons</h2>
          <div className="flex flex-wrap gap-2">
            {errorTypeList.map(([t, c]) => (
              <span
                key={t}
                className="rounded px-2 py-1 text-xs font-mono"
                style={{
                  background: "rgba(229,115,115,0.1)",
                  color: "#e57373",
                  border: "1px solid rgba(229,115,115,0.25)",
                }}
              >
                {t} × {c}
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="card flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">
            Recent failures ({Math.min(errors.length, MAX_FAILURES)})
          </h2>
          {phoenixUi ? (
            <a
              href={`${phoenixUi}/projects`}
              target="_blank"
              rel="noreferrer"
              className="text-xs underline"
              style={{ color: "var(--muted)" }}
            >
              Open Phoenix ↗
            </a>
          ) : null}
        </div>
        {errors.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No failures in the last {WINDOW_HOURS}h. {total} successful calls.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  <th className="text-left py-2 pr-3">When</th>
                  <th className="text-left py-2 pr-3">Span</th>
                  <th className="text-left py-2 pr-3">error.type</th>
                  <th className="text-left py-2 pr-3">Status message</th>
                  <th className="text-right py-2 pr-3">Duration</th>
                  <th className="text-right py-2">Trace</th>
                </tr>
              </thead>
              <tbody>
                {errors.slice(0, MAX_FAILURES).map((s) => {
                  const traceLink =
                    phoenixUi && s.context?.trace_id
                      ? `${phoenixUi}/traces/${encodeURIComponent(s.context.trace_id)}`
                      : null;
                  return (
                    <tr
                      key={s.context.span_id}
                      className="border-t"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td
                        className="py-2 pr-3 text-xs"
                        style={{ color: "var(--muted)" }}
                      >
                        {new Date(s.start_time).toISOString().replace("T", " ").slice(0, 19)}
                      </td>
                      <td className="py-2 pr-3 font-mono text-xs">{s.name}</td>
                      <td className="py-2 pr-3 text-xs" style={{ color: "#e57373" }}>
                        {attrString(s, "error.type") ?? "—"}
                      </td>
                      <td className="py-2 pr-3 text-xs">
                        {(s.status_message ?? "").slice(0, 120) || "—"}
                      </td>
                      <td className="py-2 pr-3 text-right text-xs">
                        {fmtMs(spanDurationMs(s))}
                      </td>
                      <td className="py-2 text-right">
                        {traceLink ? (
                          <a
                            href={traceLink}
                            target="_blank"
                            rel="noreferrer"
                            className="text-xs underline"
                            style={{ color: "var(--accent)" }}
                          >
                            View ↗
                          </a>
                        ) : (
                          <span className="text-xs" style={{ color: "var(--muted)" }}>
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function fmtMs(v: number | null): string {
  if (v === null) return "—";
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(1)} s`;
}

function KPI({
  label,
  value,
  tone = "ok",
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn" | "bad" | "muted";
}) {
  const color =
    tone === "ok"
      ? "var(--accent)"
      : tone === "warn"
        ? "#f4a261"
        : tone === "bad"
          ? "#e57373"
          : "var(--muted)";
  return (
    <section className="card">
      <div className="text-[11px] uppercase tracking-wide" style={{ color: "var(--muted)" }}>
        {label}
      </div>
      <div className="mt-1 text-2xl font-semibold" style={{ color }}>
        {value}
      </div>
    </section>
  );
}
