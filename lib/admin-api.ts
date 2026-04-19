// BFF helpers: call the existing FastAPI /internal/admin/* routes from the
// server only. These are the ONLY functions allowed to talk to the existing
// app server. Every read goes through unstable_cache (60s default) so multiple
// admin page loads collapse into ~1 request per minute per dataset, keeping
// the existing app server load near zero.

import { unstable_cache, revalidateTag } from "next/cache";
import { env } from "@/lib/env";

class BackendError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function backendFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const url = `${env.BACKEND_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  // Reuse the existing FastAPI internal-trust header (matches
  // _require_internal_api_key in EnablyAI_VGEN/backend/app/main.py).
  headers.set("x-internal-api-key", env.INTERNAL_API_SECRET);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store", // we control caching at the helper layer below
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BackendError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---- Tag constants for revalidateTag ----
export const TAG = {
  health: "admin:health",
  users: "admin:users",
  payments: "admin:payments",
  codes: "admin:codes",
  templates: "admin:templates",
  activity: "admin:activity",
} as const;

// Read TTL directly (not via env proxy) so this module can be evaluated
// during `next build` without all required secrets present. Defaults to 60s.
const CACHE_TTL = Number(process.env.ADMIN_CACHE_TTL || "60");
const cacheOpts = (tag: string) => ({
  revalidate: CACHE_TTL,
  tags: [tag],
});

// ---- Read helpers (cached) ----

export const getBackendHealth = unstable_cache(
  async () => {
    try {
      const data = await backendFetch<{ ok: boolean; version?: string }>(
        "/internal/admin/health",
      );
      return { reachable: true as const, ...data };
    } catch (e) {
      const status = e instanceof BackendError ? e.status : 0;
      return {
        reachable: false as const,
        status,
        error: String((e as Error).message ?? e),
      };
    }
  },
  ["backend-health"],
  cacheOpts(TAG.health),
);

export type AdminUser = {
  id: string | number;
  email: string;
  plan?: string;
  credit_balance?: number;
  starter_redeem_completed?: boolean;
  created_at?: string;
  last_seen_at?: string;
};

export const listUsers = unstable_cache(
  async (
    page: number,
    pageSize: number,
    q: string,
  ): Promise<{ items: AdminUser[]; total: number }> => {
    const qs = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    if (q) qs.set("q", q);
    return await backendFetch(`/internal/admin/users?${qs.toString()}`);
  },
  ["admin-users"],
  cacheOpts(TAG.users),
);

export type AdminPayment = {
  id: string;
  user_email: string;
  provider: string;
  status: string;
  amount_paise: number;
  created_at: string;
};

export const listPayments = unstable_cache(
  async (
    page: number,
    pageSize: number,
  ): Promise<{ items: AdminPayment[]; total: number }> => {
    const qs = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    return await backendFetch(`/internal/admin/payments?${qs.toString()}`);
  },
  ["admin-payments"],
  cacheOpts(TAG.payments),
);

// ---- Write helpers (NOT cached, always invalidate the read tag) ----

export async function createCreditCode(input: {
  credits_each: number;
  count?: number;
  max_redemptions_per_code?: number;
  expires_at?: string;
  campaign?: string;
}): Promise<{ codes: string[] }> {
  const result = await backendFetch<{ codes: string[] }>(
    "/internal/admin/codes",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  revalidateTag(TAG.codes, "max");
  return result;
}

// Manual refresh: bust caches on demand from a server action / button click.
export async function refreshAll(): Promise<void> {
  for (const t of Object.values(TAG)) revalidateTag(t, "max");
}
