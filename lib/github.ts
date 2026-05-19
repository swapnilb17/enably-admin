// Server-only GitHub REST client for the "promote to code" PR flow.
//
// Why hand-rolled instead of @octokit/rest? Octokit is ~700 KB minified plus
// transitive deps; we only need 4 endpoints (get/create ref, get/put contents,
// create PR). Plain fetch keeps the standalone bundle small and the surface
// auditable. PAT scope: ``Contents: read+write`` and ``Pull requests: write``
// on a single repo (fine-grained PAT recommended).

import "server-only";

import { env } from "@/lib/env";

export class GithubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "GithubError";
  }
}

export function githubConfigured(): boolean {
  return Boolean(env.GITHUB_REPO && env.GITHUB_TOKEN);
}

async function gh<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<T> {
  if (!githubConfigured()) {
    throw new GithubError(503, "GITHUB_REPO or GITHUB_TOKEN not configured");
  }
  const url = `https://api.github.com${path.startsWith("/") ? path : `/${path}`}`;
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${env.GITHUB_TOKEN}`);
  headers.set("Accept", "application/vnd.github+json");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const res = await fetch(url, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new GithubError(res.status, text || res.statusText);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function repoPath(suffix: string): string {
  return `/repos/${env.GITHUB_REPO}${suffix}`;
}

// ---------------------------------------------------------------------------
// Atomic helpers
// ---------------------------------------------------------------------------

type GitRefResponse = {
  ref: string;
  object: { sha: string };
};

type ContentResponse = {
  content: string; // base64
  sha: string; // tree SHA, needed for PUT
  encoding: string;
  path: string;
};

type PullResponse = {
  number: number;
  html_url: string;
  state: string;
};

async function getDefaultBranchSha(): Promise<string> {
  const branch = env.GITHUB_DEFAULT_BRANCH || "main";
  const ref = await gh<GitRefResponse>(repoPath(`/git/ref/heads/${branch}`));
  return ref.object.sha;
}

async function createBranch(branchName: string, fromSha: string): Promise<void> {
  await gh(repoPath("/git/refs"), {
    method: "POST",
    body: JSON.stringify({
      ref: `refs/heads/${branchName}`,
      sha: fromSha,
    }),
  });
}

async function getFileOnRef(
  path: string,
  ref: string,
): Promise<{ text: string; sha: string }> {
  const qs = new URLSearchParams({ ref });
  const res = await gh<ContentResponse>(
    repoPath(`/contents/${path}?${qs.toString()}`),
  );
  if (res.encoding !== "base64") {
    throw new GithubError(500, `unexpected encoding: ${res.encoding}`);
  }
  // Buffer is available in Node runtime (Next.js server runtime).
  const text = Buffer.from(res.content, "base64").toString("utf8");
  return { text, sha: res.sha };
}

async function putFile(
  path: string,
  branch: string,
  text: string,
  sha: string,
  message: string,
): Promise<void> {
  await gh(repoPath(`/contents/${path}`), {
    method: "PUT",
    body: JSON.stringify({
      message,
      branch,
      content: Buffer.from(text, "utf8").toString("base64"),
      sha,
    }),
  });
}

async function createPullRequest(args: {
  title: string;
  head: string;
  base: string;
  body: string;
}): Promise<PullResponse> {
  return await gh<PullResponse>(repoPath("/pulls"), {
    method: "POST",
    body: JSON.stringify(args),
  });
}

// ---------------------------------------------------------------------------
// Promote-to-code: replace a single template body in registry.py and bump
// its version field. Idempotent in the sense that re-running with unchanged
// inputs is rejected upstream (caller checks drift first).
//
// Design: we do byte-level string replace on the file. registry.py defines
// each template as a dataclass with ``template=_SCRIPT_MONOLOGUE_SYSTEM`` etc.,
// where the constant on the right-hand side is a triple-quoted string. We
// locate the constant by name and swap its body. Bumping ``version="v1"`` to
// ``version="v2"`` happens via a second narrow replace on the *adjacent* line
// inside the same ``_PromptTemplate(...)`` call.
//
// If your registry shape ever drifts from this layout, this helper will fail
// loudly (couldn't find marker -> 422) rather than silently committing
// something wrong. Tests in test_prompt_templates.py guard against the
// constant *name*, but a layout change requires editing the regex below.
// ---------------------------------------------------------------------------

export type PromotePromptArgs = {
  promptName: string; // dotted, e.g. "script.monologue.system"
  constantName: string; // e.g. "_SCRIPT_MONOLOGUE_SYSTEM"
  oldVersion: string; // e.g. "v1"
  newVersion: string; // e.g. "v2"
  newTemplate: string; // raw template body (will be embedded in a triple-quoted string)
  reason: string; // shown in PR body
};

export type PromotePromptResult = {
  prNumber: number;
  prUrl: string;
  branch: string;
};

function shellEscapeForTripleQuote(s: string): string {
  // Triple-quoted strings can't contain three consecutive double-quotes. If
  // the new template has any, fall through to escape them as \" sequences so
  // the file is still syntactically valid Python. Backslashes are also
  // doubled to keep literal backslashes intact.
  if (!s.includes('"""')) return s;
  return s.replace(/\\/g, "\\\\").replace(/"""/g, '\\"\\"\\"');
}

export async function promotePromptToCode(
  args: PromotePromptArgs,
): Promise<PromotePromptResult> {
  if (!githubConfigured()) {
    throw new GithubError(
      503,
      "GitHub PR helper is not configured (set GITHUB_REPO + GITHUB_TOKEN).",
    );
  }
  const path = env.GITHUB_PROMPT_REGISTRY_PATH;
  const baseBranch = env.GITHUB_DEFAULT_BRANCH || "main";
  const baseSha = await getDefaultBranchSha();
  // Branch name includes a short timestamp so promoting the same prompt
  // twice in a day creates distinct PRs (the second one will fail to merge
  // until the first lands, which is the right behaviour).
  const stamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .slice(0, 14);
  const slug = args.promptName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const branchName = `prompt/${slug}-${stamp}`;

  await createBranch(branchName, baseSha);
  const { text: original, sha } = await getFileOnRef(path, branchName);

  // Locate the constant assignment: ``_NAME = """...."""`` (multi-line).
  // The (?:r|R)? optionally matches a raw-string prefix; not used by current
  // registry but harmless. Anchored at line-start to avoid matching inside
  // a docstring or comment.
  const escapedName = args.constantName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const constRegex = new RegExp(
    `^(${escapedName}\\s*=\\s*)(?:r|R)?"""([\\s\\S]*?)"""`,
    "m",
  );
  const constMatch = original.match(constRegex);
  if (!constMatch) {
    throw new GithubError(
      422,
      `Couldn't find constant ${args.constantName} in ${path}. Refusing to commit a guess.`,
    );
  }
  const safeBody = shellEscapeForTripleQuote(args.newTemplate);
  const replacedBody = original.replace(
    constRegex,
    `${constMatch[1]}"""${safeBody}"""`,
  );

  // Bump version: find ``version="v1"`` near the matching _PromptTemplate(...)
  // entry. We anchor on the prompt name to avoid hitting the wrong template.
  // Pattern: "name=\"script.monologue.system\",\n        version=\"v1\","
  const promptNameLit = args.promptName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const oldV = args.oldVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const versionRegex = new RegExp(
    `(name="${promptNameLit}",\\s*\\n\\s*version=")${oldV}(",)`,
    "m",
  );
  if (!versionRegex.test(replacedBody)) {
    throw new GithubError(
      422,
      `Couldn't find version="${args.oldVersion}" near name="${args.promptName}" in ${path}.`,
    );
  }
  const final = replacedBody.replace(
    versionRegex,
    `$1${args.newVersion}$2`,
  );

  if (final === original) {
    throw new GithubError(422, "Computed file is identical to the source; nothing to promote.");
  }

  const commitMessage = `prompts: promote ${args.promptName} ${args.oldVersion} -> ${args.newVersion}`;
  await putFile(path, branchName, final, sha, commitMessage);

  const prBody = [
    `Promoting Phoenix-edited prompt **${args.promptName}** to code.`,
    "",
    `* Old version: \`${args.oldVersion}\``,
    `* New version: \`${args.newVersion}\``,
    "",
    "**Reason / context:**",
    "",
    args.reason || "_(no reason supplied)_",
    "",
    "Generated automatically from the Enably Admin → Prompts UI. The diff",
    "below shows the byte-level change to the registry. After this PR",
    "merges, the next FastAPI deploy picks up the new template and the",
    "Phoenix mirror stays in sync via the next `sync_prompts_to_phoenix.py`",
    "run.",
  ].join("\n");

  const pr = await createPullRequest({
    title: commitMessage,
    head: branchName,
    base: baseBranch,
    body: prBody,
  });

  return { prNumber: pr.number, prUrl: pr.html_url, branch: branchName };
}
