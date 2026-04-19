import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSession } from "@/lib/admin-auth";
import { env } from "@/lib/env";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/") || "/";

  if (!password || !timingSafeEqual(password, env.ADMIN_PASSWORD)) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "1");
    if (next && next !== "/") url.searchParams.set("next", next);
    return NextResponse.redirect(url, { status: 303 });
  }

  const token = await createSession("admin");
  const jar = await cookies();
  jar.set(env.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: env.SESSION_MAX_AGE,
  });
  return NextResponse.redirect(new URL(next.startsWith("/") ? next : "/", req.url), {
    status: 303,
  });
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}
