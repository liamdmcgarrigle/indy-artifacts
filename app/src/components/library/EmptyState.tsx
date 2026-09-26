import Link from "next/link";
import { SackMark } from "@/components/indy/brand";

export function EmptyState({ title, children, compact }: { title: string; children?: React.ReactNode; compact?: boolean }) {
  return (
    <div className={compact ? "mx-7 rounded-[10px] border border-dashed border-border px-6 py-8 text-center" : "flex flex-col items-center gap-3 px-7 py-24 text-center"}>
      {compact ? null : <SackMark size={28} strokeWidth={3.5} className="text-faint" />}
      <p className="text-sm font-medium text-fg-2">{title}</p>
      {children ? <div className="max-w-md text-[13px] leading-relaxed text-muted-foreground">{children}</div> : null}
    </div>
  );
}

export function ConnectHint() {
  return (
    <EmptyState title="Nothing published yet">
      Agents publish here over MCP. Make a token in{" "}
      <Link href="/settings/agents" className="text-sand-strong underline-offset-2 hover:underline">
        Settings → Agents
      </Link>
      , connect Claude Code or Codex, then ask for a report.
    </EmptyState>
  );
}
