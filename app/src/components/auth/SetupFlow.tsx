"use client";

import { useState } from "react";
import { Check, Minus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SackMark } from "@/components/indy/brand";
import { cn } from "@/lib/utils";

export interface InstallCheck {
  /** true passed, false failed, null not set up (and that is fine). */
  ok: boolean | null;
  name: string;
  detail: string;
}

const STEPS = ["Your account", "Email", "Connect an agent"];

async function post(path: string, payload: unknown, method = "POST") {
  const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error?.message ?? "Something went wrong. Try again.");
  return data;
}

/** Password strength by length and variety; a nudge, not a rule. */
function strength(pw: string): number {
  if (!pw) return 0;
  let score = pw.length >= 10 ? 1 : 0;
  if (pw.length >= 14) score++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) score++;
  if (/\d/.test(pw) || /[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 4);
}

export function SetupFlow({ checks, email }: { checks: InstallCheck[]; email: boolean }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({ email: "", password: "" });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [twoStep, setTwoStep] = useState(false);

  const score = strength(form.password);

  async function createAccount(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/setup", form);
      setStep(1);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    setBusy(true);
    try {
      if (email && twoStep) await post("/api/account", { two_step: true }, "PATCH");
      // The last step is its own page, which Settings links to as well.
      window.location.assign("/connect?welcome=1");
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center gap-9 bg-background px-4 pb-16 pt-[72px]">
      <div className="flex items-center gap-3">
        <SackMark size={26} strokeWidth={4} className="text-sand" />
        <span className="font-display text-[32px] font-semibold leading-none tracking-[-0.03em]">indy</span>
      </div>

      <ol aria-label="Setup steps" className="flex flex-wrap items-center justify-center gap-3 text-[13px]">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-3">
            {i > 0 ? <span aria-hidden className="h-px w-10 bg-input" /> : null}
            <span className={cn("flex items-center gap-2", i === step ? "text-foreground" : "text-muted-foreground")}>
              <span
                className={cn(
                  "flex size-[22px] items-center justify-center rounded-full text-xs",
                  i < step && "bg-sand-soft text-sand",
                  i === step && "bg-primary font-semibold text-primary-foreground",
                  i > step && "border border-input",
                )}
              >
                {i < step ? <Check className="size-3" /> : i + 1}
              </span>
              {label}
              {i === 2 ? <span className="text-[11px] text-muted-foreground">(optional)</span> : null}
            </span>
          </li>
        ))}
      </ol>

      <div className="grid w-full max-w-[804px] grid-cols-1 items-start gap-6 md:grid-cols-[minmax(0,440px)_minmax(0,340px)]">
        <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-7">
          {step === 0 ? (
            <form onSubmit={createAccount} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h1 className="text-xl font-semibold">Create your account</h1>
                <p className="text-sm leading-relaxed text-fg-3">
                  This is the only account. Everything your agents publish belongs to it.
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="email" className="text-fg-2">Email</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="username"
                  required
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  className="h-11 text-[15px]"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password" className="text-fg-2">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={10}
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  className="h-11 text-[15px]"
                  aria-describedby="pw-hint"
                />
                <div className="flex gap-1" aria-hidden>
                  {[0, 1, 2, 3].map((i) => (
                    <span
                      key={i}
                      className={cn("h-1 flex-1 rounded-full", i < score ? (score >= 3 ? "bg-good" : "bg-warn") : "bg-border")}
                    />
                  ))}
                </div>
                <p id="pw-hint" className="text-xs text-muted-foreground">At least 10 characters.</p>
              </div>
              {error ? <p role="alert" className="text-[13px] text-bad">{error}</p> : null}
              <Button type="submit" disabled={busy} className="mt-1 h-11 text-[15px] font-semibold">
                {busy ? "Creating…" : "Create account"}
              </Button>
            </form>
          ) : null}

          {step === 1 ? (
            <div className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <h1 className="text-xl font-semibold">Email</h1>
                <p className="text-sm leading-relaxed text-fg-3">
                  {email
                    ? "Email is set up. Indy can send you a code as a second step when you sign in, and confirm who opens a shared link."
                    : "Without email Indy works fully, apart from three things: a code as a second step when you sign in, share links that ask visitors to confirm their email, and a note when someone answers a form. Add RESEND_API_KEY to the environment and restart to turn them on."}
                </p>
              </div>
              {email ? (
                <label className="flex items-center justify-between gap-4 rounded-lg border border-border px-4 py-3">
                  <span className="flex flex-col">
                    <span className="text-sm">Ask for a code when I sign in</span>
                    <span className="text-xs text-muted-foreground">Sent to the address you just used.</span>
                  </span>
                  <Switch checked={twoStep} onCheckedChange={setTwoStep} />
                </label>
              ) : null}
              {error ? <p role="alert" className="text-[13px] text-bad">{error}</p> : null}
              <Button onClick={finish} disabled={busy} className="h-11 text-[15px] font-semibold">
                Continue
              </Button>
            </div>
          ) : null}
        </div>

        <aside aria-label="What this install found" className="flex flex-col gap-3.5 rounded-xl border border-hairline p-5 text-[13px]">
          <span className="text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">This install</span>
          {checks.map((c) => (
            <div key={c.name} className="grid grid-cols-[16px_minmax(0,1fr)] gap-2.5">
              <span className={cn("pt-0.5", c.ok === true ? "text-good" : c.ok === false ? "text-bad" : "text-muted-foreground")}>
                {c.ok === true ? <Check className="size-3.5" /> : c.ok === false ? <X className="size-3.5" /> : <Minus className="size-3.5" />}
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-fg-2">{c.name}</span>
                <span className="break-words font-mono text-[11.5px] leading-normal text-muted-foreground">{c.detail}</span>
              </span>
            </div>
          ))}
        </aside>
      </div>
    </main>
  );
}
