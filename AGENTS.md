<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version (16.x) has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Non-negotiables for this repo

1. **Never call user-facing endpoints on the existing app server.** The admin
   app talks only to `/internal/admin/*` on the FastAPI backend, via the
   helpers in `lib/admin-api.ts`. Adding a new admin feature means adding a
   new `/internal/admin/...` route on the backend first.
2. **Cache every read.** All read helpers must go through `unstable_cache`
   with a tag. Default TTL is `ADMIN_CACHE_TTL` seconds. Manual refresh uses
   `revalidateTag`. No client-side polling, no SWR, no `revalidateOnFocus`.
3. **No secrets in the browser.** `lib/env.ts` is server-only. `BACKEND_URL`
   and `ADMIN_API_KEY` must never end up in a Client Component or be
   serialised to the client.
4. **Server Components by default.** Add `"use client"` only when you truly
   need browser-only interactivity.
5. **Pagination is required** on every list endpoint. No unbounded queries.
