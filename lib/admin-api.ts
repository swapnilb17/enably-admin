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

export type ActivityKind = "grant" | "spend" | "refund" | "other";

export type AdminActivityEvent = {
  id: string;
  user_id: string;
  user_email: string;
  delta: number;
  balance_after: number;
  reason: string;
  kind: ActivityKind;
  label: string;
  meta: Record<string, unknown> | null;
  created_at: string | null;
};

export const listActivity = unstable_cache(
  async (
    page: number,
    pageSize: number,
    q: string,
    reason: string,
    kind: string,
  ): Promise<{
    items: AdminActivityEvent[];
    total: number;
    reasons: string[];
  }> => {
    const qs = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    if (q) qs.set("q", q);
    if (reason) qs.set("reason", reason);
    if (kind) qs.set("kind", kind);
    return await backendFetch(`/internal/admin/activity?${qs.toString()}`);
  },
  ["admin-activity"],
  cacheOpts(TAG.activity),
);

export type AdminCreditCode = {
  code: string;
  credits_each: number;
  max_redemptions: number;
  redeemed_count: number;
  active: boolean;
  campaign: string | null;
  expires_at: string | null;
  created_at: string | null;
};

export const listCreditCodes = unstable_cache(
  async (
    page: number,
    pageSize: number,
    activeOnly: boolean,
  ): Promise<{ items: AdminCreditCode[]; total: number }> => {
    const qs = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    if (activeOnly) qs.set("active_only", "true");
    return await backendFetch(`/internal/admin/codes?${qs.toString()}`);
  },
  ["admin-credit-codes"],
  cacheOpts(TAG.codes),
);

// ---- Write helpers (NOT cached, always invalidate the read tag) ----

export type CreatedCodes = {
  codes: string[];
  count: number;
  credits_each: number;
  max_redemptions_per_code: number;
  campaign: string | null;
  expires_at: string | null;
};

export async function createCreditCode(input: {
  credits_each: number;
  count?: number;
  max_redemptions_per_code?: number;
  expires_at?: string;
  campaign?: string;
}): Promise<CreatedCodes> {
  const result = await backendFetch<CreatedCodes>("/internal/admin/codes", {
    method: "POST",
    body: JSON.stringify(input),
  });
  revalidateTag(TAG.codes, "max");
  return result;
}

export async function deactivateCreditCode(
  code: string,
): Promise<{ code: string; active: boolean; was_active: boolean }> {
  const result = await backendFetch<{
    code: string;
    active: boolean;
    was_active: boolean;
  }>(`/internal/admin/codes/${encodeURIComponent(code)}/deactivate`, {
    method: "POST",
  });
  revalidateTag(TAG.codes, "max");
  return result;
}

// ---- Content templates ----

export type AdminTemplate = {
  id: string;
  kind: "image" | "video";
  title: string;
  description: string | null;
  category: string | null;
  language: string | null;
  s3_key: string;
  thumbnail_s3_key: string | null;
  content_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  tags: string | null;
  published: boolean;
  sort_order: number;
  preview_url: string | null;
  thumbnail_url: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export const listTemplates = unstable_cache(
  async (
    page: number,
    pageSize: number,
    q: string,
    kind: string,
    published: string,
  ): Promise<{ items: AdminTemplate[]; total: number }> => {
    const qs = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
    });
    if (q) qs.set("q", q);
    if (kind) qs.set("kind", kind);
    if (published) qs.set("published", published);
    return await backendFetch(`/internal/admin/templates?${qs.toString()}`);
  },
  ["admin-templates"],
  cacheOpts(TAG.templates),
);

/** Stream a multipart upload straight through to FastAPI.
 * We rebuild a fresh FormData rather than forwarding the caller's object so the
 * Content-Type (with boundary) is generated correctly by fetch.
 */
export async function uploadTemplate(form: FormData): Promise<AdminTemplate> {
  const url = `${env.BACKEND_URL}/internal/admin/templates/upload`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "x-internal-api-key": env.INTERNAL_API_SECRET },
    body: form,
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new BackendError(res.status, text || res.statusText);
  }
  const out = (await res.json()) as AdminTemplate;
  revalidateTag(TAG.templates, "max");
  return out;
}

export async function updateTemplate(
  id: string,
  patch: Partial<
    Pick<
      AdminTemplate,
      "title" | "description" | "category" | "language" | "tags" | "published" | "sort_order"
    >
  >,
): Promise<AdminTemplate> {
  const out = await backendFetch<AdminTemplate>(
    `/internal/admin/templates/${encodeURIComponent(id)}`,
    { method: "PATCH", body: JSON.stringify(patch) },
  );
  revalidateTag(TAG.templates, "max");
  return out;
}

export async function toggleTemplatePublish(
  id: string,
  publish: boolean,
): Promise<{ id: string; published: boolean }> {
  const qs = new URLSearchParams({ publish: String(publish) });
  const out = await backendFetch<{ id: string; published: boolean }>(
    `/internal/admin/templates/${encodeURIComponent(id)}/publish?${qs.toString()}`,
    { method: "POST" },
  );
  revalidateTag(TAG.templates, "max");
  return out;
}

/** (Re)generate the JPG poster frame for an existing video template.
 * Useful for backfilling rows that were uploaded before thumbnails shipped,
 * or refreshing one whose auto-pick frame is poor. Image templates 400.
 */
export async function regenerateTemplateThumbnail(id: string): Promise<AdminTemplate> {
  const out = await backendFetch<AdminTemplate>(
    `/internal/admin/templates/${encodeURIComponent(id)}/regenerate-thumbnail`,
    { method: "POST" },
  );
  revalidateTag(TAG.templates, "max");
  return out;
}

export async function deleteTemplate(
  id: string,
): Promise<{ id: string; deleted: boolean; s3_key: string }> {
  const out = await backendFetch<{ id: string; deleted: boolean; s3_key: string }>(
    `/internal/admin/templates/${encodeURIComponent(id)}`,
    { method: "DELETE" },
  );
  revalidateTag(TAG.templates, "max");
  return out;
}

// Manual refresh: bust caches on demand from a server action / button click.
export async function refreshAll(): Promise<void> {
  for (const t of Object.values(TAG)) revalidateTag(t, "max");
}
