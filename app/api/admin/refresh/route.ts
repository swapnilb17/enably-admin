import { NextResponse } from "next/server";
import { refreshAll } from "@/lib/admin-api";

export async function POST(req: Request) {
  await refreshAll();
  const back = req.headers.get("referer");
  if (back) return NextResponse.redirect(back, { status: 303 });
  return NextResponse.json({ ok: true });
}
