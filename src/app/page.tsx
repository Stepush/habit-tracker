import AccessGate from "./access-gate";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ login?: string }>;
}) {
  const query = await searchParams;
  return <AccessGate loginFailed={query.login === "failed"} />;
}
