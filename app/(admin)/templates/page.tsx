export const metadata = { title: "Templates · Enably Admin" };

export default function TemplatesPage() {
  return (
    <div className="flex flex-col gap-4 max-w-xl">
      <h1 className="text-2xl font-semibold">Templates</h1>
      <div className="card text-sm">
        Coming soon. This page will let you upload trendy images/videos to S3 and publish them as
        templates that user dashboards pick up via a cached read endpoint.
      </div>
    </div>
  );
}
