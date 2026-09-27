"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * The owner's yes or no to an agent asking for access. The decision is a
 * plain form post, so the browser follows the redirect back to the agent.
 */
export function Consent({ clientName, destination, params }: { clientName: string; destination: string; params: string }) {
  const [name, setName] = useState(clientName);
  const [busy, setBusy] = useState(false);
  return (
    <form method="post" action="/api/oauth/authorize" className="flex flex-col gap-5 rounded-xl border border-hairline bg-card p-6" onSubmit={() => {
      // Disable the buttons only after the browser has read the form: a
      // disabled submit button leaves its decision=allow out of the post.
      setTimeout(() => setBusy(true), 0);
    }}>
      <input type="hidden" name="params" value={params} />
      <div className="flex flex-col gap-2">
        <h1 className="m-0 text-xl font-semibold tracking-[-0.01em]">Connect {clientName}?</h1>
        <p className="m-0 text-sm leading-relaxed text-fg-3">
          It will be able to publish and update pages, set their themes, read them, and read and answer your comments, as
          you. It can&rsquo;t change your account, your other settings or who a page is shared with.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="connection-name">Name this connection</Label>
        <Input id="connection-name" name="name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <p className="m-0 text-xs text-muted-foreground">Shown on the pages it writes and in Settings › Agents, where you can disconnect it.</p>
      </div>
      <p className="m-0 text-xs text-muted-foreground">After you connect, you&rsquo;ll go back to {destination}.</p>
      <div className="flex gap-2">
        <Button type="submit" name="decision" value="allow" disabled={busy || !name.trim()} className="flex-1">
          Connect
        </Button>
        <Button type="submit" name="decision" value="deny" variant="outline" disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
