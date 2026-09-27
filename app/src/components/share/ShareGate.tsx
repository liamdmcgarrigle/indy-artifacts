"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { SackMark } from "@/components/indy/brand";

/**
 * The door to an email-confirmed page: an address, then the six digits that
 * were sent to it. Nothing about the page shows but its title.
 */
export function ShareGate({ token, title, sharedBy, isForm }: { token: string; title: string; sharedBy: string | null; isForm: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [codeId, setCodeId] = useState<string | null>(null);
  const [digits, setDigits] = useState(["", "", "", "", "", ""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const boxes = useRef<(HTMLInputElement | null)[]>([]);

  async function post(payload: Record<string, unknown>) {
    const res = await fetch(`/s/${token}/api/visit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { code_id?: string; error?: { message?: string } };
    if (!res.ok) throw new Error(data.error?.message ?? "That did not work. Try again.");
    return data;
  }

  async function sendCode(event?: React.FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const data = await post({ email });
      setCodeId(data.code_id ?? null);
      setDigits(["", "", "", "", "", ""]);
      window.setTimeout(() => boxes.current[0]?.focus(), 50);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function check(code: string) {
    setBusy(true);
    setError(null);
    try {
      await post({ code_id: codeId, code });
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setDigits(["", "", "", "", "", ""]);
      setBusy(false);
      // After the fieldset is enabled again; a disabled box cannot take focus.
      window.setTimeout(() => boxes.current[0]?.focus(), 0);
    }
  }

  function put(index: number, raw: string) {
    const typed = raw.replace(/\D/g, "");
    if (!typed) {
      setDigits((d) => d.map((v, i) => (i === index ? "" : v)));
      return;
    }
    // A pasted or autofilled code arrives in one box; spread it across them.
    const next = [...digits];
    for (let i = 0; i < typed.length && index + i < 6; i++) next[index + i] = typed[i];
    setDigits(next);
    const filled = next.findIndex((d) => !d);
    if (filled === -1) void check(next.join(""));
    else boxes.current[Math.min(index + typed.length, 5)]?.focus();
  }

  return (
    <main className="gate">
      <div className="gate__card">
        <div className="gate__who">
          <span className="gate__avatar">{(sharedBy ?? "?").slice(0, 1).toUpperCase()}</span>
          {sharedBy ?? "Someone"} shared {isForm ? "a form" : "a page"} with you
        </div>
        <h1 className="gate__title">{title}</h1>
        {codeId ? (
          <>
            <p className="gate__lede">
              We sent a 6-digit code to <strong>{email}</strong>. It's good for 10 minutes.
            </p>
            <fieldset className="gate__code" disabled={busy}>
              <legend>Code</legend>
              <div className="gate__digits">
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      boxes.current[i] = el;
                    }}
                    value={d}
                    inputMode="numeric"
                    autoComplete={i === 0 ? "one-time-code" : "off"}
                    aria-label={`Digit ${i + 1}`}
                    onChange={(e) => put(i, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Backspace" && !d && i > 0) boxes.current[i - 1]?.focus();
                    }}
                  />
                ))}
              </div>
            </fieldset>
            <div className="gate__links">
              <button type="button" onClick={() => void sendCode()} disabled={busy}>
                Send a new code
              </button>
              <button type="button" className="gate__quiet" onClick={() => setCodeId(null)} disabled={busy}>
                Use a different email
              </button>
            </div>
          </>
        ) : (
          <form className="gate__form" onSubmit={sendCode}>
            <p className="gate__lede">Confirm your email to open it. We'll send you a 6-digit code.</p>
            <label className="gate__label" htmlFor="gate-email">
              Email
            </label>
            <input
              id="gate-email"
              className="gate__input"
              type="email"
              autoComplete="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <button className="gate__send" type="submit" disabled={busy || !email.trim()}>
              {busy ? "Sending" : "Send the code"}
            </button>
          </form>
        )}
        {error ? <p className="gate__error">{error}</p> : null}
      </div>
      <span className="gate__credit">
        <SackMark size={11} /> made with indy
      </span>
    </main>
  );
}

/** A link that has been turned off or has run out. */
export function ShareGone({ message }: { message: string }) {
  return (
    <main className="gate">
      <div className="gate__card">
        <h1 className="gate__title">This page is not shared</h1>
        <p className="gate__lede">{message[0].toUpperCase() + message.slice(1)}. Ask whoever sent it for a new link.</p>
      </div>
      <span className="gate__credit">
        <SackMark size={11} /> made with indy
      </span>
    </main>
  );
}
