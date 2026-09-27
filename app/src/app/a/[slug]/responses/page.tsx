import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
import { pageOwner } from "@/lib/auth/page";
import { getContext } from "@/lib/service/context";
import { requireArtifact, requireVersion } from "@/lib/service/artifacts";
import { formOf, listResponses, type FormResponse } from "@/lib/service/responses";
import { NotFoundError } from "@/lib/service/errors";
import { answerText, isEmpty, type FieldSpec } from "@/lib/forms/spec";
import { Button } from "@/components/ui/button";
import { ago } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Responses" };

/** Counts for a question with options; an average for numbers; the latest words for text. */
function Summary({ field, responses }: { field: FieldSpec; responses: FormResponse[] }) {
  const answered = responses.filter((r) => !isEmpty(r.answers[field.name]));
  if (field.options?.length) {
    const counts = field.options.map((o) => ({
      ...o,
      n: answered.filter((r) => {
        const v = r.answers[field.name];
        return Array.isArray(v) ? v.includes(o.value) : v === o.value;
      }).length,
    }));
    const top = Math.max(1, ...counts.map((c) => c.n));
    return (
      <div className="flex flex-col gap-2">
        {counts.map((c) => (
          <div key={c.value} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
            <span className="truncate text-[14px]">{c.label}</span>
            <span className="font-mono text-[13px] text-muted-foreground">
              {c.n} · {answered.length ? Math.round((c.n / answered.length) * 100) : 0}%
            </span>
            <span className="col-span-2 h-2 overflow-hidden rounded-full bg-raised">
              <span className="block h-full rounded-full bg-sand" style={{ width: `${(c.n / top) * 100}%` }} />
            </span>
          </div>
        ))}
      </div>
    );
  }
  if (["number", "rating", "scale", "slider"].includes(field.type)) {
    const nums = answered.map((r) => Number(r.answers[field.name])).filter(Number.isFinite);
    const avg = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    return (
      <div className="flex items-baseline gap-2">
        <span className="font-display text-3xl font-semibold">{avg === null ? "—" : avg.toFixed(1)}</span>
        <span className="text-[13px] text-muted-foreground">
          average{field.max ? ` of ${field.max}` : ""} from {nums.length}
        </span>
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {answered.slice(0, 5).map((r) => (
        <li key={r.id} className="rounded-lg border border-hairline bg-well px-3 py-2 text-[14px] leading-relaxed">
          {answerText(field, r.answers[field.name])}
        </li>
      ))}
      {answered.length > 5 ? <li className="text-[13px] text-muted-foreground">and {answered.length - 5} more in the table below</li> : null}
      {!answered.length ? <li className="text-[13px] text-muted-foreground">No answers yet</li> : null}
    </ul>
  );
}

export default async function ResponsesPage({ params }: { params: Promise<{ slug: string }> }) {
  await pageOwner();
  const { slug } = await params;
  const ctx = getContext();
  let artifact;
  try {
    artifact = requireArtifact(ctx, slug);
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
  const { fields } = formOf(requireVersion(ctx, artifact).source);
  const responses = listResponses(ctx, slug);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-hairline bg-background px-2 md:h-[52px] md:px-4">
        <Link href={`/a/${slug}`} aria-label="Back to the form" className="flex size-10 items-center justify-center rounded-md text-fg-2 hover:bg-raised md:size-8">
          <ArrowLeft className="size-5 md:size-4" />
        </Link>
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <h1 className="truncate text-[15px] font-semibold">{artifact.title}</h1>
          <span className="shrink-0 text-[13px] text-muted-foreground">
            {responses.length} response{responses.length === 1 ? "" : "s"}
          </span>
        </div>
        {responses.length ? (
          <Button variant="outline" size="sm" asChild className="h-10 md:h-8">
            <a href={`/api/artifacts/${slug}/responses/csv`}>
              <Download className="size-4" /> <span className="max-md:hidden">Download</span> CSV
            </a>
          </Button>
        ) : null}
      </header>

      <main className="mx-auto flex max-w-[1100px] flex-col gap-8 px-4 py-6 md:px-8 md:py-8">
        {!fields.length ? (
          <p className="text-muted-foreground">This page has no questions.</p>
        ) : (
          <>
            <section className="grid gap-4 md:grid-cols-2">
              {fields.map((f) => (
                <div key={f.name} className="flex flex-col gap-4 rounded-xl border border-hairline bg-card p-5">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="text-[15px] font-semibold">{f.label}</h2>
                    <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{f.type}</span>
                  </div>
                  <Summary field={f} responses={responses} />
                </div>
              ))}
            </section>

            <section className="flex flex-col gap-3">
              <h2 className="text-[13px] font-semibold">Every response</h2>
              {responses.length ? (
                <div className="overflow-x-auto rounded-xl border border-hairline bg-well">
                  <table className="w-full min-w-[640px] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-hairline text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                        <th className="px-4 py-2.5 font-semibold">When</th>
                        <th className="px-4 py-2.5 font-semibold">From</th>
                        {fields.map((f) => (
                          <th key={f.name} className="px-4 py-2.5 font-semibold">
                            {f.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {responses.map((r) => (
                        <tr key={r.id} className="border-b border-hairline/60 align-top last:border-0">
                          <td className="whitespace-nowrap px-4 py-3 font-mono text-muted-foreground">{ago(r.createdAt)}</td>
                          <td className="whitespace-nowrap px-4 py-3">{r.respondentKind === "owner" ? "You" : (r.email ?? "Visitor")}</td>
                          {fields.map((f) => (
                            <td key={f.name} className="max-w-[320px] px-4 py-3 leading-relaxed">
                              {answerText(f, r.answers[f.name]) || <span className="text-faint">—</span>}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-muted-foreground">
                  No responses yet. Answers show up here as soon as someone sends the form.
                </p>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
