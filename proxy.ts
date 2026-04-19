import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Edge-safe: only checks for cookie presence + JWT signature. Real
// authorization (allowlist, etc.) happens in server components / route
// handlers via lib/admin-auth.ts.

const COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "enably_admin_session";
const SECRET = process.env.SESSION_SECRET || "";

export const config = {
  matcher: [
    // Protect everything except: login page, the login API, _next assets, favicon, public files.
    "/((?!login|api/admin/login|_next/static|_next/image|favicon.ico|robots.txt).*)",
  ],
};

export async function proxy(req: NextRequest) {
  const token = req.cookies.get(COOKIE_NAME)?.value;
  if (!token || !SECRET) return redirectToLogin(req);
  try {
    await jwtVerify(token, new TextEncoder().encode(SECRET), { algorithms: ["HS256"] });
    return NextResponse.next();
  } catch {
    return redirectToLogin(req);
  }
}

function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname);
  return NextResponse.redirect(url);
}
