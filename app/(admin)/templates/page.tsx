import { revalidateTag } from "next/cache";
import { redirect } from "next/navigation";
import {
  deleteTemplate,
  listTemplates,
  regenerateTemplateThumbnail,
  TAG,
  toggleTemplatePublish,
  uploadTemplate,
  type AdminTemplate,
} from "@/lib/admin-api";

export const metadata = { title: "Templates · Enably Admin" };
export const dynamic = "force-dynamic";

const PAGE_SIZE = 48;

async function uploadAction(formData: FormData) {
  "use server";
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    redirect("/templates?err=nofile");
  }
  // Re-pack so we control exactly what's forwarded — the browser may include
  // hidden fields we don't want in the POST to FastAPI.
  const fwd = new FormData();
  fwd.set("file", file, file.name || "upload.bin");
  const copy = (k: string) => {
    const v = formData.get(k);
    if (typeof v === "string" && v.trim() !== "") fwd.set(k, v.trim());
  };
  copy("title");
  copy("kind");
  copy("description");
  copy("category");
  copy("language");
  copy("tags");
  copy("sort_order");
  if (formData.get("published")) fwd.set("published", "true");

  try {
    await uploadTemplate(fwd);
  } catch (e) {
    const msg = encodeURIComponent(
      (e as Error).message?.slice(0, 180) || "upload failed",
    );
    redirect(`/templates?err=${msg}`);
  }
  redirect("/templates?ok=1");
}

async function publishAction(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  const publish = String(formData.get("publish") ?? "") === "true";
  if (!id) return;
  await toggleTemplatePublish(id, publish);
  revalidateTag(TAG.templates, "max");
  redirect("/templates");
}

async function deleteAction(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  await deleteTemplate(id);
  revalidateTag(TAG.templates, "max");
  redirect("/templates");
}

async function regenThumbAction(formData: FormData) {
  "use server";
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  try {
    await regenerateTemplateThumbnail(id);
  } catch (e) {
    const msg = encodeURIComponent(
      (e as Error).message?.slice(0, 180) || "regen failed",
    );
    redirect(`/templates?err=${msg}`);
  }
  revalidateTag(TAG.templates, "max");
  redirect("/templates?ok=thumb");
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const err = typeof sp.err === "string" ? sp.err : null;
  const ok = typeof sp.ok === "string" ? sp.ok : null;
  const { items, total } = await listTemplates(1, PAGE_SIZE, "", "", "");

  return (
    <div className="flex flex-col gap-6 max-w-6xl">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Templates</h1>
        <span className="text-xs" style={{ color: "var(--muted)" }}>
          {total} total · published templates are synced to user dashboards
        </span>
      </div>

      {err ? (
        <div
          className="card text-sm"
          style={{ borderColor: "#f4a261", color: "#f4a261" }}
        >
          Upload failed: {decodeURIComponent(err)}
        </div>
      ) : null}
      {ok ? (
        <div
          className="card text-sm"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          Template uploaded. It will appear for users within ~60s (BFF cache TTL)
          once it&apos;s marked <em>published</em>.
        </div>
      ) : null}

      <form
        action={uploadAction}
        className="card flex flex-col gap-3 text-sm"
        encType="multipart/form-data"
      >
        <h2 className="text-base font-medium">Upload new template</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span>File (image ≤ 10 MB or video ≤ 50 MB)</span>
            <input
              name="file"
              type="file"
              required
              accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
              className="rounded border px-2 py-1 bg-transparent"
              style={{ borderColor: "var(--border)" }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Title</span>
            <input
              name="title"
              type="text"
              required
              maxLength={200}
              className="rounded border px-2 py-1 bg-transparent"
              style={{ borderColor: "var(--border)" }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Kind</span>
            <select
              name="kind"
              required
              defaultValue="image"
              className="rounded border px-2 py-1 bg-transparent"
              style={{ borderColor: "var(--border)" }}
            >
              <option value="image">Image</option>
              <option value="video">Video</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span>Category (optional)</span>
            <input
              name="category"
              type="text"
              maxLength={64}
              placeholder="marketing, social, celebration…"
              className="rounded border px-2 py-1 bg-transparent"
              style={{ borderColor: "var(--border)" }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Language (optional, ISO-ish)</span>
            <input
              name="language"
              type="text"
              maxLength={8}
              placeholder="en, hi, mr…"
              className="rounded border px-2 py-1 bg-transparent"
              style={{ borderColor: "var(--border)" }}
            />
          </label>
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span>Description (optional)</span>
            <textarea
              name="description"
              rows={2}
              maxLength={500}
              className="rounded border px-2 py-1 bg-transparent"
              style={{ borderColor: "var(--border)" }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Tags (comma separated)</span>
            <input
              name="tags"
              type="text"
              maxLength={256}
              placeholder="diwali, sale, sale-poster"
              className="rounded border px-2 py-1 bg-transparent"
              style={{ borderColor: "var(--border)" }}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span>Sort order (lower = shown first)</span>
            <input
              name="sort_order"
              type="number"
              defaultValue={0}
              min={-1000}
              max={1000}
              className="rounded border px-2 py-1 bg-transparent"
              style={{ borderColor: "var(--border)" }}
            />
          </label>
          <label className="flex items-center gap-2 sm:col-span-2">
            <input name="published" type="checkbox" defaultChecked />
            <span>Publish immediately (visible in user dashboards)</span>
          </label>
        </div>
        <div>
          <button
            type="submit"
            className="rounded px-3 py-2 text-sm font-medium"
            style={{ background: "var(--accent)", color: "#0b0d12" }}
          >
            Upload
          </button>
        </div>
      </form>

      <div className="card flex flex-col gap-3">
        <h2 className="text-base font-medium">Gallery</h2>
        {items.length === 0 ? (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            No templates yet. Uploads will appear here.
          </p>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {items.map((t) => (
              <TemplateCard key={t.id} t={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateCard({ t }: { t: AdminTemplate }) {
  return (
    <div
      className="flex flex-col gap-2 rounded border p-2"
      style={{ borderColor: "var(--border)" }}
    >
      <div
        className="relative aspect-video overflow-hidden rounded"
        style={{ background: "rgba(255,255,255,0.04)" }}
      >
        {t.preview_url ? (
          t.kind === "video" ? (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              // Append #t=0.5 so browsers without poster support still seek
              // to a non-black frame for the still preview.
              src={`${t.preview_url}#t=0.5`}
              poster={t.thumbnail_url ?? undefined}
              className="h-full w-full object-cover"
              muted
              loop
              playsInline
              controls
              preload="metadata"
            />
          ) : (
            // Presigned URL is server-generated, intentionally using <img>.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={t.preview_url}
              alt={t.title}
              className="h-full w-full object-cover"
              loading="lazy"
            />
          )
        ) : (
          <div
            className="flex h-full w-full items-center justify-center text-xs"
            style={{ color: "var(--muted)" }}
          >
            preview unavailable
          </div>
        )}
        <span
          className="absolute top-1 left-1 rounded px-1.5 py-0.5 text-[10px] uppercase"
          style={{
            background: "rgba(0,0,0,0.55)",
            color: t.published ? "var(--accent)" : "var(--muted)",
            border: `1px solid ${t.published ? "var(--accent)" : "var(--border)"}`,
          }}
        >
          {t.published ? "Published" : "Draft"}
        </span>
        <span
          className="absolute top-1 right-1 rounded px-1.5 py-0.5 text-[10px]"
          style={{
            background: "rgba(0,0,0,0.55)",
            color: "var(--muted)",
            border: "1px solid var(--border)",
          }}
        >
          {t.kind}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="truncate text-sm font-medium" title={t.title}>
          {t.title}
        </div>
        <div
          className="truncate text-xs"
          style={{ color: "var(--muted)" }}
          title={[t.category, t.language, t.tags].filter(Boolean).join(" · ")}
        >
          {[t.category, t.language].filter(Boolean).join(" · ") || "—"}
          {" · "}
          {fmtBytes(t.size_bytes)}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <form action={publishAction}>
          <input type="hidden" name="id" value={t.id} />
          <input
            type="hidden"
            name="publish"
            value={t.published ? "false" : "true"}
          />
          <button
            type="submit"
            className="rounded border px-2 py-1 text-xs"
            style={{
              borderColor: "var(--border)",
              color: "var(--muted)",
            }}
          >
            {t.published ? "Unpublish" : "Publish"}
          </button>
        </form>
        {t.kind === "video" ? (
          <form action={regenThumbAction}>
            <input type="hidden" name="id" value={t.id} />
            <button
              type="submit"
              title="Re-extract poster frame from this video"
              className="rounded border px-2 py-1 text-xs"
              style={{
                borderColor: "var(--border)",
                color: "var(--muted)",
              }}
            >
              {t.thumbnail_url ? "Refresh thumb" : "Add thumb"}
            </button>
          </form>
        ) : null}
        <form action={deleteAction} className="ml-auto">
          <input type="hidden" name="id" value={t.id} />
          <button
            type="submit"
            className="rounded border px-2 py-1 text-xs"
            style={{
              borderColor: "#aa3333",
              color: "#d88",
            }}
          >
            Delete
          </button>
        </form>
      </div>
    </div>
  );
}
