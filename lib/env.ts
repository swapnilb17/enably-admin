// Centralised, validated server-only env access. Values are loaded LAZILY:
// `next build` only validates them at *runtime* (route handlers / server
// components actually rendered), never at import time. That lets the
// CI build run without production secrets baked in.

type EnvShape = {
  BACKEND_URL: string;
  INTERNAL_API_SECRET: string;
  ADMIN_PASSWORD: string;
  ADMIN_ALLOWLIST_EMAILS: string[];
  SESSION_SECRET: string;
  SESSION_COOKIE_NAME: string;
  SESSION_MAX_AGE: number;
  ADMIN_CACHE_TTL: number;
  SESSION_COOKIE_SECURE: boolean;
  // Phoenix observability + prompt management. Optional: when unset, the
  // Prompts and Observability screens render a "not configured" state instead
  // of failing the whole app.
  PHOENIX_BASE_URL: string;
  PHOENIX_API_KEY: string;
  PHOENIX_PROJECT_ID: string;
  PHOENIX_PROJECT_NAME: string;
  PHOENIX_UI_BASE_URL: string;
  // GitHub PR helper for "promote to code". Optional in the same way as the
  // Phoenix vars; promote-to-code action returns 503 when these are missing.
  GITHUB_REPO: string;
  GITHUB_TOKEN: string;
  GITHUB_DEFAULT_BRANCH: string;
  GITHUB_PROMPT_REGISTRY_PATH: string;
};

function required(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required env var: ${name}. Set it in /etc/enably-admin.env (server) or .env.local (dev).`,
    );
  }
  return value.trim();
}

function optional(value: string | undefined, fallback: string): string {
  return value && value.trim() ? value.trim() : fallback;
}

let cache: EnvShape | null = null;

function load(): EnvShape {
  if (cache) return cache;
  cache = {
    BACKEND_URL: required("BACKEND_URL", process.env.BACKEND_URL).replace(/\/$/, ""),
    INTERNAL_API_SECRET: required("INTERNAL_API_SECRET", process.env.INTERNAL_API_SECRET),
    ADMIN_PASSWORD: required("ADMIN_PASSWORD", process.env.ADMIN_PASSWORD),
    ADMIN_ALLOWLIST_EMAILS: optional(process.env.ADMIN_ALLOWLIST_EMAILS, "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
    SESSION_SECRET: required("SESSION_SECRET", process.env.SESSION_SECRET),
    SESSION_COOKIE_NAME: optional(process.env.SESSION_COOKIE_NAME, "enably_admin_session"),
    SESSION_MAX_AGE: Number(optional(process.env.SESSION_MAX_AGE, "28800")),
    ADMIN_CACHE_TTL: Number(optional(process.env.ADMIN_CACHE_TTL, "60")),
    // Defaults to true in production (HTTPS expected). Set to "false" in
    // /etc/enably-admin.env while serving over plain HTTP during initial
    // bring-up. Flip back to "true" once you add a TLS cert.
    SESSION_COOKIE_SECURE:
      optional(
        process.env.SESSION_COOKIE_SECURE,
        process.env.NODE_ENV === "production" ? "true" : "false",
      ).toLowerCase() === "true",
    // Optional vars: empty string means "not configured" and the
    // corresponding feature degrades gracefully.
    PHOENIX_BASE_URL: optional(process.env.PHOENIX_BASE_URL, "").replace(/\/$/, ""),
    PHOENIX_API_KEY: optional(process.env.PHOENIX_API_KEY, ""),
    PHOENIX_PROJECT_ID: optional(process.env.PHOENIX_PROJECT_ID, ""),
    PHOENIX_PROJECT_NAME: optional(process.env.PHOENIX_PROJECT_NAME, "enablyai-vgen-prod"),
    PHOENIX_UI_BASE_URL: optional(process.env.PHOENIX_UI_BASE_URL, "").replace(/\/$/, ""),
    GITHUB_REPO: optional(process.env.GITHUB_REPO, ""),
    GITHUB_TOKEN: optional(process.env.GITHUB_TOKEN, ""),
    GITHUB_DEFAULT_BRANCH: optional(process.env.GITHUB_DEFAULT_BRANCH, "main"),
    GITHUB_PROMPT_REGISTRY_PATH: optional(
      process.env.GITHUB_PROMPT_REGISTRY_PATH,
      "backend/app/prompts/registry.py",
    ),
  };
  return cache;
}

export const env = new Proxy({} as EnvShape, {
  get(_target, prop: string) {
    return load()[prop as keyof EnvShape];
  },
}) as EnvShape;
