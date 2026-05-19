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

export const metadata = { title: "Observability · Enably Admin" };
export const dynamic = "force-dynamic";

const WINDOW_HOURS = 24;

type ProviderRollup = {
  service: string;
  provider: string;
  total: number;
  errors: number;
  durations: number[];
  recentLanguages: Set<string>;
  recentSpan: PhoenixSpan | null;
};

type EndpointRollup = {
  endpoint: string;
  total: number;
  errors: number;
  durations: number[];
};

function summarize(spans: PhoenixSpan[]): {
  providers: ProviderRollup[];
  endpoints: EndpointRollup[];
  totalSpans: number;
  totalErrors: number;
} {
  const providers = new Map<string, ProviderRollup>();
  const endpoints = new Map<string, EndpointRollup>();
  let totalErrors = 0;
  for (const span of spans) {
    const provider = attrString(span, "provider.name");
    const service = attrString(span, "service.name") ?? "—";
    const endpoint = attrString(span, "http.route") ?? span.name;
    const dur = spanDurationMs(span);
    const errored = span.status_code === "ERROR";
    if (errored) totalErrors += 1;

    if (provider) {
      const key = `${service}::${provider}`;
      const existing = providers.get(key) ?? {
        service,
        provider,
        total: 0,
        errors: 0,
        durations: [],
        recentLanguages: new Set<string>(),
        recentSpan: null as PhoenixSpan | null,
      };
      existing.total += 1;
      if (errored) existing.errors += 1;
      if (dur !== null) existing.durations.push(dur);
      const lang = attrString(span, "language");
      if (lang) existing.recentLanguages.add(lang);
      if (
        !existing.recentSpan ||
        Date.parse(span.start_time) > Date.parse(existing.recentSpan.start_time)
      ) {
        existing.recentSpan = span;
      }
      providers.set(key, existing);
    }

    if (endpoint?.startsWith("/")) {
      const ex = endpoints.get(endpoint) ?? {
        endpoint,
        total: 0,
        errors: 0,
        durations: [] as number[],
      };
      ex.total += 1;
      if (errored) ex.errors += 1;
      if (dur !== null) ex.durations.push(dur);
      endpoints.set(endpoint, ex);
    }
  }
  return {
    providers: [...providers.values()].sort((a, b) => b.total - a.total),
    endpoints: [...endpoints.values()].sort((a, b) => b.total - a.total),
    totalSpans: spans.length,
    totalErrors,
  };
}

function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(0.95 * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

function formatMs(v: number | null): string {
  if (v === null) return "—";
  if (v < 1000) return `${Math.round(v)} ms`;
  return `${(v / 1000).toFixed(1)} s`;
}

export default function ObservabilityPage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Observability</h1>
        <RefreshButton />
      </header>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Aggregated from Phoenix spans in project{" "}
        <code>enablyai-vgen-prod</code> over the last {WINDOW_HOURS}h. Click a
        provider for a failure drill-down, or jump to Phoenix for the full
        trace tree.
      </p>
      <Suspense fallback={<div className="card">Loading spans…</div>}>
        <ObservabilityBody />
      </Suspense>
    </div>
  );
}

async function ObservabilityBody() {
  if (!phoenixConfigured()) {
    return (
      <div
        className="card"
        style={{ borderColor: "#f4a261", color: "#f4a261" }}
      >
        Phoenix not configured (PHOENIX_BASE_URL / PHOENIX_API_KEY /
        PHOENIX_PROJECT_ID missing in <code>/etc/enably-admin.env</code>).
      </div>
    );
  }
  let spans: PhoenixSpan[] = [];
  let phoenixError: string | null = null;
  try {
    spans = await listPhoenixSpans({
      maxSpans: 2000,
      windowHours: WINDOW_HOURS,
    });
  } catch (e) {
    phoenixError =
      e instanceof PhoenixError
        ? `Phoenix ${e.status}: ${e.message.slice(0, 200)}`
        : `Phoenix unreachable: ${(e as Error).message?.slice(0, 200)}`;
  }
  if (phoenixError) {
    return (
      <div
        className="card"
        style={{ borderColor: "#f4a261", color: "#f4a261" }}
      >
        {phoenixError}
      </div>
    );
  }
  const summary = summarize(spans);
  const successRate =
    summary.totalSpans === 0
      ? null
      : ((summary.totalSpans - summary.totalErrors) / summary.totalSpans) * 100;
  const phoenixUi = phoenixUiBase();

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KPI label="Spans (24h)" value={String(summary.totalSpans)} />
        <KPI
          label="Success rate"
          value={successRate === null ? "—" : `${successRate.toFixed(2)}%`}
          tone={
            successRate === null
              ? "muted"
              : successRate >= 99
                ? "ok"
                : successRate >= 95
                  ? "warn"
                  : "bad"
          }
        />
        <KPI label="Errors (24h)" value={String(summary.totalErrors)} tone={summary.totalErrors > 0 ? "warn" : "ok"} />
      </div>

      <section className="card flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">Providers</h2>
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
        {summary.providers.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No provider spans in the last {WINDOW_HOURS}h. Either nothing has
            been generated, or the <code>provider.name</code> attribute isn&apos;t
            being emitted (check decorator wiring).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  <th className="text-left py-2 pr-3">Provider</th>
                  <th className="text-right py-2 pr-3">Calls</th>
                  <th className="text-right py-2 pr-3">Errors</th>
                  <th className="text-right py-2 pr-3">Success%</th>
                  <th className="text-right py-2 pr-3">p95</th>
                  <th className="text-left py-2 pr-3">Languages</th>
                  <th className="text-left py-2 pr-3">Last call</th>
                </tr>
              </thead>
              <tbody>
                {summary.providers.map((p) => {
                  const success = ((p.total - p.errors) / p.total) * 100;
                  const tone =
                    success >= 99
                      ? "var(--accent)"
                      : success >= 95
                        ? "#f4a261"
                        : "#e57373";
                  const langs = [...p.recentLanguages].slice(0, 4).join(", ") || "—";
                  return (
                    <tr
                      key={`${p.service}-${p.provider}`}
                      className="border-t"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="py-2 pr-3 font-mono text-xs">
                        <Link
                          className="underline"
                          style={{ color: "var(--accent)" }}
                          href={`/observability/services/${encodeURIComponent(p.provider)}?service=${encodeURIComponent(p.service)}`}
                        >
                          {p.provider}
                        </Link>
                        <span
                          className="ml-2 text-[11px]"
                          style={{ color: "var(--muted)" }}
                        >
                          {p.service}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right">{p.total}</td>
                      <td
                        className="py-2 pr-3 text-right"
                        style={{ color: p.errors > 0 ? "#e57373" : "var(--muted)" }}
                      >
                        {p.errors}
                      </td>
                      <td className="py-2 pr-3 text-right" style={{ color: tone }}>
                        {success.toFixed(2)}%
                      </td>
                      <td className="py-2 pr-3 text-right text-xs">
                        {formatMs(p95(p.durations))}
                      </td>
                      <td
                        className="py-2 pr-3 text-xs"
                        style={{ color: "var(--muted)" }}
                      >
                        {langs}
                      </td>
                      <td
                        className="py-2 pr-3 text-xs"
                        style={{ color: "var(--muted)" }}
                      >
                        {p.recentSpan
                          ? new Date(p.recentSpan.start_time).toISOString().replace("T", " ").slice(0, 19)
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">Endpoints</h2>
          <span className="text-[11px]" style={{ color: "var(--muted)" }}>
            Top routes (auto-instrumented)
          </span>
        </div>
        {summary.endpoints.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No HTTP route spans in the window.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  <th className="text-left py-2 pr-3">Route</th>
                  <th className="text-right py-2 pr-3">Calls</th>
                  <th className="text-right py-2 pr-3">Errors</th>
                  <th className="text-right py-2 pr-3">Success%</th>
                  <th className="text-right py-2 pr-3">p95</th>
                </tr>
              </thead>
              <tbody>
                {summary.endpoints.slice(0, 30).map((e) => {
                  const success =
                    e.total === 0 ? 0 : ((e.total - e.errors) / e.total) * 100;
                  return (
                    <tr
                      key={e.endpoint}
                      className="border-t"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="py-2 pr-3 font-mono text-xs">{e.endpoint}</td>
                      <td className="py-2 pr-3 text-right">{e.total}</td>
                      <td
                        className="py-2 pr-3 text-right"
                        style={{ color: e.errors > 0 ? "#e57373" : "var(--muted)" }}
                      >
                        {e.errors}
                      </td>
                      <td className="py-2 pr-3 text-right">{success.toFixed(2)}%</td>
                      <td className="py-2 pr-3 text-right text-xs">
                        {formatMs(p95(e.durations))}
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
