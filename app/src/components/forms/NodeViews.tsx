"use client";

import { useId, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Check } from "lucide-react";
import { fieldSpec, type Answer, type FieldSpec } from "@/lib/forms/spec";
import { cn } from "@/lib/utils";
import { FieldControl } from "./FieldControl";
import { useForm } from "./FormState";

type Attrs = Record<string, unknown>;

/** The page's form state, or a private one when the page is shown without it. */
function useAnswer(field: FieldSpec | null): [Answer | undefined, (v: Answer) => void, string | undefined] {
  const form = useForm();
  const [local, setLocal] = useState<Answer | undefined>(undefined);
  if (!field) return [undefined, () => {}, undefined];
  if (!form) return [local, setLocal, undefined];
  return [form.answers[field.name], (v) => form.set(field.name, v), form.errors[field.name]];
}

function Label({ field, htmlFor }: { field: FieldSpec; htmlFor?: string }) {
  return (
    <span className="art-q__label">
      {htmlFor ? <label htmlFor={htmlFor}>{field.label}</label> : <span>{field.label}</span>}
      {field.required ? <span className="art-q__required">Required</span> : null}
    </span>
  );
}

export function FieldView({ node }: ReactNodeViewProps) {
  const id = useId();
  const form = useForm();
  const attrs = (node.attrs.attributes ?? {}) as Attrs;
  const field = form?.byName.get(String(attrs.name)) ?? fieldSpec(attrs, "field");
  const [value, setValue, error] = useAnswer(field);
  if (!field) return <NodeViewWrapper className="art-q art-q--broken">A question here has no name, so it cannot be answered.</NodeViewWrapper>;
  const labelled = !["radio", "checkboxes", "rating", "scale"].includes(field.type);
  // A switch is a yes or no to the question itself: it sits on the question's line.
  const inline = field.type === "switch";
  return (
    <NodeViewWrapper className={cn("art-q", inline && "art-q--inline", error && "art-q--invalid")} data-field={field.name} contentEditable={false}>
      <div className="art-q__head">
        <Label field={field} htmlFor={labelled ? id : undefined} />
        {field.help ? <p className="art-q__help">{field.help}</p> : null}
      </div>
      <FieldControl field={field} value={value} onChange={setValue} invalid={Boolean(error)} id={id} />
      {error ? (
        <p className="art-q__error" role="alert">
          {error}
        </p>
      ) : null}
    </NodeViewWrapper>
  );
}

/** A choice of rich options: each option is a card that can hold any content. */
export function ChoiceView({ node }: ReactNodeViewProps) {
  const form = useForm();
  const attrs = (node.attrs.attributes ?? {}) as Attrs;
  const field = form?.byName.get(String(attrs.name)) ?? fieldSpec(attrs, "choice");
  const error = field ? form?.errors[field.name] : undefined;
  const columns = Math.min(Math.max(Number(attrs.columns) || node.childCount, 1), 4);
  return (
    <NodeViewWrapper
      className={cn("art-q art-choice-q", error && "art-q--invalid")}
      data-field={field?.name}
      role={field?.multiple ? "group" : "radiogroup"}
      aria-label={field?.label}
    >
      {field ? (
        <div className="art-q__head" contentEditable={false}>
          <Label field={field} />
          {field.help ? <p className="art-q__help">{field.help}</p> : null}
        </div>
      ) : null}
      <NodeViewContent className="art-choice__options" style={{ "--cols": columns } as React.CSSProperties} />
      {error ? (
        <p className="art-q__error" role="alert" contentEditable={false}>
          {error}
        </p>
      ) : null}
    </NodeViewWrapper>
  );
}

export function OptionView({ node, editor, getPos }: ReactNodeViewProps) {
  const form = useForm();
  const attrs = (node.attrs.attributes ?? {}) as Attrs;
  const pos = typeof getPos === "function" ? getPos() : undefined;
  const parent = typeof pos === "number" ? editor.state.doc.resolve(pos).parent : null;
  const choiceAttrs = (parent?.attrs.attributes ?? {}) as Attrs;
  const name = String(choiceAttrs.name ?? "");
  const field = form?.byName.get(name);
  const multiple = field?.multiple ?? false;
  const value = String(attrs.value ?? attrs.label ?? "");
  const current = field ? form?.answers[name] : undefined;
  const selected = Array.isArray(current) ? current.includes(value) : current === value;

  const toggle = () => {
    if (!form || !field || form.status === "sent") return;
    if (multiple) {
      const list = Array.isArray(current) ? current : [];
      form.set(name, selected ? list.filter((v) => v !== value) : [...list, value]);
    } else form.set(name, selected ? null : value);
  };

  return (
    <NodeViewWrapper
      className={cn("art-opt", selected && "art-opt--on")}
      role={multiple ? "checkbox" : "radio"}
      aria-checked={selected}
      tabIndex={0}
      onClick={(e: React.MouseEvent) => {
        // A link inside an option ("Try it") opens; it does not pick.
        if ((e.target as HTMLElement).closest("a, iframe")) return;
        toggle();
      }}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          toggle();
        }
      }}
    >
      <NodeViewContent className="art-opt__body" />
      <div className="art-opt__foot" contentEditable={false}>
        <span className={cn("art-opt__mark", multiple && "art-opt__mark--square")}>{selected ? <Check className="size-3.5" strokeWidth={3} /> : null}</span>
        <span className="art-opt__label">{String(attrs.label ?? value)}</span>
      </div>
    </NodeViewWrapper>
  );
}
