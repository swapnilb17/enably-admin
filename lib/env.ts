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
  };
  return cache;
}

export const env = new Proxy({} as EnvShape, {
  get(_target, prop: string) {
    return load()[prop as keyof EnvShape];
  },
}) as EnvShape;
