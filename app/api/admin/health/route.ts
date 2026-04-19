import { NextResponse } from "next/server";
import { getBackendHealth } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await getBackendHealth();
  return NextResponse.json({ admin: "ok", backend: result });
}
