import { revalidateTag } from "next/cache";
import { createCreditCode, TAG } from "@/lib/admin-api";

export const metadata = { title: "Credit codes · Enably Admin" };

async function generateAction(formData: FormData) {
  "use server";
  const credits_each = Number(formData.get("credits_each") ?? 0);
  const count = Number(formData.get("count") ?? 1);
  const max = Number(formData.get("max_redemptions_per_code") ?? 1);
  const expires = String(formData.get("expires_at") ?? "").trim();
  const campaign = String(formData.get("campaign") ?? "").trim();
  if (!credits_each || credits_each <= 0) return;
  await createCreditCode({
    credits_each,
    count,
    max_redemptions_per_code: max,
    expires_at: expires || undefined,
    campaign: campaign || undefined,
  });
  revalidateTag(TAG.codes, "max");
}

export default function CodesPage() {
  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <h1 className="text-2xl font-semibold">Credit codes</h1>
      <form action={generateAction} className="card flex flex-col gap-3 text-sm">
        <h2 className="text-base font-medium">Generate codes</h2>
        <label>
          Credits per code
          <input
            name="credits_each"
            type="number"
            min={1}
            required
            className="mt-1 w-full rounded border px-2 py-1 bg-transparent"
            style={{ borderColor: "var(--border)" }}
          />
        </label>
        <label>
          How many codes
          <input
            name="count"
            type="number"
            min={1}
            defaultValue={1}
            className="mt-1 w-full rounded border px-2 py-1 bg-transparent"
            style={{ borderColor: "var(--border)" }}
          />
        </label>
        <label>
          Max redemptions per code
          <input
            name="max_redemptions_per_code"
            type="number"
            min={1}
            defaultValue={1}
            className="mt-1 w-full rounded border px-2 py-1 bg-transparent"
            style={{ borderColor: "var(--border)" }}
          />
        </label>
        <label>
          Expires at (optional, ISO date)
          <input
            name="expires_at"
            type="text"
            placeholder="2026-12-31"
            className="mt-1 w-full rounded border px-2 py-1 bg-transparent"
            style={{ borderColor: "var(--border)" }}
          />
        </label>
        <label>
          Campaign (optional)
          <input
            name="campaign"
            type="text"
            className="mt-1 w-full rounded border px-2 py-1 bg-transparent"
            style={{ borderColor: "var(--border)" }}
          />
        </label>
        <button
          type="submit"
          className="rounded px-3 py-2 text-sm font-medium"
          style={{ background: "var(--accent)", color: "#0b0d12" }}
        >
          Generate
        </button>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Generated codes appear once after backend integration is wired.
        </p>
      </form>
    </div>
  );
}
