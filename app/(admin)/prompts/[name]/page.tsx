import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { revalidateTag } from "next/cache";
import { TAG, getCodePrompt, type CodePrompt } from "@/lib/admin-api";
import {
  extractPromptText,
  getPhoenixPromptByTag,
  phoenixConfigured,
  PhoenixError,
  phoenixUiBase,
  type PhoenixPromptVersion,
} from "@/lib/phoenix";
import {
  githubConfigured,
  GithubError,
  promotePromptToCode,
} from "@/lib/github";

export const metadata = { title: "Prompt detail · Enably Admin" };
export const dynamic = "force-dynamic";

const CONSTANT_BY_PROMPT: Record<string, string> = {
  "script.monologue.system": "_SCRIPT_MONOLOGUE_SYSTEM",
  "script.conversational.system": "_SCRIPT_CONVERSATIONAL_SYSTEM",
  "image.slide.template": "_IMAGE_SLIDE_TEMPLATE",
};

function bumpVersion(version: string): string {
  // "v1" -> "v2", "v12" -> "v13". Falls back to "<version>+1" if non-numeric.
  const m = version.match(/^v(\d+)$/);
  if (m) return `v${Number(m[1]) + 1}`;
  return `${version}+1`;
}

type LoadResult = {
  code: CodePrompt;
  phoenixVersion: PhoenixPromptVersion | null;
  phoenixText: string;
  phoenixError: string | null;
};

async function loadDetail(name: string): Promise<LoadResult | null> {
  let code: CodePrompt;
  try {
    code = await getCodePrompt(name);
  } catch {
    return null;
  }
  if (!phoenixConfigured()) {
    return {
      code,
      phoenixVersion: null,
      phoenixText: "",
      phoenixError:
        "Phoenix not configured (PHOENIX_BASE_URL / PHOENIX_API_KEY missing).",
    };
  }
  try {
    const ver = await getPhoenixPromptByTag(code.phoenix_identifier, "production");
    return {
      code,
      phoenixVersion: ver,
      phoenixText: ver ? extractPromptText(ver) : "",
      phoenixError: null,
    };
  } catch (e) {
    const msg =
      e instanceof PhoenixError
        ? `Phoenix ${e.status}: ${e.message.slice(0, 200)}`
        : `Phoenix unreachable: ${(e as Error).message?.slice(0, 200)}`;
    return { code, phoenixVersion: null, phoenixText: "", phoenixError: msg };
  }
}

export default async function PromptDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { name: rawName } = await params;
  const name = decodeURIComponent(rawName);
  const sp = await searchParams;
  const data = await loadDetail(name);
  if (!data) notFound();

  const okFlag = Array.isArray(sp.ok) ? sp.ok[0] : sp.ok;
  const errFlag = Array.isArray(sp.err) ? sp.err[0] : sp.err;
  const prUrl = Array.isArray(sp.pr) ? sp.pr[0] : sp.pr;

  const inSync = data.phoenixText === data.code.template;
  const phoenixOnly = !data.phoenixVersion && !data.phoenixError;
  const hasConstantMapping = Boolean(CONSTANT_BY_PROMPT[name]);
  const canPromote =
    githubConfigured() &&
    hasConstantMapping &&
    !inSync &&
    !!data.phoenixVersion &&
    !!data.code.version;
  const phoenixUi = phoenixUiBase();
  const editLink =
    phoenixUi && data.phoenixVersion
      ? `${phoenixUi}/prompts/${encodeURIComponent(data.code.phoenix_identifier)}`
      : null;

  async function promoteAction(formData: FormData) {
    "use server";
    const reason = String(formData.get("reason") ?? "").trim();
    const newTemplate = String(formData.get("newTemplate") ?? "");
    if (!newTemplate) {
      redirect(`/prompts/${encodeURIComponent(name)}?err=empty`);
    }
    const constantName = CONSTANT_BY_PROMPT[name];
    if (!constantName) {
      redirect(`/prompts/${encodeURIComponent(name)}?err=no_const`);
    }
    let codePrompt: CodePrompt;
    try {
      codePrompt = await getCodePrompt(name);
    } catch (e) {
      const msg = encodeURIComponent(`load failed: ${(e as Error).message?.slice(0, 100)}`);
      redirect(`/prompts/${encodeURIComponent(name)}?err=${msg}`);
    }
    try {
      const result = await promotePromptToCode({
        promptName: name,
        constantName: CONSTANT_BY_PROMPT[name]!,
        oldVersion: codePrompt.version,
        newVersion: bumpVersion(codePrompt.version),
        newTemplate,
        reason,
      });
      revalidateTag(TAG.prompts, "max");
      redirect(
        `/prompts/${encodeURIComponent(name)}?ok=1&pr=${encodeURIComponent(result.prUrl)}`,
      );
    } catch (e) {
      // Re-throw redirects (Next.js uses thrown errors for navigation).
      if (e instanceof Error && /NEXT_REDIRECT/.test(e.message ?? "")) throw e;
      const status = e instanceof GithubError ? e.status : 500;
      const msg = encodeURIComponent(
        `${status}: ${(e as Error).message?.slice(0, 200) ?? "promote failed"}`,
      );
      redirect(`/prompts/${encodeURIComponent(name)}?err=${msg}`);
    }
  }

  const codePrompt = data.code;
  const newVersionPreview = bumpVersion(codePrompt.version);

  return (
    <div className="flex flex-col gap-4 max-w-7xl">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <Link
            href="/prompts"
            className="text-xs underline"
            style={{ color: "var(--muted)" }}
          >
            ← All prompts
          </Link>
          <h1 className="text-2xl font-semibold mt-1">
            <span className="font-mono text-base">{codePrompt.name}</span>
          </h1>
          <p className="text-xs mt-1" style={{ color: "var(--muted)" }}>
            {codePrompt.description}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editLink ? (
            <a
              href={editLink}
              target="_blank"
              rel="noreferrer"
              className="rounded border px-3 py-1.5 text-xs"
              style={{ borderColor: "var(--border)" }}
            >
              Edit in Phoenix ↗
            </a>
          ) : null}
        </div>
      </header>

      {data.phoenixError ? (
        <div className="card" style={{ borderColor: "#f4a261", color: "#f4a261" }}>
          {data.phoenixError}
        </div>
      ) : null}

      {okFlag ? (
        <div className="card" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
          PR opened: {prUrl ? (
            <a className="underline" href={prUrl} target="_blank" rel="noreferrer">
              {prUrl}
            </a>
          ) : (
            "(see GitHub)"
          )}
        </div>
      ) : null}
      {errFlag ? (
        <div className="card" style={{ borderColor: "#f4a261", color: "#f4a261" }}>
          {decodeURIComponent(errFlag)}
        </div>
      ) : null}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <PromptPanel
          title={`Code (${codePrompt.version})`}
          subtitle={`canonical · ${codePrompt.template.length} chars`}
          body={codePrompt.template}
          tone={inSync ? "ok" : "muted"}
        />
        <PromptPanel
          title={
            data.phoenixVersion
              ? `Phoenix (production)`
              : phoenixOnly
                ? "Phoenix (no production tag)"
                : "Phoenix (unreachable)"
          }
          subtitle={
            data.phoenixVersion
              ? `${data.phoenixVersion.template_format} · ${data.phoenixText.length} chars`
              : phoenixOnly
                ? "Run sync_prompts_to_phoenix.py"
                : "—"
          }
          body={data.phoenixText || "(no Phoenix copy)"}
          tone={
            inSync
              ? "ok"
              : data.phoenixVersion
                ? "warn"
                : "muted"
          }
        />
      </div>

      {hasConstantMapping ? (
        <PromoteSection
          inSync={inSync}
          canPromote={canPromote}
          githubReady={githubConfigured()}
          phoenixText={data.phoenixText}
          codeVersion={codePrompt.version}
          newVersionPreview={newVersionPreview}
          promoteAction={promoteAction}
        />
      ) : (
        <div className="card text-xs" style={{ color: "var(--muted)" }}>
          This prompt isn&apos;t mapped to a Python constant in
          <code> CONSTANT_BY_PROMPT</code>. Add it to enable the promote-to-code
          PR action.
        </div>
      )}
    </div>
  );
}

function PromptPanel({
  title,
  subtitle,
  body,
  tone,
}: {
  title: string;
  subtitle: string;
  body: string;
  tone: "ok" | "warn" | "muted";
}) {
  const borderColor =
    tone === "ok"
      ? "var(--accent)"
      : tone === "warn"
        ? "#f4a261"
        : "var(--border)";
  return (
    <section
      className="card flex flex-col gap-2"
      style={{ borderColor }}
    >
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">{title}</h2>
        <span className="text-[11px]" style={{ color: "var(--muted)" }}>
          {subtitle}
        </span>
      </div>
      <pre
        className="text-xs whitespace-pre-wrap break-words rounded p-3"
        style={{
          background: "rgba(255,255,255,0.04)",
          border: "1px solid var(--border)",
          maxHeight: "32rem",
          overflowY: "auto",
        }}
      >
        {body}
      </pre>
    </section>
  );
}

function PromoteSection({
  inSync,
  canPromote,
  githubReady,
  phoenixText,
  codeVersion,
  newVersionPreview,
  promoteAction,
}: {
  inSync: boolean;
  canPromote: boolean;
  githubReady: boolean;
  phoenixText: string;
  codeVersion: string;
  newVersionPreview: string;
  promoteAction: (fd: FormData) => Promise<void>;
}) {
  return (
    <form action={promoteAction} className="card flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-medium">Promote to code</h2>
        <span className="text-[11px]" style={{ color: "var(--muted)" }}>
          {codeVersion} → {newVersionPreview}
        </span>
      </div>
      {!githubReady ? (
        <p className="text-xs" style={{ color: "#f4a261" }}>
          GitHub PR helper is not configured. Set <code>GITHUB_REPO</code> and
          <code> GITHUB_TOKEN</code> in <code>/etc/enably-admin.env</code>{" "}
          (PAT scopes: <code>contents:rw</code>, <code>pull_requests:rw</code>).
        </p>
      ) : inSync ? (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Phoenix and code are byte-equal — nothing to promote.
        </p>
      ) : !canPromote ? (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Phoenix doesn&apos;t have a <code>production</code>-tagged version yet.
          Edit in Phoenix and tag a version <code>production</code>, then come
          back here.
        </p>
      ) : (
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Opens a PR on the FastAPI repo replacing the template body and
          bumping <code>version=</code> in
          <code> backend/app/prompts/registry.py</code>. The next deploy picks
          it up automatically.
        </p>
      )}
      <textarea
        name="newTemplate"
        defaultValue={phoenixText}
        rows={Math.min(20, Math.max(6, phoenixText.split("\n").length + 2))}
        readOnly={!canPromote}
        className="rounded border p-3 font-mono text-xs"
        style={{
          borderColor: "var(--border)",
          background: "rgba(255,255,255,0.03)",
          minHeight: "8rem",
        }}
      />
      <label className="flex flex-col gap-1 text-xs">
        <span>Reason / context for the change (shown in PR body)</span>
        <input
          name="reason"
          type="text"
          maxLength={500}
          disabled={!canPromote}
          placeholder="e.g. tighten word range to 80-130 for sub-60s renders"
          className="rounded border px-2 py-1.5 bg-transparent text-sm"
          style={{ borderColor: "var(--border)" }}
        />
      </label>
      <div>
        <button
          type="submit"
          disabled={!canPromote}
          className="rounded px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          style={{ background: "var(--accent)", color: "#0b0d12" }}
        >
          Open promote PR
        </button>
      </div>
    </form>
  );
}
