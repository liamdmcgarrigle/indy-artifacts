"use client";

import { useId, useState } from "react";
import { NodeViewContent, NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Check, Plus, X } from "lucide-react";
import { FIELD_TYPES, fieldSpec, type Answer, type FieldSpec } from "@/lib/forms/spec";
import { Typeable } from "@/components/editor/Typeable";
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

const TYPE_NAMES: Record<string, string> = {
  text: "Short text",
  textarea: "Long text",
  email: "Email",
  number: "Number",
  url: "Link",
  tel: "Phone",
  date: "Date",
  time: "Time",
  select: "Dropdown",
  radio: "One of a list",
  checkboxes: "Several of a list",
  checkbox: "Tick box",
  switch: "On or off",
  rating: "Stars",
  scale: "Scale",
  slider: "Slider",
};

/** Write a question's attributes, dropping empty ones so the markdown stays short. */
function attrWriter(attrs: Attrs, updateAttributes: ReactNodeViewProps["updateAttributes"]) {
  return (patch: Record<string, string | null>) => {
    const next: Attrs = { ...attrs };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete next[k];
      else next[k] = v;
    }
    updateAttributes({ attributes: next });
  };
}

function RequiredToggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button type="button" className={cn("q-tool", on && "q-tool--on")} onClick={() => onChange(!on)} aria-pressed={on}>
      Required
    </button>
  );
}

/** A question while editing: its words typed in place, its options as a list, its kind from a menu. */
function FieldEditor({ node, updateAttributes }: ReactNodeViewProps) {
  const id = useId();
  const attrs = (node.attrs.attributes ?? {}) as Attrs;
  const field = fieldSpec(attrs, "field");
  const set = attrWriter(attrs, updateAttributes);
  if (!field) return <NodeViewWrapper className="art-q art-q--broken">A question here has no name.</NodeViewWrapper>;
  const listed = ["select", "radio", "checkboxes"].includes(field.type);
  const options = String(attrs.options ?? "").split("|").filter((o) => o !== "");
  const writeOptions = (next: string[]) => set({ options: next.length ? next.join("|") : null });
  return (
    <NodeViewWrapper className="art-q art-q--editing" data-field={field.name} contentEditable={false}>
      <div className="art-q__head">
        <span className="art-q__label">
          <Typeable as="span" value={String(attrs.label ?? "")} placeholder="Ask a question" onChange={(v) => set({ label: v || null })} />
        </span>
        <Typeable as="p" className="art-q__help" value={String(attrs.help ?? "")} placeholder="Add help text, if it needs any" onChange={(v) => set({ help: v || null })} />
      </div>
      {listed ? (
        <div className="q-options">
          {options.map((o, i) => (
            <div key={i} className="q-tile q-options__row">
              <span className={cn("q-options__mark", field.type === "checkboxes" && "q-options__mark--square")} />
              <Typeable
                as="span"
                value={o}
                placeholder={`Option ${i + 1}`}
                onChange={(v) => writeOptions(options.map((x, j) => (j === i ? v.replace(/\|/g, "/") : x)))}
              />
              <button type="button" aria-label="Remove option" onClick={() => writeOptions(options.filter((_, j) => j !== i))}>
                <X className="size-3.5" />
              </button>
            </div>
          ))}
          <button type="button" className="q-options__add" onClick={() => writeOptions([...options, `Option ${options.length + 1}`])}>
            <Plus className="size-4" /> Add an option
          </button>
        </div>
      ) : (
        <div className="art-q__preview" aria-hidden>
          <FieldControl field={field} value={undefined} onChange={() => {}} invalid={false} id={id} />
        </div>
      )}
      <div className="q-tools">
        <select className="q-tool" value={field.type} onChange={(e) => set({ type: e.target.value })} aria-label="Kind of answer">
          {FIELD_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_NAMES[t]}
            </option>
          ))}
        </select>
        <RequiredToggle on={field.required} onChange={(on) => set({ required: on ? "" : null })} />
      </div>
    </NodeViewWrapper>
  );
}

export function FieldView(props: ReactNodeViewProps) {
  if (props.editor.isEditable) return <FieldEditor {...props} />;
  return <FieldAnswer {...props} />;
}

function FieldAnswer({ node }: ReactNodeViewProps) {
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
export function ChoiceView(props: ReactNodeViewProps) {
  if (props.editor.isEditable) return <ChoiceEditor {...props} />;
  return <ChoiceAnswer {...props} />;
}

function ChoiceEditor({ node, updateAttributes, editor, getPos }: ReactNodeViewProps) {
  const attrs = (node.attrs.attributes ?? {}) as Attrs;
  const set = attrWriter(attrs, updateAttributes);
  const required = attrs.required !== undefined && attrs.required !== "false";
  const multiple = attrs.multiple !== undefined && attrs.multiple !== "false";
  const columns = Math.min(Math.max(Number(attrs.columns) || node.childCount, 1), 4);
  const addOption = () => {
    const pos = typeof getPos === "function" ? getPos() : undefined;
    if (typeof pos !== "number") return;
    const n = node.childCount + 1;
    editor
      .chain()
      .insertContentAt(pos + node.nodeSize - 1, { type: "option", attrs: { attributes: { value: `option-${n}`, label: `Option ${n}` } }, content: [{ type: "paragraph" }] })
      .run();
  };
  return (
    <NodeViewWrapper className="art-q art-choice-q art-q--editing">
      <div className="art-q__head" contentEditable={false}>
        <span className="art-q__label">
          <Typeable as="span" value={String(attrs.label ?? "")} placeholder="Ask a question" onChange={(v) => set({ label: v || null })} />
        </span>
      </div>
      <NodeViewContent className="art-choice__options" style={{ "--cols": columns } as React.CSSProperties} />
      <div className="q-tools" contentEditable={false}>
        <button type="button" className="q-tool" onClick={addOption}>
          <Plus className="size-3.5" /> Option
        </button>
        <RequiredToggle on={required} onChange={(on) => set({ required: on ? "" : null })} />
        <button type="button" className={cn("q-tool", multiple && "q-tool--on")} aria-pressed={multiple} onClick={() => set({ multiple: multiple ? null : "" })}>
          Several allowed
        </button>
      </div>
    </NodeViewWrapper>
  );
}

function ChoiceAnswer({ node }: ReactNodeViewProps) {
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

export function OptionView(props: ReactNodeViewProps) {
  if (props.editor.isEditable) return <OptionEditor {...props} />;
  return <OptionAnswer {...props} />;
}

function OptionEditor({ node, updateAttributes, deleteNode }: ReactNodeViewProps) {
  const attrs = (node.attrs.attributes ?? {}) as Attrs;
  return (
    <NodeViewWrapper className="art-opt art-opt--editing">
      <NodeViewContent className="art-opt__body" />
      <div className="art-opt__foot" contentEditable={false}>
        <span className="art-opt__mark" />
        <Typeable
          as="span"
          className="art-opt__label"
          value={String(attrs.label ?? "")}
          placeholder="Option name"
          onChange={(label) => updateAttributes({ attributes: { ...attrs, label } })}
        />
        <button type="button" className="art-opt__drop" aria-label="Remove option" onClick={deleteNode}>
          <X className="size-3.5" />
        </button>
      </div>
    </NodeViewWrapper>
  );
}

function OptionAnswer({ node, editor, getPos }: ReactNodeViewProps) {
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
