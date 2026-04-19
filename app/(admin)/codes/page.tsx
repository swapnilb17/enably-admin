import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import {
  createCreditCode,
  deactivateCreditCode,
  listCreditCodes,
  TAG,
  type AdminCreditCode,
  type CreatedCodes,
} from "@/lib/admin-api";

export const metadata = { title: "Credit codes · Enably Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;

type GeneratedSnapshot = Omit<CreatedCodes, "campaign" | "expires_at"> & {
  campaign: string | null;
  expires_at: string | null;
};

async function generateAction(formData: FormData) {
  "use server";
  const credits_each = Number(formData.get("credits_each") ?? 0);
  const count = Number(formData.get("count") ?? 1);
  const max = Number(formData.get("max_redemptions_per_code") ?? 1);
  const expires = String(formData.get("expires_at") ?? "").trim();
  const campaign = String(formData.get("campaign") ?? "").trim();
  if (!credits_each || credits_each <= 0) return;

  const result = await createCreditCode({
    credits_each,
    count,
    max_redemptions_per_code: max,
    expires_at: expires || undefined,
    campaign: campaign || undefined,
  });

  // Pass the freshly-issued codes to the next render via querystring; they are
  // shown ONCE in a "save these now" banner and disappear on next navigation.
  // The list below the form is the long-term record (cached).
  const qs = new URLSearchParams({
    issued: result.codes.join(","),
    credits: String(result.credits_each),
    max: String(result.max_redemptions_per_code),
  });
  if (result.campaign) qs.set("campaign", result.campaign);
  if (result.expires_at) qs.set("expires", result.expires_at);
  redirect(`/codes?${qs.toString()}`);
}

async function deactivateAction(formData: FormData) {
  "use server";
  const code = String(formData.get("code") ?? "").trim();
  if (!code) return;
  await deactivateCreditCode(code);
  revalidateTag(TAG.codes, "max");
  redirect("/codes");
}

function decodeIssued(
  searchParams: Record<string, string | string[] | undefined>,
): GeneratedSnapshot | null {
  const raw = searchParams.issued;
  const issued = Array.isArray(raw) ? raw[0] : raw;
  if (!issued) return null;
  const codes = issued.split(",").filter(Boolean);
  if (codes.length === 0) return null;
  const get = (k: string): string | null => {
    const v = searchParams[k];
    const s = Array.isArray(v) ? v[0] : v;
    return s ?? null;
  };
  return {
    codes,
    count: codes.length,
    credits_each: Number(get("credits") ?? 0),
    max_redemptions_per_code: Number(get("max") ?? 1),
    campaign: get("campaign"),
    expires_at: get("expires"),
  };
}

function describeStatus(row: AdminCreditCode): {
  label: string;
  tone: "ok" | "warn" | "muted";
} {
  if (!row.active) return { label: "Deactivated", tone: "muted" };
  if (row.expires_at && new Date(row.expires_at) <= new Date()) {
    return { label: "Expired", tone: "muted" };
  }
  if (
    row.max_redemptions > 0 &&
    row.redeemed_count >= row.max_redemptions
  ) {
    return { label: "Exhausted", tone: "warn" };
  }
  return { label: "Active", tone: "ok" };
}

export default async function CodesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const issued = decodeIssued(sp);
  const { items, total } = await listCreditCodes(1, PAGE_SIZE, false);

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <h1 className="text-2xl font-semibold">Credit codes</h1>

      {issued ? (
        <div
          className="card flex flex-col gap-3"
          style={{ borderColor: "var(--accent)" }}
        >
          <div className="flex items-center justify-between">
            <h2 className="text-base font-medium">
              Generated {issued.count}{" "}
              {issued.count === 1 ? "code" : "codes"}
            </h2>
            <span className="text-xs" style={{ color: "var(--muted)" }}>
              {issued.credits_each} credits each · max{" "}
              {issued.max_redemptions_per_code === 0
                ? "∞"
                : issued.max_redemptions_per_code}{" "}
              redemptions
              {issued.campaign ? ` · campaign ${issued.campaign}` : ""}
              {issued.expires_at ? ` · expires ${issued.expires_at}` : ""}
            </span>
          </div>
          <pre
            className="rounded p-3 text-xs overflow-x-auto"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid var(--border)",
            }}
          >
            {issued.codes.join("\n")}
          </pre>
          <p className="text-xs" style={{ color: "var(--muted)" }}>
            Copy these now — they remain in the table below for audit, but
            this banner only appears once.
          </p>
        </div>
      ) : null}

      <form action={generateAction} className="card flex flex-col gap-3 text-sm">
        <h2 className="text-base font-medium">Generate codes</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1">
            <span>Credits per code</span>
            <input
              name="credits_each"
              type="number"
              min={1}
              required
              className="rounded border px-2 py-1 bg-transparent"
              style={{ borderColor: "var(--border)" }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>How many codes</span>
            <input
              name="count"
              type="number"
              min={1}
              max={500}
              defaultValue={1}
              className="rounded border px-2 py-1 bg-transparent"
              style={{ borderColor: "var(--border)" }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Max redemptions per code (0 = unlimited)</span>
            <input
              name="max_redemptions_per_code"
              type="number"
              min={0}
              defaultValue={1}
              className="rounded border px-2 py-1 bg-transparent"
              style={{ borderColor: "var(--border)" }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Expires at (optional)</span>
            <input
              name="expires_at"
              type="text"
              placeholder="2026-12-31"
              className="rounded border px-2 py-1 bg-transparent"
              style={{ borderColor: "var(--border)" }}
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span>Campaign (optional, A-Z 0-9 _ - up to 32 chars)</span>
            <input
              name="campaign"
              type="text"
              maxLength={32}
              placeholder="launch_april"
              className="rounded border px-2 py-1 bg-transparent"
              style={{ borderColor: "var(--border)" }}
            />
          </label>
        </div>
        <div>
          <button
            type="submit"
            className="rounded px-3 py-2 text-sm font-medium"
            style={{ background: "var(--accent)", color: "#0b0d12" }}
          >
            Generate
          </button>
        </div>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Codes are shown once after generation. The table below is the
          permanent audit log (cached for {Number(process.env.ADMIN_CACHE_TTL || 60)}
          s).
        </p>
      </form>

      <div className="card flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">Existing codes</h2>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {total} total
          </span>
        </div>
        {items.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No codes issued yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  <th className="text-left py-2 pr-3">Code</th>
                  <th className="text-right py-2 pr-3">Credits</th>
                  <th className="text-right py-2 pr-3">Redemptions</th>
                  <th className="text-left py-2 pr-3">Campaign</th>
                  <th className="text-left py-2 pr-3">Expires</th>
                  <th className="text-left py-2 pr-3">Status</th>
                  <th className="text-right py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((row) => {
                  const status = describeStatus(row);
                  const color =
                    status.tone === "ok"
                      ? "var(--accent)"
                      : status.tone === "warn"
                        ? "#f4a261"
                        : "var(--muted)";
                  return (
                    <tr
                      key={row.code}
                      className="border-t"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <td className="py-2 pr-3 font-mono text-xs">
                        {row.code}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {row.credits_each}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {row.redeemed_count}
                        {row.max_redemptions > 0
                          ? ` / ${row.max_redemptions}`
                          : " / ∞"}
                      </td>
                      <td
                        className="py-2 pr-3"
                        style={{ color: "var(--muted)" }}
                      >
                        {row.campaign ?? "—"}
                      </td>
                      <td
                        className="py-2 pr-3"
                        style={{ color: "var(--muted)" }}
                      >
                        {row.expires_at
                          ? new Date(row.expires_at).toISOString().slice(0, 10)
                          : "—"}
                      </td>
                      <td className="py-2 pr-3" style={{ color }}>
                        {status.label}
                      </td>
                      <td className="py-2 text-right">
                        {row.active ? (
                          <form action={deactivateAction}>
                            <input
                              type="hidden"
                              name="code"
                              value={row.code}
                            />
                            <button
                              type="submit"
                              className="rounded border px-2 py-1 text-xs"
                              style={{
                                borderColor: "var(--border)",
                                color: "var(--muted)",
                              }}
                            >
                              Deactivate
                            </button>
                          </form>
                        ) : (
                          <span
                            className="text-xs"
                            style={{ color: "var(--muted)" }}
                          >
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
