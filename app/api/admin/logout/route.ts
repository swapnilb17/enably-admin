import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

export async function POST(req: Request) {
  const jar = await cookies();
  jar.delete(env.SESSION_COOKIE_NAME);
  return NextResponse.redirect(new URL("/login", req.url), { status: 303 });
}
