import { redirect } from "next/navigation";
import { getSession } from "@/lib/admin-auth";

export const dynamic = "force-dynamic";

type SearchParams = Promise<{ error?: string; next?: string }>;

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await getSession();
  if (session) redirect("/");
  const sp = await searchParams;
  return (
    <main className="min-h-screen grid place-items-center p-6">
      <form
        action="/api/admin/login"
        method="POST"
        className="card w-full max-w-sm flex flex-col gap-3"
      >
        <h1 className="text-xl font-semibold">Enably Admin</h1>
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          Authorised personnel only.
        </p>
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <label className="text-sm">
          Password
          <input
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="mt-1 w-full rounded border px-3 py-2 bg-transparent"
            style={{ borderColor: "var(--border)" }}
          />
        </label>
        {sp.error ? (
          <p className="text-sm text-red-400">Login failed. Please try again.</p>
        ) : null}
        <button
          type="submit"
          className="rounded px-3 py-2 text-sm font-medium"
          style={{ background: "var(--accent)", color: "#0b0d12" }}
        >
          Sign in
        </button>
      </form>
    </main>
  );
}
