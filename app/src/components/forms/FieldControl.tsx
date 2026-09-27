"use client";

import { onRadioKeys, radioTab } from "@/components/indy/radio";
import { Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import type { Answer, FieldSpec } from "@/lib/forms/spec";
import { cn } from "@/lib/utils";

const INPUT_TYPE: Partial<Record<FieldSpec["type"], string>> = {
  text: "text",
  email: "email",
  number: "number",
  url: "url",
  tel: "tel",
  date: "date",
  time: "time",
};

/** Phones pick the right keyboard from these. */
const INPUT_MODE: Partial<Record<FieldSpec["type"], React.HTMLAttributes<HTMLInputElement>["inputMode"]>> = {
  email: "email",
  number: "decimal",
  url: "url",
  tel: "tel",
};

/** What an empty field shows when the author gave no placeholder. */
const DEFAULT_PLACEHOLDER: Partial<Record<FieldSpec["type"], string>> = {
  tel: "+1 …",
};

const control = "h-11 text-base md:h-10 md:text-[15px]";

/** The input for one question, chosen by its type. */
export function FieldControl({
  field,
  value,
  onChange,
  invalid,
  id,
}: {
  field: FieldSpec;
  value: Answer | undefined;
  onChange: (value: Answer) => void;
  invalid: boolean;
  id: string;
}) {
  const aria = { "aria-invalid": invalid || undefined, "aria-required": field.required || undefined };

  switch (field.type) {
    case "textarea":
      return (
        <Textarea
          id={id}
          {...aria}
          value={String(value ?? "")}
          placeholder={field.placeholder}
          onChange={(e) => onChange(e.target.value)}
          className="min-h-[108px] text-base md:text-[15px]"
        />
      );

    case "select":
      return (
        <Select value={value ? String(value) : undefined} onValueChange={(v) => onChange(v)}>
          <SelectTrigger id={id} {...aria} className={cn(control, "w-full")}>
            <SelectValue placeholder={field.placeholder ?? "Choose one"} />
          </SelectTrigger>
          <SelectContent>
            {field.options?.map((o) => (
              <SelectItem key={o.value} value={o.value} className="py-2.5 text-base md:py-1.5 md:text-sm">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "radio":
      return (
        <RadioGroup id={id} {...aria} value={value ? String(value) : ""} onValueChange={(v) => onChange(v)} className="gap-2">
          {field.options?.map((o) => (
            <label key={o.value} className={cn("q-tile", value === o.value && "q-tile--on")}>
              <RadioGroupItem value={o.value} />
              <span>{o.label}</span>
            </label>
          ))}
        </RadioGroup>
      );

    case "checkboxes": {
      const list = Array.isArray(value) ? value : [];
      return (
        <div id={id} {...aria} className="flex flex-col gap-2">
          {field.options?.map((o) => (
            <label key={o.value} className={cn("q-tile", list.includes(o.value) && "q-tile--on")}>
              <Checkbox
                checked={list.includes(o.value)}
                onCheckedChange={(on) => onChange(on ? [...list, o.value] : list.filter((v) => v !== o.value))}
              />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      );
    }

    case "checkbox":
      return (
        <label className={cn("q-tile", value === true && "q-tile--on")}>
          <Checkbox id={id} {...aria} checked={value === true} onCheckedChange={(on) => onChange(on === true)} />
          <span>{field.placeholder ?? "Yes"}</span>
        </label>
      );

    case "switch":
      return (
        <Switch id={id} {...aria} checked={value === true} onCheckedChange={(on) => onChange(on)} className="q-switch" />
      );

    case "rating": {
      const n = Number(value ?? 0);
      return (
        <div id={id} {...aria} role="radiogroup" onKeyDown={onRadioKeys} className="flex gap-1">
          {Array.from({ length: field.max ?? 5 }, (_, i) => i + 1).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={n === v}
              tabIndex={radioTab(n === v, v - 1, n > 0)}
              aria-label={`${v} of ${field.max ?? 5}`}
              onClick={() => onChange(n === v ? null : v)}
              className="flex size-12 items-center justify-center rounded-lg text-faint transition-colors hover:text-sand"
            >
              <Star className={cn("size-7", v <= n && "fill-sand text-sand")} strokeWidth={1.5} />
            </button>
          ))}
        </div>
      );
    }

    case "scale": {
      const min = field.min ?? 1;
      const max = field.max ?? 5;
      const steps = Array.from({ length: Math.min(max - min + 1, 11) }, (_, i) => min + i);
      return (
        <div className="flex flex-col gap-2">
          <div id={id} {...aria} role="radiogroup" onKeyDown={onRadioKeys} className="flex gap-2">
            {steps.map((v, i) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={value === v}
                tabIndex={radioTab(value === v, i, steps.includes(value as number))}
                onClick={() => onChange(value === v ? null : v)}
                className={cn("q-tile q-tile--step", value === v && "q-tile--on")}
              >
                {v}
              </button>
            ))}
          </div>
          {field.low || field.high ? (
            <div className="flex justify-between text-[13px] text-muted-foreground">
              <span>
                {min} is {field.low ?? "lowest"}
              </span>
              <span>
                {/* Long scales are cut to eleven steps, so the top is the last one shown. */}
                {steps[steps.length - 1]} is {field.high ?? "highest"}
              </span>
            </div>
          ) : null}
        </div>
      );
    }

    case "slider": {
      const v = typeof value === "number" ? value : (field.min ?? 0);
      return (
        <div className="flex items-center gap-4 py-2">
          <Slider id={id} {...aria} min={field.min} max={field.max} step={field.step} value={[v]} onValueChange={([n]) => onChange(n)} className="flex-1" />
          <span className="w-12 text-right font-mono text-sm">{value === undefined || value === null ? "—" : v}</span>
        </div>
      );
    }

    default:
      return (
        <Input
          id={id}
          {...aria}
          type={INPUT_TYPE[field.type] ?? "text"}
          inputMode={INPUT_MODE[field.type]}
          value={value === undefined || value === null ? "" : String(value)}
          placeholder={field.placeholder ?? DEFAULT_PLACEHOLDER[field.type]}
          min={field.min}
          max={field.max}
          step={field.step}
          autoComplete={field.type === "email" ? "email" : field.type === "tel" ? "tel" : undefined}
          onChange={(e) => onChange(e.target.value)}
          className={control}
        />
      );
  }
}
