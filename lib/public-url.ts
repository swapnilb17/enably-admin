// Helper for route handlers that issue redirects.
//
// In Next.js standalone mode, `req.url` is constructed from the bind address
// (HOST=0.0.0.0, PORT=3000), so `new URL(path, req.url)` produces something
// like `http://0.0.0.0:3000/...` and breaks browser-side navigation when the
// app sits behind a reverse proxy (nginx). This helper rebuilds an absolute
// URL using the X-Forwarded-* / Host headers that the proxy already sets.
export function publicUrl(req: Request, path: string): URL {
  const h = req.headers;
  const fwdHost = h.get("x-forwarded-host");
  const host =
    fwdHost?.split(",")[0]?.trim() || h.get("host") || new URL(req.url).host;
  const proto =
    h.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    new URL(req.url).protocol.replace(/:$/, "");
  return new URL(path, `${proto}://${host}`);
}
