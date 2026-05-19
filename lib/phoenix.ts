// Server-only HTTP client for Phoenix (running on the same EC2 as this Next.js
// app, bound to 127.0.0.1:6006). Browser never sees the API key. All reads go
// through unstable_cache wrappers in lib/admin-api.ts; this module only knows
// how to shape requests and parse responses.
//
// Why server-only? PHOENIX_API_KEY is a system-level credential that can read
// every span in every project. It must never be serialised to a client bundle.
// Importing this file from a "use client" component would defeat that.

import "server-only";

import { env } from "@/lib/env";

export class PhoenixError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "PhoenixError";
  }
}

function isConfigured(): boolean {
  return Boolean(env.PHOENIX_BASE_URL && env.PHOENIX_API_KEY);
}

export function phoenixConfigured(): boolean {
  return isConfigured();
}

/** UI base URL surfaced to operators in deep links. Falls back to the API
 * base when PHOENIX_UI_BASE_URL is unset (useful for local dev). Returns
 * empty string when the API itself is unconfigured so callers can branch. */
export function phoenixUiBase(): string {
  if (!isConfigured()) return "";
  return env.PHOENIX_UI_BASE_URL || env.PHOENIX_BASE_URL;
}

async function phoenixFetch<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 10_000,
): Promise<T> {
  if (!isConfigured()) {
    throw new PhoenixError(503, "PHOENIX_BASE_URL or PHOENIX_API_KEY not configured");
  }
  const url = `${env.PHOENIX_BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${env.PHOENIX_API_KEY}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new PhoenixError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------

export type PhoenixPromptSummary = {
  id: string;
  name: string;
  description: string | null;
  source_prompt_id: string | null;
  metadata: Record<string, unknown>;
};

type PhoenixPromptsListResponse = {
  data: PhoenixPromptSummary[];
  next_cursor: string | null;
};

export async function listPhoenixPrompts(): Promise<PhoenixPromptSummary[]> {
  const out: PhoenixPromptSummary[] = [];
  let cursor: string | null = null;
  // Paginate until exhausted; the registry has 3 entries today, but stay safe.
  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const page: PhoenixPromptsListResponse = await phoenixFetch(
      `/v1/prompts?${qs.toString()}`,
    );
    out.push(...(page.data ?? []));
    cursor = page.next_cursor;
  } while (cursor);
  return out;
}

/** A single message inside a CHAT-template prompt version. */
type PhoenixPromptVersionMessage = {
  role: string;
  content: Array<{ type: string; text?: string }>;
};

type PhoenixPromptVersionTemplate =
  | { type: "chat"; messages: PhoenixPromptVersionMessage[] }
  | { type: "string"; template: string };

export type PhoenixPromptVersion = {
  id: string;
  description: string | null;
  model_provider: string | null;
  model_name: string | null;
  template_type: "CHAT" | "STRING";
  template_format: string;
  template: PhoenixPromptVersionTemplate;
  invocation_parameters: Record<string, unknown>;
};

/** Pull the version currently tagged ``production`` (the tag the sync script
 * applies after upserting). Returns null on 404 so callers can show a "not in
 * Phoenix yet" state instead of crashing. */
export async function getPhoenixPromptByTag(
  identifier: string,
  tag = "production",
): Promise<PhoenixPromptVersion | null> {
  try {
    const res: { data: PhoenixPromptVersion } = await phoenixFetch(
      `/v1/prompts/${encodeURIComponent(identifier)}/tags/${encodeURIComponent(tag)}`,
    );
    return res.data;
  } catch (e) {
    if (e instanceof PhoenixError && e.status === 404) return null;
    throw e;
  }
}

/** Extract the first system-message text from a Phoenix prompt version,
 * regardless of whether the template is CHAT or STRING. Returns empty string
 * if the shape is unexpected so the diff view stays renderable. */
export function extractPromptText(version: PhoenixPromptVersion): string {
  const t = version.template;
  if (t.type === "string") return t.template ?? "";
  if (t.type === "chat") {
    for (const msg of t.messages ?? []) {
      for (const part of msg.content ?? []) {
        if (part.type === "text" && typeof part.text === "string") {
          return part.text;
        }
      }
    }
  }
  return "";
}

// ---------------------------------------------------------------------------
// Spans (observability dashboards)
// ---------------------------------------------------------------------------

export type PhoenixSpan = {
  context: { span_id: string; trace_id: string };
  name: string;
  span_kind: string;
  start_time: string;
  end_time: string | null;
  status_code: "OK" | "ERROR" | "UNSET";
  status_message?: string | null;
  attributes: Record<string, unknown>;
  parent_id: string | null;
};

type PhoenixSpansResponse = {
  data: PhoenixSpan[];
  next_cursor: string | null;
};

/** Fetch up to ``maxSpans`` recent spans for the configured project. Phoenix
 * paginates server-side; we stop once we have enough or the cursor is null.
 *
 * NB: Phoenix v15.x doesn't accept arbitrary attribute filters on this REST
 * endpoint, so we filter in JS after fetching. The v1/spans response is small
 * (~1KB / span) and we cap fetches, so memory is bounded. */
export async function listPhoenixSpans(opts: {
  maxSpans?: number;
  /** ISO timestamp. Takes precedence over ``windowHours`` if both are set. */
  startTime?: string;
  /** Convenience: "last N hours". Computed inside the helper (not in a
   * Server Component body) so the react-hooks/purity rule stays satisfied. */
  windowHours?: number;
  endTime?: string;
} = {}): Promise<PhoenixSpan[]> {
  const max = Math.min(Math.max(1, opts.maxSpans ?? 1000), 5000);
  const windowHours = opts.windowHours ?? 24;
  const start =
    opts.startTime ??
    new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const projectId = env.PHOENIX_PROJECT_ID;
  if (!projectId) {
    throw new PhoenixError(503, "PHOENIX_PROJECT_ID not configured");
  }
  const out: PhoenixSpan[] = [];
  let cursor: string | null = null;
  while (out.length < max) {
    const qs = new URLSearchParams({
      limit: String(Math.min(500, max - out.length)),
      start_time: start,
    });
    if (opts.endTime) qs.set("end_time", opts.endTime);
    if (cursor) qs.set("cursor", cursor);
    const page: PhoenixSpansResponse = await phoenixFetch(
      `/v1/projects/${encodeURIComponent(projectId)}/spans?${qs.toString()}`,
      {},
      20_000,
    );
    out.push(...(page.data ?? []));
    cursor = page.next_cursor;
    if (!cursor) break;
  }
  return out;
}

/** Span attributes are stored flat with dotted keys
 * (``http.status_code``, ``provider.name``…). Helper to read them safely. */
export function attr(span: PhoenixSpan, key: string): unknown {
  return span.attributes?.[key];
}

export function attrString(span: PhoenixSpan, key: string): string | null {
  const v = attr(span, key);
  if (v === null || v === undefined) return null;
  return String(v);
}

export function attrNumber(span: PhoenixSpan, key: string): number | null {
  const v = attr(span, key);
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function spanDurationMs(span: PhoenixSpan): number | null {
  if (!span.end_time) return null;
  const start = Date.parse(span.start_time);
  const end = Date.parse(span.end_time);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return end - start;
}
