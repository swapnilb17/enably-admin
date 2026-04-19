import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { env } from "@/lib/env";
import { publicUrl } from "@/lib/public-url";

export async function POST(req: Request) {
  const jar = await cookies();
  jar.delete(env.SESSION_COOKIE_NAME);
  return NextResponse.redirect(publicUrl(req, "/login"), { status: 303 });
}
