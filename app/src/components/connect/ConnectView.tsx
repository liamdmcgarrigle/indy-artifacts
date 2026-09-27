"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Globe, KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CopyButton } from "@/components/indy/CopyButton";
import { SackMark } from "@/components/indy/brand";
import { ago } from "@/lib/time";
import { cn } from "@/lib/utils";

type Agent = "claude" | "codex" | "other";
type Method = "browser" | "token";

const REPO = "liamdmcgarrigle/indy-artifacts";

const AGENTS: { id: Agent; name: string; hint: string }[] = [
  { id: "claude", name: "Claude Code", hint: "Anthropic's coding agent" },
  { id: "codex", name: "Codex", hint: "OpenAI's coding agent" },
  { id: "other", name: "Something else", hint: "Any MCP client" },
];

interface Connection {
  id: string;
  name: string;
  kind: "token" | "oauth";
  createdAt: string;
  lastUsedAt: string | null;
}

/** A command to run, with a copy button. `#` lines are shown but not copied. */
function Command({ code }: { code: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-sidebar py-2.5 pl-4 pr-2.5">
      <pre className="scroll-thin m-0 min-w-0 flex-1 overflow-x-auto py-1 font-mono text-[12.5px] leading-[1.7] whitespace-pre text-fg-2">{code}</pre>
      <CopyButton text={code.replace(/^#.*\n?/gm, "").trim()} className="shrink-0" />
    </div>
  );
}

function Step({ n, title, children, done }: { n: number; title: string; children: React.ReactNode; done?: boolean }) {
  return (
    <section className="grid grid-cols-[28px_minmax(0,1fr)] gap-x-4 gap-y-3 max-sm:grid-cols-1">
      <span
        className={cn(
          "flex size-7 items-center justify-center rounded-full text-[13px] font-semibold max-sm:hidden",
          done ? "bg-sand-soft text-sand" : "border border-input text-fg-2",
        )}
      >
        {done ? <Check className="size-3.5" /> : n}
      </span>
      <div className="flex min-w-0 flex-col gap-3.5">
        <h2 className="m-0 pt-0.5 text-base font-semibold">{title}</h2>
        {children}
      </div>
    </section>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return <p className="m-0 text-[13px] leading-relaxed text-fg-3">{children}</p>;
}

/**
 * Connecting an agent, start to finish: pick the agent, run its commands,
 * and watch the connection arrive. Sign-in through the browser (OAuth) is
 * the default; a token is there for machines without a browser, scripts,
 * and Claude Code on an install without HTTPS.
 */
export function ConnectView({
  url,
  secure,
  welcome,
  initialAgent,
  local,
}: {
  url: string;
  secure: boolean;
  welcome: boolean;
  initialAgent: Agent;
  local: boolean;
}) {
  const mcp = `${url}/mcp`;
  const [agent, setAgent] = useState<Agent>(initialAgent);
  // Claude Code only sends OAuth requests over HTTPS (or to localhost).
  const browserWorks = (a: Agent) => a !== "claude" || secure;
  const [method, setMethod] = useState<Method>(browserWorks(initialAgent) ? "browser" : "token");
  const [token, setToken] = useState<{ value: string; name: string } | null>(null);
  const [tokenName, setTokenName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pick = (a: Agent) => {
    setAgent(a);
    setMethod(browserWorks(a) ? "browser" : "token");
    setToken(null);
    setError(null);
  };

  // Watch for the agent to arrive, from the moment the page opened.
  const since = useRef(new Date().toISOString());
  const [seen, setSeen] = useState<Connection | null>(null);
  const [page, setPage] = useState<{ slug: string; title: string } | null>(null);
  useEffect(() => {
    if (local || page) return;
    let stop = false;
    const tick = async () => {
      try {
        const res = await fetch(`/api/agents/activity?since=${encodeURIComponent(since.current)}`, { cache: "no-store" });
        if (res.ok) {
          const data = (await res.json()) as { connections: Connection[]; page: { slug: string; title: string } | null };
          if (!stop) {
            const used = data.connections.filter((c) => c.lastUsedAt).sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""));
            setSeen(used[0] ?? data.connections[0] ?? null);
            if (data.page) setPage(data.page);
          }
        }
      } catch {
        // The next tick tries again.
      }
    };
    void tick();
    const timer = window.setInterval(tick, 2500);
    return () => {
      stop = true;
      window.clearInterval(timer);
    };
  }, [local, page]);

  async function makeToken() {
    setBusy(true);
    setError(null);
    const name = tokenName.trim() || `${AGENTS.find((a) => a.id === agent)!.name} token`;
    try {
      const res = await fetch("/api/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error?.message ?? "That did not work. Try again.");
      setToken({ value: data.token, name });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const connected = Boolean(seen?.lastUsedAt);
  const tokenValue = token?.value ?? "indy_tk_…";

  return (
    <div className="flex min-h-dvh justify-center bg-background px-4 pb-24 pt-8">
      <div className="flex w-full max-w-[760px] flex-col gap-10">
        <header className="flex flex-col gap-6">
          <div className="flex items-center justify-between gap-4">
            {welcome ? (
              <span className="flex items-center gap-2.5">
                <SackMark size={22} strokeWidth={4} className="text-sand" />
                <span className="font-display text-[22px] font-semibold leading-none tracking-[-0.03em]">indy</span>
              </span>
            ) : (
              <Link href="/settings?s=agents" className="flex items-center gap-2 text-[13px] text-muted-foreground hover:text-foreground">
                <ArrowLeft className="size-4" /> Settings
              </Link>
            )}
            <Link href="/" className="text-[13px] text-muted-foreground hover:text-foreground">
              {welcome ? "Skip for now" : "Library"}
            </Link>
          </div>
          <div className="flex flex-col gap-2">
            {welcome ? <span className="text-xs font-semibold tracking-[0.06em] text-sand uppercase">Last step</span> : null}
            <h1 className="m-0 text-[28px] font-semibold tracking-[-0.015em]">Connect an agent</h1>
            <p className="m-0 max-w-[600px] text-[15px] leading-relaxed text-fg-3">
              Your agent publishes to Indy over MCP. Pick the agent, run what it needs in its terminal, and this page shows
              when it connects.
            </p>
          </div>
        </header>

        {local ? (
          <p className="m-0 rounded-xl border border-hairline bg-card p-4 text-sm text-fg-3">
            This install runs without sign-in (<code className="font-mono">INDY_AUTH=local</code>), so an agent only needs the
            address: <code className="font-mono text-fg-2">{mcp}</code>
          </p>
        ) : null}

        <Step n={1} title="Which agent?" done>
          <div role="radiogroup" aria-label="Agent" className="grid grid-cols-3 gap-2.5 max-sm:grid-cols-1">
            {AGENTS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="radio"
                aria-checked={agent === a.id}
                onClick={() => pick(a.id)}
                className={cn(
                  "flex flex-col items-start gap-0.5 rounded-xl border px-4 py-3 text-left transition-colors",
                  agent === a.id ? "border-sand-line bg-sand-soft/40 shadow-[0_0_0_3px_var(--sand-soft)]" : "border-border bg-card hover:border-input",
                )}
              >
                <span className="text-sm font-medium">{a.name}</span>
                <span className="text-xs text-muted-foreground">{a.hint}</span>
              </button>
            ))}
          </div>
        </Step>

        <Step n={2} title="Connect it" done={connected}>
          {local ? null : (
            <div role="radiogroup" aria-label="How it signs in" className="flex w-fit gap-1 rounded-lg border border-border bg-sidebar p-1">
              {(
                [
                  { id: "browser", label: "Sign in with the browser", icon: Globe },
                  { id: "token", label: "Use a token", icon: KeyRound },
                ] as const
              ).map((m) => (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={method === m.id}
                  disabled={m.id === "browser" && !browserWorks(agent)}
                  onClick={() => setMethod(m.id)}
                  className={cn(
                    "flex h-8 items-center gap-1.5 rounded-md px-3 text-[13px] disabled:cursor-not-allowed disabled:opacity-45",
                    method === m.id ? "bg-raised font-medium text-foreground" : "text-fg-3 hover:text-foreground",
                  )}
                >
                  <m.icon className="size-3.5" />
                  {m.label}
                </button>
              ))}
            </div>
          )}
          {!local && !browserWorks(agent) ? (
            <Note>
              Claude Code only signs in through the browser when Indy is on HTTPS, and this install is on plain HTTP. A token
              works just as well. To use the browser, put Indy behind HTTPS (the bundled Caddy, or <code className="font-mono">tailscale serve</code>) and set
              <code className="font-mono"> INDY_URL</code> to the https address.
            </Note>
          ) : null}

          {method === "token" && !local ? (
            token ? (
              <p className="m-0 flex items-center gap-2 text-[13px] text-warn">
                <KeyRound className="size-3.5" /> &ldquo;{token.name}&rdquo; is filled in below. Copy it now; it won&rsquo;t be shown again.
              </p>
            ) : (
              <div className="flex items-end gap-2 max-sm:flex-col max-sm:items-stretch">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="token-name">Name the token after where it runs</Label>
                  <Input
                    id="token-name"
                    placeholder={`e.g. laptop · ${agent === "codex" ? "codex" : agent === "claude" ? "claude code" : "cursor"}`}
                    value={tokenName}
                    onChange={(e) => setTokenName(e.target.value)}
                  />
                </div>
                <Button onClick={makeToken} disabled={busy}>
                  Make a token
                </Button>
              </div>
            )
          ) : null}
          {error ? <p role="alert" className="m-0 text-[13px] text-bad">{error}</p> : null}

          {agent === "claude" ? (
            method === "browser" || local ? (
              <>
                <Command code={`claude mcp add --transport http --scope user indy ${mcp}`} />
                {local ? null : (
                  <>
                    <Note>
                      Then start Claude Code, run <code className="font-mono text-fg-2">/mcp</code>, pick <em>indy</em> and choose
                      Authenticate. Your browser opens on Indy to approve it.
                    </Note>
                    <details className="group rounded-lg border border-hairline px-4 py-3 text-[13px]">
                      <summary className="cursor-pointer text-fg-2">Claude Code runs on a machine without a browser</summary>
                      <div className="flex flex-col gap-3 pt-3">
                        <Command code="claude mcp login indy --no-browser" />
                        <Note>
                          Open the link it prints on any computer signed in to Indy and approve it. The page you land on won&rsquo;t
                          load; copy its address back into the terminal.
                        </Note>
                      </div>
                    </details>
                  </>
                )}
              </>
            ) : (
              <Command code={`claude mcp add --transport http --scope user indy ${mcp} \\\n  --header "Authorization: Bearer ${tokenValue}"`} />
            )
          ) : null}

          {agent === "codex" ? (
            method === "browser" || local ? (
              <>
                <Command code={`codex mcp add indy --url ${mcp}`} />
                {local ? null : (
                  <>
                    <Note>Codex opens your browser on Indy to approve it, and finishes by itself.</Note>
                    <details className="rounded-lg border border-hairline px-4 py-3 text-[13px]">
                      <summary className="cursor-pointer text-fg-2">Codex runs on a machine without a browser</summary>
                      <div className="flex flex-col gap-3 pt-3">
                        <Note>
                          Codex waits for the approval on the machine it runs on. Give it a fixed port, forward that port from your
                          computer, and open the link it prints there:
                        </Note>
                        <Command code={`# in ~/.codex/config.toml on that machine\nmcp_oauth_callback_port = 8765\n\n# from your computer\nssh -L 8765:127.0.0.1:8765 <that machine>`} />
                        <Note>Or use a token instead.</Note>
                      </div>
                    </details>
                  </>
                )}
              </>
            ) : (
              <Command code={`codex mcp add indy --url ${mcp} --bearer-token-env-var INDY_TOKEN\n\n# and in your shell profile\nexport INDY_TOKEN=${tokenValue}`} />
            )
          ) : null}

          {agent === "other" ? (
            <div className="flex flex-col gap-3">
              <Command
                code={
                  method === "browser" || local
                    ? `URL        ${mcp}\nTransport  streamable HTTP\nSign-in    OAuth 2.1 (discovered from the URL)`
                    : `URL        ${mcp}\nTransport  streamable HTTP\nHeader     Authorization: Bearer ${tokenValue}`
                }
              />
              {method === "browser" && !local ? (
                <Note>
                  Indy registers the client itself and asks you to approve it here, so most clients only need the URL. For claude.ai
                  and Claude Desktop, add it under Settings › Connectors › Add custom connector; that needs Indy on a public HTTPS
                  address.
                </Note>
              ) : null}
            </div>
          ) : null}
        </Step>

        {agent !== "other" ? (
          <Step n={3} title="Add the Indy plugin (optional)">
            <Note>
              Two skills, one for publishing pages and one for picking up your comments, and a one-line reminder at the start
              of each session that Indy is there. The connection above works without it.
            </Note>
            <Command
              code={
                agent === "claude"
                  ? `claude plugin marketplace add ${REPO}\nclaude plugin install indy@indy`
                  : `codex plugin marketplace add ${REPO}\ncodex plugin add indy@indy`
              }
            />
            {agent === "codex" ? <Note>Codex asks you once to trust the plugin&rsquo;s hook; <code className="font-mono">/hooks</code> shows it.</Note> : null}
          </Step>
        ) : null}

        <Step n={agent === "other" ? 3 : 4} title="Check it works" done={Boolean(page)}>
          {local ? (
            <Note>Ask your agent to publish something, and it will appear in the library.</Note>
          ) : (
            <div aria-live="polite" className="flex flex-col gap-3 rounded-xl border border-hairline bg-card p-4">
              {connected && seen ? (
                <div className="flex items-center gap-3">
                  <span className="flex size-8 items-center justify-center rounded-full bg-good/15 text-good">
                    <Check className="size-4" />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">&ldquo;{seen.name}&rdquo; is connected</span>
                    <span className="text-xs text-muted-foreground">
                      {seen.kind === "oauth" ? "Signed in through the browser" : "Using a token"} · last call {ago(seen.lastUsedAt!)} ago
                    </span>
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <span className="relative flex size-8 items-center justify-center">
                    <span className="absolute size-2.5 animate-ping rounded-full bg-sand/60 motion-reduce:hidden" />
                    <span className="size-2.5 rounded-full bg-sand" />
                  </span>
                  <span className="flex flex-col">
                    <span className="text-sm font-medium">
                      {seen ? `“${seen.name}” is approved. Waiting for its first call…` : "Waiting for your agent…"}
                    </span>
                    <span className="text-xs text-muted-foreground">This updates by itself once the agent reaches Indy.</span>
                  </span>
                </div>
              )}
              {connected ? (
                page ? (
                  <Link href={`/a/${page.slug}`} className="flex items-center justify-between gap-3 rounded-lg border border-sand-line bg-sand-soft/30 px-3.5 py-2.5 text-sm hover:bg-sand-soft/50">
                    <span className="min-w-0 truncate">
                      Your first page is up: <span className="font-medium">{page.title}</span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-sand" />
                  </Link>
                ) : (
                  <div className="flex flex-col gap-2 border-t border-hairline pt-3">
                    <Note>Now ask it for a page. For example:</Note>
                    <Command code="Publish a one-page summary of this repository to Indy." />
                  </div>
                )
              ) : null}
            </div>
          )}
        </Step>

        <div className="flex justify-end">
          <Button asChild variant={page ? "default" : "outline"}>
            <Link href="/">{welcome ? "Open Indy" : "Done"}</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
