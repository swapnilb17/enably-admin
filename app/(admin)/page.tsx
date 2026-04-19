import { Suspense } from "react";
import { getBackendHealth } from "@/lib/admin-api";
import { RefreshButton } from "@/components/refresh-button";

export const metadata = { title: "Overview · Enably Admin" };

export default function AdminHome() {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Overview</h1>
        <RefreshButton />
      </header>
      <Suspense fallback={<div className="card">Checking backend…</div>}>
        <BackendStatusCard />
      </Suspense>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Read endpoints are cached server-side for {process.env.ADMIN_CACHE_TTL ?? 60}s, so opening
        pages multiple times does not generate extra load on the app server. Use Refresh only when
        you need to bust the cache.
      </p>
    </div>
  );
}

async function BackendStatusCard() {
  const health = await getBackendHealth();
  return (
    <section className="card">
      <h2 className="text-sm font-medium mb-1">Backend connectivity</h2>
      {health.reachable ? (
        <p className="text-sm">
          <span className="text-green-400">Reachable</span>
          {health.version ? ` · version ${health.version}` : null}
        </p>
      ) : (
        <p className="text-sm">
          <span className="text-amber-400">Not reachable</span> · status {health.status} ·
          <span className="ml-1 break-all">{health.error}</span>
          <br />
          <span style={{ color: "var(--muted)" }}>
            Add <code>/internal/admin/health</code> on the existing FastAPI and configure
            <code> ADMIN_API_KEY</code> + <code>BACKEND_URL</code> env vars on this host.
          </span>
        </p>
      )}
    </section>
  );
}
