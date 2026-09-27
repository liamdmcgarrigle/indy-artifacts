import type { JSONContent } from "@tiptap/core";

/**
 * Forms are pages with questions in them. A question is a `::field` directive
 * or a `:::choice` of rich `:::option` blocks; anything else on the page is
 * ordinary content. This module reads the questions out of a document and
 * checks answers against them, the same way in the browser and the server.
 */

export const FIELD_TYPES = [
  "text",
  "textarea",
  "email",
  "number",
  "url",
  "tel",
  "date",
  "time",
  "select",
  "radio",
  "checkboxes",
  "checkbox",
  "switch",
  "rating",
  "scale",
  "slider",
] as const;
export type FieldType = (typeof FIELD_TYPES)[number] | "choice";

export interface FieldSpec {
  name: string;
  type: FieldType;
  label: string;
  required: boolean;
  help?: string;
  placeholder?: string;
  options?: { value: string; label: string }[];
  multiple?: boolean;
  min?: number;
  max?: number;
  step?: number;
  /** Words for the two ends of a scale: "coin flip" … "certain". */
  low?: string;
  high?: string;
}

export interface FormSettings {
  submit: string;
  confirm: string;
}

export type Answer = string | number | boolean | string[] | null;
export type Answers = Record<string, Answer>;

const DEFAULTS: FormSettings = { submit: "Submit", confirm: "Thanks, your answers are in." };

/** The `form:` block of a page's frontmatter. */
export function formSettings(frontmatter: Record<string, unknown> | null): FormSettings {
  const f = (frontmatter?.form ?? {}) as Record<string, unknown>;
  const text = (v: unknown, fallback: string) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : fallback);
  return { submit: text(f.submit, DEFAULTS.submit), confirm: text(f.confirm, DEFAULTS.confirm) };
}

const truthy = (v: unknown) => v === "" || v === true || v === "true" || v === "yes";
const num = (v: unknown): number | undefined => {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : undefined;
};

function splitOptions(raw: unknown): { value: string; label: string }[] {
  return String(raw ?? "")
    .split("|")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ value: label, label }));
}

/** One field's spec from its directive attributes. */
export function fieldSpec(attrs: Record<string, unknown>, kind: "field" | "choice", options: { value: string; label: string }[] = []): FieldSpec | null {
  const name = String(attrs.name ?? "").trim();
  if (!name) return null;
  const rawType = String(attrs.type ?? "text").toLowerCase();
  const type: FieldType = kind === "choice" ? "choice" : (FIELD_TYPES as readonly string[]).includes(rawType) ? (rawType as FieldType) : "text";
  const spec: FieldSpec = {
    name,
    type,
    label: String(attrs.label ?? name),
    required: truthy(attrs.required),
    help: attrs.help ? String(attrs.help) : undefined,
    placeholder: attrs.placeholder ? String(attrs.placeholder) : undefined,
    multiple: truthy(attrs.multiple) || type === "checkboxes",
    min: num(attrs.min),
    max: num(attrs.max),
    step: num(attrs.step),
    low: attrs.low ? String(attrs.low) : undefined,
    high: attrs.high ? String(attrs.high) : undefined,
  };
  if (type === "choice") spec.options = options;
  else if (type === "select" || type === "radio" || type === "checkboxes") spec.options = splitOptions(attrs.options);
  if (type === "rating") spec.max = spec.max ?? 5;
  if (type === "scale") {
    spec.min = spec.min ?? 1;
    spec.max = spec.max ?? 5;
  }
  if (type === "slider") {
    spec.min = spec.min ?? 0;
    spec.max = spec.max ?? 100;
    spec.step = spec.step ?? 1;
  }
  return spec;
}

/** Every question on a page, in reading order. */
export function formFields(doc: JSONContent): FieldSpec[] {
  const out: FieldSpec[] = [];
  const seen = new Set<string>();
  const walk = (node: JSONContent) => {
    const attrs = (node.attrs?.attributes ?? {}) as Record<string, unknown>;
    let spec: FieldSpec | null = null;
    if (node.type === "field") spec = fieldSpec(attrs, "field");
    if (node.type === "choice") {
      const options = (node.content ?? [])
        .filter((o) => o.type === "option")
        .map((o, i) => {
          const a = (o.attrs?.attributes ?? {}) as Record<string, unknown>;
          const label = String(a.label ?? a.value ?? `Option ${i + 1}`);
          return { value: String(a.value ?? label), label };
        });
      spec = fieldSpec(attrs, "choice", options);
    }
    if (spec && !seen.has(spec.name)) {
      seen.add(spec.name);
      out.push(spec);
    }
    if (node.type !== "choice") node.content?.forEach(walk);
  };
  walk(doc);
  return out;
}

export function isEmpty(value: Answer | undefined): boolean {
  return value === undefined || value === null || value === "" || value === false || (Array.isArray(value) && value.length === 0);
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What is wrong with one answer, in words for the person filling it in, or null. */
export function checkAnswer(field: FieldSpec, value: Answer | undefined): string | null {
  if (isEmpty(value)) return field.required ? "This one is required." : null;
  const values = field.options?.map((o) => o.value) ?? [];
  switch (field.type) {
    case "email":
      return EMAIL.test(String(value)) ? null : "That does not look like an email address.";
    case "url":
      return /^https?:\/\/\S+$/i.test(String(value)) ? null : "Start the link with http:// or https://.";
    case "number":
    case "slider":
    case "rating":
    case "scale": {
      const n = Number(value);
      if (!Number.isFinite(n)) return "Enter a number.";
      if (field.min !== undefined && n < field.min) return `The lowest is ${field.min}.`;
      if (field.max !== undefined && n > field.max) return `The highest is ${field.max}.`;
      return null;
    }
    case "select":
    case "radio":
      return values.includes(String(value)) ? null : "Pick one of the options.";
    case "checkboxes":
    case "choice": {
      if (!field.multiple && !Array.isArray(value)) return values.includes(String(value)) ? null : "Pick one of the options.";
      const list = Array.isArray(value) ? value : [String(value)];
      if (!field.multiple && list.length > 1) return "Pick just one.";
      return list.every((v) => values.includes(String(v))) ? null : "Pick from the options.";
    }
    default:
      return String(value).length > 20_000 ? "That is too long." : null;
  }
}

/** Keep only answers to questions on the page, shaped the way each type expects. */
export function cleanAnswers(fields: FieldSpec[], raw: Record<string, unknown>): Answers {
  const out: Answers = {};
  for (const f of fields) {
    const v = raw[f.name];
    if (v === undefined || v === null) continue;
    // Each option once, and no more picks than there are options.
    if (f.multiple || f.type === "checkboxes")
      out[f.name] = [...new Set((Array.isArray(v) ? v : [v]).map(String))].slice(0, Math.max(f.options?.length ?? 0, 1));
    else if (f.type === "checkbox" || f.type === "switch") out[f.name] = v === true || v === "true";
    else if (["number", "slider", "rating", "scale"].includes(f.type)) out[f.name] = v === "" ? null : Number(v);
    else out[f.name] = String(v);
  }
  return out;
}

/** Every problem with a set of answers, by field name. Empty when they can be sent. */
export function checkAnswers(fields: FieldSpec[], answers: Answers): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const f of fields) {
    const problem = checkAnswer(f, answers[f.name]);
    if (problem) errors[f.name] = problem;
  }
  return errors;
}

/** An answer as text, for tables and CSV. */
export function answerText(field: FieldSpec | undefined, value: Answer | undefined): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map((v) => field?.options?.find((o) => o.value === v)?.label ?? v).join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return field?.options?.find((o) => o.value === String(value))?.label ?? String(value);
}
