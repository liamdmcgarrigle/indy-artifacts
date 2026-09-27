"use client";

import Link from "next/link";
import { CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useForm } from "./FormState";

/**
 * The bar pinned to the foot of a form page: what is left to answer, and the
 * send button with the page's own words on it.
 */
export function FormBar({ responsesHref, responseCount }: { responsesHref?: string; responseCount?: number }) {
  const form = useForm();
  if (!form) return null;
  const required = form.fields.filter((f) => f.required);
  const done = required.length - form.requiredLeft.length;
  const next = form.requiredLeft[0];
  const problem = form.errors._form;

  if (form.status === "sent") {
    return (
      <div className="formbar" role="status">
        <div className="formbar__inner">
          <CheckCircle2 className="size-5 shrink-0 text-good" />
          <span className="formbar__done min-w-0 flex-1 text-[15px]">{form.settings.confirm}</span>
          {responsesHref ? (
            <Button variant="ghost" asChild className="h-11 md:h-9">
              <Link href={responsesHref}>See responses</Link>
            </Button>
          ) : null}
          <Button variant="outline" onClick={form.reset} className="h-11 md:h-9">
            Answer again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="formbar">
      <div className="formbar__inner">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="truncate text-[13px] text-muted-foreground">
            {problem ? (
              <span className="text-bad">{problem}</span>
            ) : required.length ? (
              <>
                {done} of {required.length} required answered
                {next ? (
                  <>
                    {" · "}
                    <button
                      type="button"
                      className="text-fg-2 underline decoration-dotted underline-offset-4 hover:text-foreground"
                      onClick={() =>
                        document.querySelector(`[data-field="${CSS.escape(next.name)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" })
                      }
                    >
                      {next.label}
                    </button>{" "}
                    is still empty
                  </>
                ) : null}
              </>
            ) : (
              "Every question is optional"
            )}
          </span>
          {required.length ? (
            <span className="h-1 overflow-hidden rounded-full bg-raised">
              <span className="block h-full rounded-full bg-sand transition-[width]" style={{ width: `${(done / required.length) * 100}%` }} />
            </span>
          ) : null}
        </div>
        {responsesHref && responseCount ? (
          <Link href={responsesHref} className="hidden shrink-0 text-[13px] text-muted-foreground hover:text-foreground md:block">
            {responseCount} response{responseCount === 1 ? "" : "s"}
          </Link>
        ) : null}
        <Button onClick={() => void form.submit()} disabled={form.status === "sending"} className="h-11 shrink-0 px-5 text-[15px] md:h-10">
          {form.status === "sending" ? <Loader2 className="size-4 animate-spin" /> : null}
          {form.settings.submit}
        </Button>
      </div>
    </div>
  );
}
