"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CopyButton } from "./CopyButton";

/** Copy-paste setup for one token, per agent. */
export function ConnectAgent({ url, token }: { url: string; token: string }) {
  const mcp = `${url}/mcp`;
  const snippets = [
    {
      id: "claude",
      label: "Claude Code",
      code: `claude mcp add --transport http --scope user indy ${mcp} \\\n  --header "Authorization: Bearer ${token}"`,
    },
    {
      id: "codex",
      label: "Codex",
      code: `# ~/.codex/config.toml\n[mcp_servers.indy]\nurl = "${mcp}"\nbearer_token_env_var = "INDY_TOKEN"\n\n# and in your shell profile\nexport INDY_TOKEN=${token}`,
    },
    {
      id: "any",
      label: "Any MCP client",
      code: `URL     ${mcp}\nHeader  Authorization: Bearer ${token}\nKind    streamable HTTP`,
    },
  ];
  return (
    <Tabs defaultValue="claude" className="gap-3">
      <TabsList>
        {snippets.map((s) => (
          <TabsTrigger key={s.id} value={s.id}>
            {s.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {snippets.map((s) => (
        <TabsContent key={s.id} value={s.id}>
          <div className="relative rounded-lg border border-border bg-sidebar px-4 py-3.5">
            <pre className="scroll-thin overflow-x-auto pr-20 font-mono text-[12.5px] leading-[1.7] text-fg-2 whitespace-pre">
              {s.code}
            </pre>
            <CopyButton text={s.code.replace(/^# .*\n/gm, "")} className="absolute right-2.5 top-2.5" />
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
