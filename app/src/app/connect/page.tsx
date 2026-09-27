import { pageOwner } from "@/lib/auth/page";
import { config } from "@/lib/config";
import { ConnectView } from "@/components/connect/ConnectView";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect an agent" };

export default async function ConnectPage({ searchParams }: { searchParams: Promise<{ welcome?: string; agent?: string }> }) {
  await pageOwner();
  const { welcome, agent } = await searchParams;
  const url = config().url;
  const host = new URL(url).hostname;
  return (
    <ConnectView
      url={url}
      secure={url.startsWith("https://") || ["localhost", "127.0.0.1", "[::1]"].includes(host)}
      welcome={welcome === "1"}
      initialAgent={agent === "codex" || agent === "other" ? agent : "claude"}
      local={config().auth === "local"}
    />
  );
}
