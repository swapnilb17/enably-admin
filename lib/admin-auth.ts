import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SignJWT, jwtVerify } from "jose";
import { env } from "@/lib/env";

const ALG = "HS256";

function secret(): Uint8Array {
  return new TextEncoder().encode(env.SESSION_SECRET);
}

export type AdminSession = {
  sub: string; // username or email
  iat: number;
  exp: number;
};

export async function createSession(sub: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return await new SignJWT({})
    .setProtectedHeader({ alg: ALG })
    .setSubject(sub)
    .setIssuedAt(now)
    .setExpirationTime(now + env.SESSION_MAX_AGE)
    .sign(secret());
}

export async function readSession(token: string | undefined): Promise<AdminSession | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: [ALG] });
    if (!payload.sub || !payload.exp || !payload.iat) return null;
    return { sub: String(payload.sub), iat: Number(payload.iat), exp: Number(payload.exp) };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<AdminSession | null> {
  const jar = await cookies();
  return readSession(jar.get(env.SESSION_COOKIE_NAME)?.value);
}

export async function requireSession(): Promise<AdminSession> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}
