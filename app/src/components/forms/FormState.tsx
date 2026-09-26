"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { checkAnswers, isEmpty, type Answer, type Answers, type FieldSpec, type FormSettings } from "@/lib/forms/spec";

interface FormState {
  fields: FieldSpec[];
  byName: Map<string, FieldSpec>;
  settings: FormSettings;
  answers: Answers;
  /** Problems to show; empty until the first try at sending. */
  errors: Record<string, string>;
  set: (name: string, value: Answer) => void;
  status: "open" | "sending" | "sent";
  submit: () => Promise<void>;
  reset: () => void;
  requiredLeft: FieldSpec[];
}

const Context = createContext<FormState | null>(null);

/** The form on this page, or null on a page without questions. */
export function useForm(): FormState | null {
  return useContext(Context);
}

/** Answers, validation and sending for one page's questions. */
export function FormProvider({
  slug,
  fields,
  settings,
  onSent,
  children,
}: {
  slug: string;
  fields: FieldSpec[];
  settings: FormSettings;
  onSent?: () => void;
  children: React.ReactNode;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const [status, setStatus] = useState<FormState["status"]>("open");
  const byName = useMemo(() => new Map(fields.map((f) => [f.name, f])), [fields]);

  const set = useCallback(
    (name: string, value: Answer) => {
      setAnswers((prev) => {
        const next = { ...prev, [name]: value };
        // Once someone has tried to send, keep the problems current as they fix them.
        if (tried) setErrors(checkAnswers(fields, next));
        return next;
      });
    },
    [fields, tried],
  );

  const submit = useCallback(async () => {
    setTried(true);
    const problems = checkAnswers(fields, answers);
    setErrors(problems);
    const first = fields.find((f) => problems[f.name]);
    if (first) {
      document.querySelector(`[data-field="${CSS.escape(first.name)}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setStatus("sending");
    try {
      const res = await fetch(`/api/artifacts/${slug}/responses`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      const data = (await res.json()) as { error?: { message?: string; fields?: Record<string, string> } };
      if (!res.ok) {
        setErrors(data.error?.fields ?? { _form: data.error?.message ?? "That did not send. Try again." });
        setStatus("open");
        return;
      }
      setStatus("sent");
      onSent?.();
    } catch {
      setErrors({ _form: "That did not send. Check the connection and try again." });
      setStatus("open");
    }
  }, [answers, fields, slug, onSent]);

  const reset = useCallback(() => {
    setAnswers({});
    setErrors({});
    setTried(false);
    setStatus("open");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const requiredLeft = useMemo(() => fields.filter((f) => f.required && isEmpty(answers[f.name])), [fields, answers]);

  const value = useMemo<FormState>(
    () => ({ fields, byName, settings, answers, errors, set, status, submit, reset, requiredLeft }),
    [fields, byName, settings, answers, errors, set, status, submit, reset, requiredLeft],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
