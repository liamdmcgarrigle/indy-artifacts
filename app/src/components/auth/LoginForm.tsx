"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CodeInput } from "./CodeInput";

type Step = { kind: "password" } | { kind: "code"; challenge: string; email: string };

export function LoginForm({ next }: { next: string }) {
  const [step, setStep] = useState<Step>({ kind: "password" });
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function post(path: string, payload: unknown) {
    const res = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message ?? "Something went wrong. Try again.");
    return data;
  }

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await post("/api/auth/login", { email, password });
      if (data.challenge) setStep({ kind: "code", challenge: data.challenge, email: data.email });
      else window.location.assign(next);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(code: string) {
    if (step.kind !== "code") return;
    setBusy(true);
    setError(null);
    try {
      await post("/api/auth/verify", { challenge: step.challenge, code });
      window.location.assign(next);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  if (step.kind === "code") {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-[15px] leading-relaxed text-fg-3">
          We sent a 6-digit code to <span className="text-foreground">{step.email}</span>. It&apos;s good for 10
          minutes.
        </p>
        <CodeInput onComplete={verify} disabled={busy} />
        {error ? <p role="alert" className="text-[13px] text-bad">{error}</p> : null}
        <button
          type="button"
          className="w-fit text-[13px] text-fg-3 hover:text-foreground"
          onClick={() => {
            setStep({ kind: "password" });
            setError(null);
          }}
        >
          Back
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={signIn} className="flex flex-col gap-3.5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email" className="text-fg-2">Email</Label>
        <Input
          id="email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="h-11 text-[15px]"
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password" className="text-fg-2">Password</Label>
        <Input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="h-11 text-[15px]"
        />
      </div>
      {error ? <p role="alert" className="text-[13px] text-bad">{error}</p> : null}
      <Button type="submit" disabled={busy} className="mt-1 h-11 text-[15px] font-semibold">
        {busy ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
