"use client";

import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

/** The pieces every Settings section is built from. */

export async function send(url: string, method: string, payload?: unknown) {
  const res = await fetch(url, {
    method,
    headers: { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok) throw new Error(data.error?.message ?? "That did not save.");
  return data;
}

export type Say = { good: (text: string) => void; bad: (err: unknown) => void };

export function Head({ title, lede, headingRef }: { title: string; lede: string; headingRef?: React.Ref<HTMLHeadingElement> }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined} className="m-0 text-2xl font-semibold tracking-[-0.01em] outline-none">
        {title}
      </h1>
      <p className="m-0 text-sm leading-relaxed text-fg-3">{lede}</p>
    </div>
  );
}

export function Card({
  title,
  action,
  children,
  className,
  titleRef,
}: {
  title?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  titleRef?: React.Ref<HTMLHeadingElement>;
}) {
  return (
    <section className={cn("overflow-hidden rounded-xl border border-hairline bg-card", className)}>
      {title ? (
        <div className="flex min-h-[52px] items-center gap-3 border-b border-hairline px-[18px] py-2.5">
          <h2 ref={titleRef} tabIndex={titleRef ? -1 : undefined} className="m-0 text-sm font-semibold outline-none">
            {title}
          </h2>
          {action ? <div className="ml-auto">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** One setting: what it is on the left, the control on the right; stacked on a phone. */
export function Row({ label, help, children, htmlFor }: { label: string; help?: React.ReactNode; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="flex items-center gap-4 border-b border-hairline px-[18px] py-4 last:border-b-0 max-sm:flex-col max-sm:items-stretch max-sm:gap-3">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Label htmlFor={htmlFor} className="text-sm font-medium">
          {label}
        </Label>
        {help ? <p className="m-0 text-[12.5px] leading-relaxed text-muted-foreground">{help}</p> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  );
}

