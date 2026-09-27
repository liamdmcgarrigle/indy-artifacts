"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, AtSign, Globe, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { copyText } from "@/lib/clipboard";
import { agoLong } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { AppSettings } from "@/lib/service/settings";
import type { Usage } from "@/lib/service/storage";
import { Card, Head, Row, send, type Say } from "./parts";
import { ThemesSection, type ThemesState } from "./ThemesSection";

interface Token {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  kind: "token" | "oauth";
}

interface Share {
  id: string;
  slug: string;
  title: string;
  url: string;
  mode: "link" | "email";
  allowComments: boolean;
  opens: number;
  lastOpenedAt: string | null;
  expiresAt: string | null;
}

type Section = "account" | "agents" | "themes" | "email" | "shares" | "data";

const MB = 1024 * 1024;
const GB = 1024 * MB;

function bytes(n: number): string {
  if (n >= GB) return `${(n / GB).toFixed(n >= 10 * GB ? 0 : 1)} GB`;
  if (n >= MB) return `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / 1024))} KB`;
}

/**
 * Everything the owner can change without touching the server: their
 * account, their agents' tokens, who pages are shared with, and how much
 * room Indy may take.
 */
export function SettingsView(props: {
  user: { name: string; email: string; twoStep: boolean } | null;
  tokens: Token[];
  shares: Share[];
  settings: AppSettings;
  usage: Usage;
  email: { on: boolean; from: string };
  themes: ThemesState;
}) {
  const [section, setSection] = useState<Section>("account");
  const [tokens, setTokens] = useState(props.tokens);
  const [shares, setShares] = useState(props.shares);
  const [usage, setUsage] = useState(props.usage);
  const [settings, setSettings] = useState(props.settings);
  const [themes, setThemes] = useState(props.themes);
  const [notice, setNotice] = useState<{ kind: "good" | "bad"; text: string } | null>(null);

  // The section is in the address, so a link can open it and Back returns to it.
  useEffect(() => {
    const read = () => {
      const s = new URLSearchParams(window.location.search).get("s") as Section | null;
      if (s && ["account", "agents", "themes", "email", "shares", "data"].includes(s)) setSection(s);
    };
    read();
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  // On a phone the sections are a sideways strip; keep the open one in view.
  useEffect(() => {
    document.querySelector('nav[aria-label="Settings"] [aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [section]);
  const go = (s: Section) => {
    setSection(s);
    window.history.pushState(null, "", `/settings?s=${s}`);
  };

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(t);
  }, [notice]);
  const say = {
    good: (text: string) => setNotice({ kind: "good", text }),
    bad: (err: unknown) => setNotice({ kind: "bad", text: err instanceof Error ? err.message : String(err) }),
  };

  const nav: { id: Section; name: string; hint?: string }[] = [
    { id: "account", name: "Account" },
    { id: "agents", name: "Agents", hint: String(tokens.length) },
    { id: "themes", name: "Themes", hint: String(themes.themes.length) },
    { id: "email", name: "Email", hint: props.email.on ? "on" : "off" },
    { id: "shares", name: "Shared links", hint: String(shares.length) },
    { id: "data", name: "Data", hint: bytes(usage.total) },
  ];

  return (
    <div className="flex min-h-dvh bg-background max-md:flex-col">
      <nav
        aria-label="Settings"
        className="flex w-[248px] shrink-0 flex-col gap-[18px] border-r border-hairline bg-sidebar px-3 py-3.5 max-md:sticky max-md:top-0 max-md:z-20 max-md:w-full max-md:gap-2 max-md:border-r-0 max-md:border-b max-md:px-2 max-md:pb-0"
      >
        <Link href="/" className="flex items-center gap-2.5 rounded-md px-1.5 py-1 text-[13px] text-muted-foreground hover:text-foreground max-md:h-10">
          <ArrowLeft className="size-4" /> Back to library
        </Link>
        <div className="flex flex-col gap-0.5 text-[13px] max-md:flex-row max-md:gap-1 max-md:overflow-x-auto max-md:pb-2">
          <div className="px-2 pb-1.5 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase max-md:hidden">Settings</div>
          {nav.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => go(n.id)}
              aria-current={section === n.id ? "page" : undefined}
              className={cn(
                "flex h-[30px] shrink-0 items-center gap-2.5 rounded-[7px] px-2 text-left max-md:h-9 max-md:px-3",
                section === n.id ? "bg-raised font-medium text-foreground" : "text-fg-2 hover:bg-raised/60 hover:text-foreground",
              )}
            >
              {n.name}
              {n.hint ? <span className="ml-auto text-[11px] text-muted-foreground max-md:ml-0">{n.hint}</span> : null}
            </button>
          ))}
        </div>
      </nav>

      <main className="flex flex-1 justify-center px-4 pt-10 pb-24 max-md:pt-6">
        <div className="flex w-full max-w-[820px] flex-col gap-7">
          {section === "account" ? <AccountSection user={props.user} email={props.email.on} say={say} /> : null}
          {section === "agents" ? <AgentsSection tokens={tokens} setTokens={setTokens} say={say} /> : null}
          {section === "themes" ? <ThemesSection state={themes} setState={setThemes} say={say} /> : null}
          {section === "email" ? <EmailSection email={props.email} /> : null}
          {section === "shares" ? <SharesSection shares={shares} setShares={setShares} say={say} /> : null}
          {section === "data" ? (
            <DataSection settings={settings} usage={usage} onSaved={(s, u) => (setSettings(s), setUsage(u))} say={say} />
          ) : null}
        </div>
      </main>

      {notice ? (
        <div className={notice.kind === "bad" ? "toast toast--bad" : "toast toast--good"} role="status">
          {notice.text}
        </div>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------- account

function AccountSection({ user, email, say }: { user: { name: string; email: string; twoStep: boolean } | null; email: boolean; say: Say }) {
  const [profile, setProfile] = useState({ name: user?.name ?? "", email: user?.email ?? "" });
  const [pw, setPw] = useState({ current: "", next: "" });
  const [twoStep, setTwoStep] = useState(user?.twoStep ?? false);
  // Changing the email or turning sign-in codes off asks for the password again.
  const [confirmPw, setConfirmPw] = useState("");
  const [turningOff, setTurningOff] = useState(false);
  const [offPw, setOffPw] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  if (!user) {
    return (
      <>
        <Head title="Account" lede="This install runs without sign-in (INDY_AUTH=local), so there is no account to change." />
      </>
    );
  }

  const emailChanged = profile.email.trim().toLowerCase() !== user.email.toLowerCase();

  async function run(payload: Record<string, unknown>, done: string) {
    setBusy(true);
    try {
      await send("/api/account", "PATCH", payload);
      say.good(done);
      // The section is rebuilt from the server's copy on every tab switch.
      router.refresh();
      return true;
    } catch (err) {
      say.bad(err);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Head title="Account" lede="The one account on this install. Everything your agents publish belongs to it." />
      <Card title="You">
        <form
          className="flex flex-col gap-4 p-[18px]"
          onSubmit={(e) => {
            e.preventDefault();
            const payload: Record<string, unknown> = { name: profile.name, email: profile.email };
            if (emailChanged) payload.current_password = confirmPw;
            void run(payload, "Saved.").then((ok) => ok && setConfirmPw(""));
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="acct-name">Name</Label>
              <Input id="acct-name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="acct-email">Email</Label>
              <Input id="acct-email" type="email" value={profile.email} onChange={(e) => setProfile({ ...profile, email: e.target.value })} />
            </div>
          </div>
          {emailChanged ? (
            <div className="flex flex-col gap-1.5 sm:max-w-[calc(50%-8px)]">
              <Label htmlFor="acct-confirm">Current password</Label>
              <Input
                id="acct-confirm"
                type="password"
                autoComplete="current-password"
                value={confirmPw}
                onChange={(e) => setConfirmPw(e.target.value)}
              />
              <p className="m-0 text-xs text-muted-foreground">Sign-in codes go to this address, so changing it needs your password.</p>
            </div>
          ) : null}
          <div>
            <Button type="submit" size="sm" disabled={busy || (profile.name === user.name && !emailChanged) || (emailChanged && !confirmPw)}>
              Save
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Password">
        <form
          className="flex flex-col gap-4 p-[18px]"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await run({ current_password: pw.current, new_password: pw.next }, "Password changed.")) setPw({ current: "", next: "" });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw-current">Current password</Label>
              <Input id="pw-current" type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="pw-next">New password</Label>
              <Input id="pw-next" type="password" autoComplete="new-password" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
            </div>
          </div>
          <div>
            <Button type="submit" size="sm" variant="outline" disabled={busy || !pw.current || pw.next.length < 10}>
              Change password
            </Button>
          </div>
        </form>
      </Card>

      <Card>
        <Row
          label="Sign-in code"
          htmlFor="two-step"
          help={email ? "After your password, enter a six-digit code sent to your email." : "Needs email set up first (Settings › Email)."}
        >
          <Switch
            id="two-step"
            checked={twoStep && !turningOff}
            disabled={busy || (!email && !twoStep)}
            onCheckedChange={async (on) => {
              if (!on) {
                setTurningOff(true);
                return;
              }
              setTurningOff(false);
              if (await run({ two_step: true }, "Sign-in codes are on.")) setTwoStep(true);
            }}
          />
        </Row>
        {turningOff ? (
          <form
            className="flex items-end gap-2 border-b border-hairline px-[18px] py-4 max-sm:flex-col max-sm:items-stretch"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await run({ two_step: false, current_password: offPw }, "Sign-in codes are off.")) {
                setTwoStep(false);
                setTurningOff(false);
                setOffPw("");
              }
            }}
          >
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="two-step-pw">Your password, to turn sign-in codes off</Label>
              <Input id="two-step-pw" type="password" autoComplete="current-password" autoFocus value={offPw} onChange={(e) => setOffPw(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" size="sm" variant="outline" disabled={busy || !offPw}>
                Turn off
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => (setTurningOff(false), setOffPw(""))}>
                Keep them on
              </Button>
            </div>
          </form>
        ) : null}
        <Row label="Sign out everywhere" help="Ends every session, this one included. Agent tokens keep working.">
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={async () => {
              if (!window.confirm("Sign out of every browser, this one included?")) return;
              if (await run({ sign_out_everywhere: true }, "Signed out everywhere.")) window.location.assign("/login");
            }}
          >
            Sign out everywhere
          </Button>
        </Row>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- agents

function AgentsSection({ tokens, setTokens, say }: { tokens: Token[]; setTokens: (t: Token[]) => void; say: Say }) {
  async function revoke(t: Token) {
    const what = t.kind === "oauth" ? `Disconnect "${t.name}"? It has to sign in again to reach Indy.` : `Revoke "${t.name}"? That agent loses access straight away.`;
    if (!window.confirm(what)) return;
    try {
      await send(`/api/tokens/${t.id}`, "DELETE");
      setTokens(tokens.filter((x) => x.id !== t.id));
      say.good(t.kind === "oauth" ? `Disconnected "${t.name}".` : `Revoked "${t.name}".`);
    } catch (err) {
      say.bad(err);
    }
  }

  return (
    <>
      <Head title="Agents" lede="Every agent that can reach Indy, and how it signs in. Disconnect one and only that agent loses access." />
      <Card
        title="Connected agents"
        action={
          <Button size="sm" asChild>
            <Link href="/connect">Connect an agent</Link>
          </Button>
        }
      >
        {tokens.length === 0 ? (
          <p className="m-0 px-[18px] py-6 text-sm text-muted-foreground">
            No agent is connected yet. <Link href="/connect" className="text-sand-strong hover:underline">Connect one</Link> to start publishing.
          </p>
        ) : (
          tokens.map((t) => {
            const recent = t.lastUsedAt && Date.now() - new Date(t.lastUsedAt).getTime() < 3_600_000;
            return (
              <div key={t.id} className="grid grid-cols-[minmax(0,1fr)_140px_150px_84px] items-center gap-3.5 border-b border-hairline px-[18px] py-3 text-[13px] last:border-b-0 max-sm:grid-cols-[minmax(0,1fr)_auto]">
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-medium">{t.name}</span>
                  <span className="text-[11px] text-muted-foreground">
                    {t.kind === "oauth" ? "signed in through the browser" : <span className="font-mono">{t.prefix}…</span>}
                  </span>
                </span>
                <span className="text-fg-3 max-sm:hidden">added {agoLong(t.createdAt)}</span>
                <span className="flex items-center gap-1.5 text-fg-3 max-sm:hidden">
                  <span className={cn("size-1.5 rounded-full", recent ? "bg-good" : t.lastUsedAt ? "bg-muted-foreground" : "bg-border")} />
                  {t.lastUsedAt ? `used ${agoLong(t.lastUsedAt)}` : "never used"}
                </span>
                <button type="button" className="text-right text-bad hover:underline" onClick={() => void revoke(t)}>
                  {t.kind === "oauth" ? "Disconnect" : "Revoke"}
                </button>
              </div>
            );
          })
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- email

function EmailSection({ email }: { email: { on: boolean; from: string } }) {
  return (
    <>
      <Head title="Email" lede="Optional. Indy works fully without it, apart from the two things below." />
      <Card>
        <Row label="Status" help={email.on ? `Sending through Resend, from ${email.from}.` : "Off. RESEND_API_KEY is not set."}>
          <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", email.on ? "bg-good/15 text-good" : "bg-raised text-muted-foreground")}>
            {email.on ? "On" : "Off"}
          </span>
        </Row>
        <Row label="Sign-in codes" help="A six-digit code after your password, turned on under Account." >
          <span className="text-xs text-muted-foreground">{email.on ? "Available" : "Needs email"}</span>
        </Row>
        <Row label="Email-confirmed share links" help="Visitors confirm their address with a code before a page opens.">
          <span className="text-xs text-muted-foreground">{email.on ? "Available" : "Needs email"}</span>
        </Row>
      </Card>
      {email.on ? null : (
        <Card title="Turning it on">
          <div className="flex flex-col gap-3 p-[18px] text-[13px] leading-relaxed text-fg-3">
            <p className="m-0">
              Make a key at resend.com, then add it to the <code className="font-mono text-fg-2">.env</code> file next to{" "}
              <code className="font-mono text-fg-2">compose.yaml</code> and restart Indy:
            </p>
            <pre className="m-0 overflow-x-auto rounded-lg border border-border bg-sidebar px-4 py-3 font-mono text-[12.5px] text-fg-2">
              {"RESEND_API_KEY=re_...\nINDY_EMAIL_FROM=Indy <indy@yourdomain.com>\n\ndocker compose up -d"}
            </pre>
            <p className="m-0">
              Resend's test sender only reaches your own Resend account's address. To email visitors, verify a domain with Resend and send from an
              address on it.
            </p>
          </div>
        </Card>
      )}
    </>
  );
}

// ---------------------------------------------------------------- shared links

function SharesSection({ shares, setShares, say }: { shares: Share[]; setShares: (s: Share[]) => void; say: Say }) {
  async function revoke(s: Share) {
    if (!window.confirm(`Stop sharing "${s.title}"? The link stops working for everyone.`)) return;
    try {
      await send(`/api/artifacts/${s.slug}/share`, "PUT", { mode: "private" });
      setShares(shares.filter((x) => x.id !== s.id));
      say.good(`"${s.title}" is private again.`);
    } catch (err) {
      say.bad(err);
    }
  }
  return (
    <>
      <Head title="Shared links" lede="Every page someone besides you can open right now. Change a link's details from the page's Share button." />
      <Card>
        {shares.length === 0 ? (
          <p className="m-0 px-[18px] py-6 text-sm text-muted-foreground">Nothing is shared. Every page is private.</p>
        ) : (
          shares.map((s) => (
            <div key={s.id} className="flex items-center gap-3.5 border-b border-hairline px-[18px] py-3 text-[13px] last:border-b-0 max-sm:flex-wrap">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-raised text-sand">
                {s.mode === "email" ? <AtSign className="size-4" /> : <Globe className="size-4" />}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <Link href={`/a/${s.slug}`} className="truncate font-medium hover:text-sand-strong">
                  {s.title}
                </Link>
                <span className="text-xs text-muted-foreground">
                  {s.mode === "email" ? "Confirmed email" : "Anyone with the link"}
                  {s.allowComments ? " · comments on" : ""} · {s.opens === 0 ? "not opened yet" : `opened ${s.opens}×`}
                  {s.lastOpenedAt ? `, last ${agoLong(s.lastOpenedAt)}` : ""}
                  {s.expiresAt ? ` · expires ${new Date(s.expiresAt).toLocaleDateString()}` : ""}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-3">
                <button
                  type="button"
                  className="flex items-center gap-1 text-fg-2 hover:text-foreground"
                  onClick={async () => ((await copyText(s.url)) ? say.good("Link copied.") : say.bad("Your browser would not copy."))}
                >
                  <Link2 className="size-3.5" /> Copy
                </button>
                <button type="button" className="text-bad hover:underline" onClick={() => void revoke(s)}>
                  Revoke
                </button>
              </span>
            </div>
          ))
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------- data

const LIMITS_MB = [1024, 2048, 5120, 10240, 25600, 51200, 0];
const EDGES = [1280, 1920, 2560, 3840];

function DataSection({ settings, usage, onSaved, say }: { settings: AppSettings; usage: Usage; onSaved: (s: AppSettings, u: Usage) => void; say: Say }) {
  const [quality, setQuality] = useState(settings.imageQuality);
  useEffect(() => setQuality(settings.imageQuality), [settings.imageQuality]);

  async function save(patch: Record<string, unknown>) {
    try {
      const data = (await send("/api/settings", "PATCH", patch)) as { settings: AppSettings; usage: Usage };
      onSaved(data.settings, data.usage);
      say.good("Saved.");
    } catch (err) {
      say.bad(err);
    }
  }

  const limit = settings.storageLimitMb * MB;
  const share = limit ? Math.min(1, usage.total / limit) : 0;
  const tight = limit > 0 && share >= 0.9;
  const limits = LIMITS_MB.includes(settings.storageLimitMb) ? LIMITS_MB : [...LIMITS_MB, settings.storageLimitMb].sort((a, b) => (a || Infinity) - (b || Infinity));
  const edges = EDGES.includes(settings.imageMaxEdge) ? EDGES : [...EDGES, settings.imageMaxEdge].sort((a, b) => a - b);
  const parts: { name: string; bytes: number }[] = [
    { name: "Database", bytes: usage.database },
    { name: "Attached files", bytes: usage.assets },
    { name: "Compiled apps", bytes: usage.builds },
    { name: "Other", bytes: usage.other },
  ];

  return (
    <>
      <Head title="Data" lede="How much room Indy takes on this server, and how it keeps attached images small." />

      <Card>
        <div className="flex flex-col gap-3 px-[18px] py-5">
          <div className="flex items-baseline gap-2">
            <span className="text-[28px] font-semibold tracking-[-0.02em] tabular-nums">{bytes(usage.total)}</span>
            <span className="text-sm text-muted-foreground">{limit ? `of ${bytes(limit)}` : "used, no limit set"}</span>
          </div>
          {limit ? (
            <div className="h-2 overflow-hidden rounded-full bg-raised" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share * 100)} aria-label="Storage used">
              <div className={cn("h-full rounded-full", tight ? "bg-bad" : "bg-sand")} style={{ width: `${Math.max(share * 100, 1)}%` }} />
            </div>
          ) : null}
          {tight ? (
            <p className="m-0 text-[13px] text-bad">
              Nearly full. When the limit is reached, agents can no longer publish or update pages until you archive some or raise the limit.
            </p>
          ) : null}
          <div className="grid grid-cols-4 gap-3 pt-1 max-sm:grid-cols-2">
            {parts.map((p) => (
              <div key={p.name} className="flex flex-col gap-0.5">
                <span className="text-xs text-muted-foreground">{p.name}</span>
                <span className="text-sm tabular-nums">{bytes(p.bytes)}</span>
              </div>
            ))}
          </div>
        </div>
        <Row
          label="Storage limit"
          htmlFor="storage-limit"
          help="Past this, publishing and updating pages stop, with a message saying why. Reading, comments and sharing keep working."
        >
          <select
            id="storage-limit"
            className="h-9 rounded-md border border-input bg-raised px-2.5 text-sm"
            value={settings.storageLimitMb}
            onChange={(e) => void save({ storage_limit_mb: Number(e.target.value) })}
          >
            {limits.map((mb) => (
              <option key={mb} value={mb}>
                {mb === 0 ? "No limit" : bytes(mb * MB)}
              </option>
            ))}
          </select>
        </Row>
      </Card>

      <Card title="Images">
        <Row
          label="Compress attached images"
          htmlFor="compress"
          help="Screenshots and photos an agent attaches are scaled down and re-encoded in their own format, and lose their EXIF data. GIFs and SVGs are left alone."
        >
          <Switch id="compress" checked={settings.compressImages} onCheckedChange={(on) => void save({ compress_images: on })} />
        </Row>
        <Row label="Largest side" htmlFor="max-edge" help="Bigger images are scaled down to fit. 2560 px is sharper than a laptop shows a page.">
          <select
            id="max-edge"
            className="h-9 rounded-md border border-input bg-raised px-2.5 text-sm disabled:opacity-50"
            disabled={!settings.compressImages}
            value={settings.imageMaxEdge}
            onChange={(e) => void save({ image_max_edge: Number(e.target.value) })}
          >
            {edges.map((px) => (
              <option key={px} value={px}>
                {px} px
              </option>
            ))}
          </select>
        </Row>
        <Row label="Quality" help="Lower is smaller. Around 80, screenshots look the same as the original.">
          <div className={cn("flex w-[220px] items-center gap-3 max-sm:w-full", !settings.compressImages && "opacity-50")}>
            <Slider
              min={30}
              max={100}
              step={5}
              value={[quality]}
              disabled={!settings.compressImages}
              onValueChange={([v]) => setQuality(v)}
              onValueCommit={([v]) => void save({ image_quality: v })}
              aria-label="Image quality"
            />
            <span className="w-8 text-right font-mono text-[13px] tabular-nums">{quality}</span>
          </div>
        </Row>
      </Card>
      <p className="m-0 text-[12.5px] leading-relaxed text-muted-foreground">
        Image settings apply to files attached from now on. Images already stored stay as they are.
      </p>
    </>
  );
}
