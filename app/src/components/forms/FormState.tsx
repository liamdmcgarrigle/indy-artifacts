"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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
  /** Empties every answer, here and in this browser's saved copy. */
  clear: () => void;
  /** How many questions have an answer. */
  answered: number;
  requiredLeft: FieldSpec[];
}

const Context = createContext<FormState | null>(null);

/** Answers in progress are kept in this browser, so a refresh or a closed tab loses nothing. */
const storageKey = (slug: string) => `indy-form:${slug}`;

function loadAnswers(slug: string, byName: Map<string, FieldSpec>): Answers {
  try {
    const raw = JSON.parse(localStorage.getItem(storageKey(slug)) ?? "null") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    // Drop answers to questions the page no longer asks.
    return Object.fromEntries(Object.entries(raw as Answers).filter(([name]) => byName.has(name)));
  } catch {
    return {};
  }
}

function saveAnswers(slug: string, answers: Answers) {
  try {
    const kept = Object.entries(answers).filter(([, v]) => !isEmpty(v));
    if (kept.length) localStorage.setItem(storageKey(slug), JSON.stringify(Object.fromEntries(kept)));
    else localStorage.removeItem(storageKey(slug));
  } catch {
    // Storage can be full or blocked; the form still works, it just will not survive a refresh.
  }
}

/** The form on this page, or null on a page without questions. */
export function useForm(): FormState | null {
  return useContext(Context);
}

/** Answers, validation and sending for one page's questions. */
export function FormProvider({
  slug,
  fields,
  settings,
  submitUrl,
  onSent,
  children,
}: {
  slug: string;
  fields: FieldSpec[];
  settings: FormSettings;
  /** Where answers go; a visitor's go through their share link. */
  submitUrl?: string;
  onSent?: () => void;
  children: React.ReactNode;
}) {
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tried, setTried] = useState(false);
  const [status, setStatus] = useState<FormState["status"]>("open");
  const byName = useMemo(() => new Map(fields.map((f) => [f.name, f])), [fields]);
  // Saved answers are read after mount, so the server render and the first client render agree.
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setAnswers((prev) => ({ ...loadAnswers(slug, byName), ...prev }));
    setLoaded(true);
    // Only on arrival: later changes to the questions keep what is being typed.
  }, [slug]);

  useEffect(() => {
    if (loaded) saveAnswers(slug, answers);
  }, [slug, answers, loaded]);

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
      const res = await fetch(submitUrl ?? `/api/artifacts/${slug}/responses`, {
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
      saveAnswers(slug, {});
      setAnswers({});
      setStatus("sent");
      onSent?.();
    } catch {
      setErrors({ _form: "That did not send. Check the connection and try again." });
      setStatus("open");
    }
  }, [answers, fields, slug, submitUrl, onSent]);

  const reset = useCallback(() => {
    setAnswers({});
    setErrors({});
    setTried(false);
    setStatus("open");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  const clear = useCallback(() => {
    saveAnswers(slug, {});
    reset();
  }, [slug, reset]);

  const answered = useMemo(() => fields.filter((f) => !isEmpty(answers[f.name])).length, [fields, answers]);

  const requiredLeft = useMemo(() => fields.filter((f) => f.required && isEmpty(answers[f.name])), [fields, answers]);

  const value = useMemo<FormState>(
    () => ({ fields, byName, settings, answers, errors, set, status, submit, reset, clear, answered, requiredLeft }),
    [fields, byName, settings, answers, errors, set, status, submit, reset, clear, answered, requiredLeft],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
