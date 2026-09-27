"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Who a visitor is, as this browser remembers it: their own name and email, and the token Indy signed for them. */
export interface VisitorIdentity {
  name: string;
  email: string;
  verified: boolean;
  token: string;
}

/** The header a visitor's interactions carry their identity in. */
export const IDENTITY_HEADER = "x-indy-identity";

/** One identity per browser for this Indy, whichever share link it came from. */
const KEY = "indy-visitor-identity";

export function storedIdentity(): VisitorIdentity | null {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<VisitorIdentity> | null;
    if (!raw || typeof raw.token !== "string" || typeof raw.name !== "string" || typeof raw.email !== "string") return null;
    return { name: raw.name, email: raw.email, verified: raw.verified === true, token: raw.token };
  } catch {
    return null;
  }
}

export function storeIdentity(identity: VisitorIdentity | null): void {
  try {
    if (identity) localStorage.setItem(KEY, JSON.stringify(identity));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: it lasts as long as the page */
  }
}

class IdentityError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function postIdentity(link: string, payload: Record<string, unknown>): Promise<VisitorIdentity> {
  const res = await fetch(`/s/${link}/api/identity`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as { identity?: Omit<VisitorIdentity, "token">; token?: string; error?: { message?: string } };
  if (!res.ok || !data.identity || !data.token) throw new IdentityError(data.error?.message ?? "That did not work. Try again.", res.status);
  return { ...data.identity, token: data.token };
}

/**
 * Show a stored identity to this link again: Indy checks its signature and
 * hands it back, moved to the confirmed address on an email link. "rejected"
 * when Indy no longer accepts it; null when it could not say (offline, or too
 * many tries), and then the stored identity is kept, so a hiccup never lets a
 * visitor pick a new name.
 */
export async function renewIdentity(link: string, identity: VisitorIdentity): Promise<VisitorIdentity | "rejected" | null> {
  try {
    return await postIdentity(link, { token: identity.token });
  } catch (err) {
    return err instanceof IdentityError && (err.status === 400 || err.status === 401 || err.status === 403) ? "rejected" : null;
  }
}

/**
 * Who's this? Asked once per browser, the first time a visitor on any share
 * link comments or ticks a box, so the owner and everyone else on the page can
 * see whose it is. An email link has confirmed the address already, so only
 * the name is asked for there. Afterwards it cannot be changed from the page.
 */
export function IdentityDialog({
  token,
  verifiedEmail,
  sharedBy,
  reason,
  onDone,
  onCancel,
}: {
  token: string;
  /** Set on an email link: the address the visitor confirmed. */
  verifiedEmail: string | null;
  sharedBy: string | null;
  reason: "tick" | "comment";
  onDone: (identity: VisitorIdentity) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState(verifiedEmail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const identity = await postIdentity(token, verifiedEmail ? { name } : { name, email });
      storeIdentity(identity);
      onDone(identity);
    } catch (err) {
      const message = (err as Error).message;
      setError(message ? message[0].toUpperCase() + message.slice(1) : "That did not work. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const owner = sharedBy ?? "the owner";
  return (
    <Dialog open onOpenChange={(open) => (open ? null : onCancel())}>
      <DialogContent className="identity gap-0 p-0 sm:max-w-[420px]" aria-describedby="identity-desc">
        <form onSubmit={submit} className="identity__form">
          <DialogTitle className="identity__title">{verifiedEmail ? "What's your name?" : "Who's this?"}</DialogTitle>
          <DialogDescription id="identity-desc" className="identity__lede">
            {reason === "tick"
              ? `Your name shows next to the boxes you tick, so ${owner} knows who did what.`
              : `Your name goes on your comments, so ${owner} knows who wrote them.`}{" "}
            This browser remembers it for every page {owner} shares, and it can't be changed later.
          </DialogDescription>
          <div className="identity__field">
            <Label htmlFor="identity-name">Name</Label>
            <Input
              id="identity-name"
              autoFocus
              required
              maxLength={60}
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Maya Chen"
              className="h-11 text-[16px] md:h-9 md:text-sm"
            />
          </div>
          {verifiedEmail ? (
            <p className="identity__note">Signed in as {verifiedEmail}</p>
          ) : (
            <div className="identity__field">
              <Label htmlFor="identity-email">Email</Label>
              <Input
                id="identity-email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="maya@example.com"
                className="h-11 text-[16px] md:h-9 md:text-sm"
              />
              <p className="identity__note">Only {owner} sees your email. Other people see your name.</p>
            </div>
          )}
          {error ? (
            <p className="identity__error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="identity__row">
            <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy || !name.trim() || (!verifiedEmail && !email.trim())}>
              {busy ? "Saving" : "Continue"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
