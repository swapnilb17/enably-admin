import Link from "next/link";
import { Suspense } from "react";
import { listCodePrompts } from "@/lib/admin-api";
import {
  extractPromptText,
  getPhoenixPromptByTag,
  listPhoenixPrompts,
  phoenixConfigured,
  PhoenixError,
} from "@/lib/phoenix";
import { RefreshButton } from "@/components/refresh-button";

export const metadata = { title: "Prompts · Enably Admin" };
export const dynamic = "force-dynamic";

type DriftStatus = "in-sync" | "drift" | "phoenix-only" | "code-only" | "phoenix-unreachable";

type PromptRow = {
  name: string;
  description: string;
  codeVersion: string | null;
  codeIdentifier: string | null;
  phoenixId: string | null;
  phoenixIdentifier: string | null;
  phoenixVersionId: string | null;
  status: DriftStatus;
  detail?: string;
};

export default function PromptsPage() {
  return (
    <div className="flex flex-col gap-4">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Prompts</h1>
        <RefreshButton />
      </header>
      <p className="text-sm" style={{ color: "var(--muted)" }}>
        Code-canonical templates from <code>app/prompts/registry.py</code>{" "}
        compared with the Phoenix mirror. Edit a prompt in Phoenix, then click
        through to a row to open a &ldquo;promote to code&rdquo; PR.
      </p>
      <Suspense fallback={<div className="card">Loading prompts…</div>}>
        <PromptsTable />
      </Suspense>
    </div>
  );
}

async function loadRows(): Promise<{ rows: PromptRow[]; phoenixError: string | null }> {
  const code = await listCodePrompts();
  if (!phoenixConfigured()) {
    return {
      rows: code.items.map((p) => ({
        name: p.name,
        description: p.description,
        codeVersion: p.version,
        codeIdentifier: p.phoenix_identifier,
        phoenixId: null,
        phoenixIdentifier: null,
        phoenixVersionId: null,
        status: "phoenix-unreachable",
        detail: "Phoenix not configured",
      })),
      phoenixError: "PHOENIX_BASE_URL or PHOENIX_API_KEY missing in /etc/enably-admin.env",
    };
  }
  let phoenixSummaries: Awaited<ReturnType<typeof listPhoenixPrompts>> = [];
  let phoenixErr: string | null = null;
  try {
    phoenixSummaries = await listPhoenixPrompts();
  } catch (e) {
    phoenixErr =
      e instanceof PhoenixError
        ? `Phoenix ${e.status}: ${e.message.slice(0, 160)}`
        : `Phoenix unreachable: ${(e as Error).message?.slice(0, 160)}`;
  }
  const phoenixByName = new Map(phoenixSummaries.map((p) => [p.name, p]));
  const codeByPhoenixIdentifier = new Map(
    code.items.map((p) => [p.phoenix_identifier, p]),
  );

  const rows: PromptRow[] = [];

  for (const codePrompt of code.items) {
    const phoenix = phoenixByName.get(codePrompt.phoenix_identifier);
    if (!phoenix) {
      rows.push({
        name: codePrompt.name,
        description: codePrompt.description,
        codeVersion: codePrompt.version,
        codeIdentifier: codePrompt.phoenix_identifier,
        phoenixId: null,
        phoenixIdentifier: null,
        phoenixVersionId: null,
        status: phoenixErr ? "phoenix-unreachable" : "code-only",
        detail: phoenixErr ?? "Run scripts/sync_prompts_to_phoenix.py to mirror.",
      });
      continue;
    }
    let detail: string | undefined;
    let status: DriftStatus = "in-sync";
    let versionId: string | null = null;
    try {
      const ver = await getPhoenixPromptByTag(codePrompt.phoenix_identifier, "production");
      if (!ver) {
        status = "phoenix-only";
        detail = "Phoenix has the prompt but no `production` tag yet.";
      } else {
        versionId = ver.id;
        const phoenixText = extractPromptText(ver);
        if (phoenixText === codePrompt.template) {
          status = "in-sync";
        } else {
          status = "drift";
          const codeChars = codePrompt.template.length;
          const phoenixChars = phoenixText.length;
          detail = `${phoenixChars - codeChars >= 0 ? "+" : ""}${phoenixChars - codeChars} chars vs code`;
        }
      }
    } catch (e) {
      status = "phoenix-unreachable";
      detail =
        e instanceof PhoenixError
          ? `Phoenix ${e.status}`
          : `Phoenix unreachable`;
    }
    rows.push({
      name: codePrompt.name,
      description: codePrompt.description,
      codeVersion: codePrompt.version,
      codeIdentifier: codePrompt.phoenix_identifier,
      phoenixId: phoenix.id,
      phoenixIdentifier: phoenix.name,
      phoenixVersionId: versionId,
      status,
      detail,
    });
  }

  for (const phoenixPrompt of phoenixSummaries) {
    if (codeByPhoenixIdentifier.has(phoenixPrompt.name)) continue;
    rows.push({
      name: phoenixPrompt.name,
      description: phoenixPrompt.description ?? "",
      codeVersion: null,
      codeIdentifier: null,
      phoenixId: phoenixPrompt.id,
      phoenixIdentifier: phoenixPrompt.name,
      phoenixVersionId: null,
      status: "phoenix-only",
      detail: "Exists in Phoenix but not registered in app/prompts/registry.py",
    });
  }

  return { rows, phoenixError: phoenixErr };
}

async function PromptsTable() {
  const { rows, phoenixError } = await loadRows();
  return (
    <>
      {phoenixError ? (
        <div
          className="card"
          style={{ borderColor: "#f4a261", color: "#f4a261" }}
        >
          {phoenixError}
        </div>
      ) : null}
      <div className="card flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-medium">Registered prompts</h2>
          <span className="text-xs" style={{ color: "var(--muted)" }}>
            {rows.length} total
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No prompts found. Either the FastAPI registry is empty or the
            backend is unreachable.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: "var(--muted)" }}>
                  <th className="text-left py-2 pr-3">Name</th>
                  <th className="text-left py-2 pr-3">Description</th>
                  <th className="text-left py-2 pr-3">Code</th>
                  <th className="text-left py-2 pr-3">Phoenix</th>
                  <th className="text-left py-2 pr-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <PromptRowView key={`${row.name}-${row.phoenixIdentifier ?? ""}`} row={row} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

const STATUS_LABEL: Record<DriftStatus, { label: string; color: string }> = {
  "in-sync": { label: "In sync", color: "var(--accent)" },
  drift: { label: "Drift", color: "#f4a261" },
  "code-only": { label: "Code only", color: "#7faedf" },
  "phoenix-only": { label: "Phoenix only", color: "#7faedf" },
  "phoenix-unreachable": { label: "Phoenix unreachable", color: "var(--muted)" },
};

function PromptRowView({ row }: { row: PromptRow }) {
  const status = STATUS_LABEL[row.status];
  // Detail page key uses the code name when present, else the phoenix name.
  const detailKey = row.name ?? row.phoenixIdentifier ?? "";
  return (
    <tr className="border-t" style={{ borderColor: "var(--border)" }}>
      <td className="py-2 pr-3">
        <Link
          href={`/prompts/${encodeURIComponent(detailKey)}`}
          className="font-mono text-xs underline"
          style={{ color: "var(--accent)" }}
        >
          {row.name}
        </Link>
      </td>
      <td className="py-2 pr-3 text-xs" style={{ color: "var(--muted)" }}>
        {row.description?.slice(0, 120) || "—"}
      </td>
      <td className="py-2 pr-3 text-xs">
        {row.codeVersion ? (
          <span className="font-mono">{row.codeVersion}</span>
        ) : (
          <span style={{ color: "var(--muted)" }}>—</span>
        )}
      </td>
      <td className="py-2 pr-3 text-xs">
        {row.phoenixIdentifier ? (
          <span className="font-mono">{row.phoenixIdentifier}</span>
        ) : (
          <span style={{ color: "var(--muted)" }}>—</span>
        )}
      </td>
      <td className="py-2 pr-3" style={{ color: status.color }}>
        <span className="text-xs">{status.label}</span>
        {row.detail ? (
          <span className="text-xs ml-2" style={{ color: "var(--muted)" }}>
            ({row.detail})
          </span>
        ) : null}
      </td>
    </tr>
  );
}
