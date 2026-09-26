import { customAlphabet } from "nanoid";
import { bind } from "../db/index";
import type { ServiceContext } from "./context";
import { ValidationError } from "./errors";
import { recordEvent } from "./events";
import { requireArtifact, requireVersion } from "./artifacts";
import { markdownToDoc } from "../doc/parse";
import { readFrontmatter } from "../pipeline/index";
import { answerText, checkAnswers, cleanAnswers, formFields, formSettings, type Answers, type FieldSpec, type FormSettings } from "../forms/spec";

const id12 = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

export interface Form {
  fields: FieldSpec[];
  settings: FormSettings;
}

export interface FormResponse {
  id: string;
  versionNumber: number;
  respondentKind: "owner" | "visitor";
  email: string | null;
  answers: Answers;
  createdAt: string;
}

/** The questions on a version of a page; no fields means it is not a form. */
export function formOf(source: string | null): Form {
  if (!source) return { fields: [], settings: formSettings(null) };
  return { fields: formFields(markdownToDoc(source)), settings: formSettings(readFrontmatter(source)) };
}

/**
 * Record a set of answers against the page's current version. Answers are
 * checked against the questions actually on the page; anything else is
 * dropped, and a missing required answer is refused with the reason.
 */
export function submitResponse(
  ctx: ServiceContext,
  slug: string,
  raw: Record<string, unknown>,
  who: { kind: "owner" | "visitor"; email?: string | null; linkId?: string | null } = { kind: "owner" },
): FormResponse {
  const artifact = requireArtifact(ctx, slug);
  const version = requireVersion(ctx, artifact);
  const form = formOf(version.source);
  if (!form.fields.length) throw new ValidationError("this page has no questions to answer");
  const answers = cleanAnswers(form.fields, raw ?? {});
  const errors = checkAnswers(form.fields, answers);
  if (Object.keys(errors).length) {
    throw new ValidationError(`some answers need another look: ${Object.keys(errors).join(", ")}`, { fields: errors });
  }
  const response: FormResponse = {
    id: id12(),
    versionNumber: version.number,
    respondentKind: who.kind,
    email: who.email ?? null,
    answers,
    createdAt: new Date().toISOString(),
  };
  ctx.db
    .prepare(
      `INSERT INTO responses (id, artifact_id, version_number, respondent_kind, email, link_id, data_json, approved_at, created_at)
       VALUES (:id, :artifact_id, :version_number, :kind, :email, :link_id, :data, :approved_at, :created_at)`,
    )
    .run(
      bind({
        id: response.id,
        artifact_id: artifact.id,
        version_number: version.number,
        kind: who.kind,
        email: response.email,
        link_id: who.linkId ?? null,
        data: JSON.stringify(answers),
        // The owner's own answers need no forwarding; a visitor's wait for it.
        approved_at: who.kind === "owner" ? response.createdAt : null,
        created_at: response.createdAt,
      }),
    );
  recordEvent(ctx, artifact.id, "response.created", { id: response.id });
  return response;
}

export function listResponses(ctx: ServiceContext, slug: string): FormResponse[] {
  const artifact = requireArtifact(ctx, slug);
  const rows = ctx.db
    .prepare("SELECT * FROM responses WHERE artifact_id = ? ORDER BY created_at DESC")
    .all(artifact.id) as Record<string, unknown>[];
  return rows.map((r) => ({
    id: String(r.id),
    versionNumber: Number(r.version_number),
    respondentKind: r.respondent_kind as "owner" | "visitor",
    email: (r.email as string | null) ?? null,
    answers: JSON.parse(String(r.data_json)) as Answers,
    createdAt: String(r.created_at),
  }));
}

export function countResponses(ctx: ServiceContext, artifactId: string): number {
  return Number((ctx.db.prepare("SELECT COUNT(*) AS n FROM responses WHERE artifact_id = ?").get(artifactId) as { n: number }).n);
}

function csvCell(value: string): string {
  // A leading = + - @ makes a spreadsheet run the cell as a formula.
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Every response as CSV, one column per question on the current version. */
export function responsesCsv(ctx: ServiceContext, slug: string): string {
  const artifact = requireArtifact(ctx, slug);
  const { fields } = formOf(requireVersion(ctx, artifact).source);
  const header = ["submitted_at", "respondent", "version", ...fields.map((f) => f.label)];
  const lines = [header.map(csvCell).join(",")];
  for (const r of listResponses(ctx, slug)) {
    const who = r.respondentKind === "owner" ? "you" : (r.email ?? "visitor");
    lines.push([r.createdAt, who, String(r.versionNumber), ...fields.map((f) => answerText(f, r.answers[f.name]))].map(csvCell).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
