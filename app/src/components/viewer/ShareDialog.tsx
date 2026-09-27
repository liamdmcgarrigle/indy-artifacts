"use client";

import { useEffect, useRef, useState } from "react";
import { AtSign, Check, Link2, Lock } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { copyText } from "@/lib/clipboard";
import { agoLong } from "@/lib/time";
import { cn } from "@/lib/utils";

type Mode = "private" | "link" | "email";

interface ShareState {
  mode: Mode;
  link: {
    url: string;
    allowComments: boolean;
    pinnedVersion: number | null;
    expiresAt: string | null;
    opens: number;
    lastOpenedAt: string | null;
    lastOpenedBy: string | null;
  } | null;
  privateUrl: string;
  emailGate: boolean;
  currentVersion: number;
}

const MODES: { mode: Mode; icon: typeof Lock; name: string; desc: string }[] = [
  { mode: "private", icon: Lock, name: "Only you", desc: "Private. Only you, signed in, can open it." },
  { mode: "link", icon: Link2, name: "Anyone with the link", desc: "The link is long and unlisted. Anyone who has it can read." },
  {
    mode: "email",
    icon: AtSign,
    name: "Anyone who confirms their email",
    desc: "They get a 6-digit code by email first, so you know who opened and who answered.",
  },
];

/** Days left on a link, as the expiry menu names them. */
function expiryLabel(expiresAt: string | null): string {
  if (!expiresAt) return "never";
  const days = Math.max(1, Math.round((new Date(expiresAt).getTime() - Date.now()) / 86_400_000));
  return `${days}d`;
}

/**
 * Who can open a page, and the link to send them. One link per page: turning
 * sharing off revokes it, and a new link retires the old address.
 */
export function ShareDialog({
  slug,
  title,
  versionNumber,
  storybooks = [],
  onClose,
  onMode,
}: {
  slug: string;
  title: string;
  versionNumber: number;
  storybooks?: string[];
  onClose: () => void;
  /** Told whenever who-can-open changes, so the header can show it. */
  onMode?: (mode: Mode) => void;
}) {
  const [state, setState] = useState<ShareState | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void fetch(`/api/artifacts/${slug}/share`, { cache: "no-store" })
      .then(async (r) => {
        const data = (await r.json()) as ShareState & { error?: { message?: string } };
        if (!r.ok) throw new Error(data.error?.message);
        setState(data);
      })
      .catch((err: Error) => setError(err.message || "Could not load the sharing settings."));
  }, [slug]);

  // Arrow keys move through native radios one change at a time. Each step
  // shows at once but is saved only once the choice settles, so passing
  // through "Anyone with the link" does not publish the page on the way.
  const [picked, setPicked] = useState<Mode | null>(null);
  const settle = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(settle.current), []);
  function pick(mode: Mode) {
    setPicked(mode);
    window.clearTimeout(settle.current);
    settle.current = window.setTimeout(() => {
      void change({ mode }).finally(() => setPicked(null));
    }, 450);
  }

  async function change(patch: Record<string, unknown>, method: "PUT" | "POST" = "PUT") {
    if (!state) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/artifacts/${slug}/share`, {
        method,
        headers: { "content-type": "application/json" },
        body: method === "PUT" ? JSON.stringify({ mode: state.mode, ...patch }) : "{}",
      });
      const data = (await res.json()) as ShareState & { error?: { message?: string } };
      if (!res.ok) {
        setError(data.error?.message ?? "That did not save.");
        return;
      }
      setState(data);
      onMode?.(data.mode);
      setCopied(false);
    } catch {
      setError("Indy did not answer. Check the connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  const url = state?.link?.url ?? state?.privateUrl ?? "";
  const shared = state?.mode !== "private" && state?.link;

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent className="share gap-0 p-0 sm:max-w-[560px]" aria-describedby="share-desc">
        <div className="share__head">
          <DialogTitle className="share__title">Share “{title}”</DialogTitle>
          <DialogDescription id="share-desc" className="sr-only">
            Choose who can open this page and copy its link.
          </DialogDescription>
        </div>

        <fieldset className="share__modes" disabled={!state || (busy && picked === null)}>
          <legend className="share__legend">Who can open it</legend>
          {MODES.map(({ mode, icon: Icon, name, desc }) => {
            const on = (picked ?? state?.mode) === mode;
            const unavailable = mode === "email" && state !== null && !state.emailGate;
            return (
              <label key={mode} className={cn("share__mode", on && "is-on", unavailable && "is-off")}>
                <input
                  type="radio"
                  name="share-mode"
                  checked={on}
                  disabled={unavailable}
                  onChange={() => pick(mode)}
                />
                <span className="share__icon">
                  <Icon className="size-4" />
                </span>
                <span className="share__text">
                  <span className="share__name">{name}</span>
                  <span className="share__desc">{unavailable ? "Needs email set up on this server (RESEND_API_KEY)." : desc}</span>
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="share__url">
          <span className="share__address" title={url}>
            {url.replace(/^https?:\/\//, "")}
          </span>
          <button
            type="button"
            className="share__copy"
            disabled={!state}
            onClick={async () => {
              if (await copyText(url)) {
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              } else setError("Your browser would not copy. Select the address and copy it by hand.");
            }}
          >
            {copied ? (
              <>
                <Check className="size-3.5" /> Copied
              </>
            ) : (
              "Copy link"
            )}
          </button>
        </div>
        {state?.mode === "private" ? <p className="share__note">This link only works for you. Pick who else can open it above.</p> : null}
        {storybooks.length ? (
          <p className="share__note">
            This page shows stories from the {storybooks.join(" and ")} Storybook{storybooks.length > 1 ? "s" : ""}. Anyone who can open it can also load the other stories in
            {storybooks.length > 1 ? " those builds" : " that build"}.
          </p>
        ) : null}

        {shared ? (
          <div className="share__options">
            <label className="share__row">
              <span className="share__text">
                <span className="share__name">Visitors can comment</span>
                <span className="share__desc">Their comments wait for you. Nothing reaches an agent until you forward it.</span>
              </span>
              <Switch checked={state.link!.allowComments} disabled={busy} onCheckedChange={(on) => void change({ allow_comments: on })} />
            </label>
            <label className="share__row">
              <span className="share__name">Link expires</span>
              <select
                className="share__select"
                disabled={busy}
                value={expiryLabel(state.link!.expiresAt) === "never" ? "never" : "keep"}
                onChange={(e) => e.target.value !== "keep" && void change({ expiry: e.target.value })}
              >
                <option value="never">Never</option>
                {state.link!.expiresAt ? <option value="keep">In {expiryLabel(state.link!.expiresAt).replace("d", " days")}</option> : null}
                <option value="7d">In 7 days</option>
                <option value="30d">In 30 days</option>
              </select>
            </label>
            <label className="share__row">
              <span className="share__name">Shows</span>
              <select
                className="share__select"
                disabled={busy}
                value={state.link!.pinnedVersion ?? "latest"}
                onChange={(e) => void change({ pinned_version: e.target.value === "latest" ? null : Number(e.target.value) })}
              >
                <option value="latest">Latest version</option>
                {state.link!.pinnedVersion && state.link!.pinnedVersion !== versionNumber ? (
                  <option value={state.link!.pinnedVersion}>Version {state.link!.pinnedVersion} only</option>
                ) : null}
                <option value={versionNumber}>Version {versionNumber} only</option>
              </select>
            </label>
          </div>
        ) : null}

        {error ? <p className="share__error">{error}</p> : null}

        {shared ? (
          <div className="share__foot">
            <span className="share__stats">
              {state.link!.opens === 0
                ? "Not opened yet"
                : `Opened ${state.link!.opens} time${state.link!.opens === 1 ? "" : "s"}${
                    state.link!.lastOpenedAt ? ` · last${state.link!.lastOpenedBy ? ` by ${state.link!.lastOpenedBy}` : ""} ${agoLong(state.link!.lastOpenedAt)}` : ""
                  }`}
            </span>
            <button type="button" className="share__action" disabled={busy} onClick={() => void change({}, "POST")} title="The old address stops working">
              New link
            </button>
            <button type="button" className="share__action share__action--bad" disabled={busy} onClick={() => void change({ mode: "private" })}>
              Revoke
            </button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
