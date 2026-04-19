export function RefreshButton() {
  return (
    <form action="/api/admin/refresh" method="POST">
      <button
        type="submit"
        className="rounded border px-3 py-1 text-sm"
        style={{ borderColor: "var(--border)" }}
        title="Bust the BFF cache and re-fetch from the app server"
      >
        Refresh
      </button>
    </form>
  );
}
