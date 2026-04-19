// Centralised, validated server-only env access. Importing this from a Client
// Component will fail at build/runtime — by design.

function required(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new Error(
      `Missing required env var: ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value.trim();
}

function optional(value: string | undefined, fallback: string): string {
  return value && value.trim() ? value.trim() : fallback;
}

export const env = {
  BACKEND_URL: required("BACKEND_URL", process.env.BACKEND_URL).replace(/\/$/, ""),
  ADMIN_API_KEY: required("ADMIN_API_KEY", process.env.ADMIN_API_KEY),
  ADMIN_PASSWORD: required("ADMIN_PASSWORD", process.env.ADMIN_PASSWORD),
  ADMIN_ALLOWLIST_EMAILS: optional(process.env.ADMIN_ALLOWLIST_EMAILS, "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean),
  SESSION_SECRET: required("SESSION_SECRET", process.env.SESSION_SECRET),
  SESSION_COOKIE_NAME: optional(process.env.SESSION_COOKIE_NAME, "enably_admin_session"),
  SESSION_MAX_AGE: Number(optional(process.env.SESSION_MAX_AGE, "28800")),
  ADMIN_CACHE_TTL: Number(optional(process.env.ADMIN_CACHE_TTL, "60")),
};
