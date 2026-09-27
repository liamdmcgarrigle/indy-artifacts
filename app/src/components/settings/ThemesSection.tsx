"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, Copy, Eye, Moon, Pencil, Plus, Sun, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { normaliseHex } from "@/lib/themes/color";
import {
  COLOR_KEYS,
  darkColors,
  deriveTheme,
  DENSITIES,
  FONTS,
  SHADOWS,
  TOKEN_HELP,
  type ColorKey,
  type DarkOverrides,
  type ThemeTokens,
} from "@/lib/themes/tokens";
import { cn } from "@/lib/utils";
import { Card, Head, Row, send, type Say } from "./parts";

export interface ThemeInfo {
  name: string;
  label: string;
  preset: boolean;
  description: string | null;
  tokens: ThemeTokens;
  dark: DarkOverrides;
  updatedAt: string | null;
}

export interface ThemesState {
  themes: ThemeInfo[];
  projects: { name: string; theme: string | null; pages: number }[];
  defaultTheme: string;
  fonts: { id: string; label: string; kind: "sans" | "serif" | "mono" }[];
  colors: readonly string[];
  help: Record<string, string>;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
/** What the server refuses in a label. */
const BAD_LABEL = /[<>*/\\\u0000-\u001f]/;
const LABEL_RULE = "A name can't contain < > * / or \\.";

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

/** Why a label can't be used, or null. `taken` names that already exist. */
function labelProblem(label: string, taken: (name: string) => boolean): string | null {
  const name = slugify(label);
  if (!label.trim()) return null;
  if (BAD_LABEL.test(label)) return LABEL_RULE;
  if (!NAME.test(name)) return "Use at least one letter or digit.";
  if (name === "default") return "That name is reserved. Try another.";
  if (taken(name)) return `There is already a theme called ${name}.`;
  return null;
}

const FALLBACK = "paper";

const cap = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

const COLOR_NAMES: Record<ColorKey, string> = {
  background: "Background",
  surface: "Surface",
  text: "Text",
  muted: "Muted text",
  border: "Border",
  accent: "Accent",
  info: "Info",
  good: "Good",
  warn: "Warning",
  bad: "Bad",
};

const RING = "outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";
const SELECT = cn("h-9 w-full min-w-0 rounded-md border border-input bg-raised px-2.5 text-sm disabled:opacity-60 max-sm:h-10", RING);
const FIELD = "h-9 max-sm:h-10";
const TEXT_BUTTON = cn("rounded-sm py-2 text-muted-foreground hover:text-foreground", RING);

/** Indy's own scheme, which follows the toggle in the header. */
function useAppScheme(): "light" | "dark" {
  const [scheme, setScheme] = useState<"light" | "dark">("light");
  useEffect(() => {
    const read = () => setScheme(document.documentElement.getAttribute("data-scheme") === "dark" ? "dark" : "light");
    read();
    window.addEventListener("art:scheme", read);
    return () => window.removeEventListener("art:scheme", read);
  }, []);
  return scheme;
}

/** What the editor is working on: an existing theme, or a new one not saved yet. */
interface Draft {
  name: string;
  label: string;
  tokens: ThemeTokens;
  dark: DarkOverrides;
  /** Set for a theme that does not exist yet: the theme it was started from. */
  base: string | null;
  readOnly: boolean;
}

const same = (a: Draft, b: Draft) => a.label === b.label && JSON.stringify([a.tokens, a.dark]) === JSON.stringify([b.tokens, b.dark]);

function draftUrl(d: Draft | null): string {
  if (!d) return "/settings?s=themes";
  if (d.base) {
    const q = new URLSearchParams({ s: "themes", new: d.name, base: d.base, label: d.label });
    return `/settings?${q}`;
  }
  return `/settings?s=themes&edit=${encodeURIComponent(d.name)}`;
}

/** The editor the address asks for, if any. */
function draftFromUrl(themes: ThemeInfo[]): Draft | null {
  const q = new URLSearchParams(window.location.search);
  const edit = q.get("edit");
  const created = q.get("new");
  if (edit) {
    const t = themes.find((x) => x.name === edit);
    return t ? { name: t.name, label: t.label, tokens: { ...t.tokens }, dark: { ...t.dark }, base: null, readOnly: t.preset } : null;
  }
  if (created && NAME.test(created) && !themes.some((t) => t.name === created)) {
    const base = themes.find((x) => x.name === q.get("base")) ?? themes[0];
    return { name: created, label: q.get("label") || created, tokens: { ...base.tokens }, dark: { ...base.dark }, base: base.name, readOnly: false };
  }
  return null;
}

/**
 * Settings > Themes: the default, which project uses which theme, and an
 * editor with a live preview. The preview runs the same derivation the
 * server does, so what it shows is what pages get.
 */
export function ThemesSection({ state, setState, say }: { state: ThemesState; setState: (s: ThemesState) => void; say: Say }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  // The draft as it was opened, for telling whether there is anything to lose.
  const [original, setOriginal] = useState<Draft | null>(null);
  const [naming, setNaming] = useState<{ from: ThemeInfo; mode: "new" | "duplicate" } | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const targets = useRef<Record<string, HTMLElement | null>>({});
  const ref = (key: string) => (el: HTMLElement | null) => {
    targets.current[key] = el;
  };
  const scheme = useAppScheme();
  // Where focus goes back to when the editor closes: the button that opened it.
  const returnKey = useRef<string | null>(null);

  const byName = useMemo(() => new Map(state.themes.map((t) => [t.name, t])), [state.themes]);
  const defaultLabel = byName.get(state.defaultTheme)?.label ?? state.defaultTheme;
  const dirty = !!draft && !!original && !draft.readOnly && (!same(draft, original) || !!draft.base);

  // Focus moves once the element it names has rendered.
  useEffect(() => {
    if (!focus) return;
    const el = targets.current[focus];
    if (el) {
      el.focus();
      setFocus(null);
    }
  }, [focus, draft, state, confirming, naming]);

  const openDraft = useCallback((d: Draft, push: boolean) => {
    setDraft(d);
    setOriginal(d);
    if (push) window.history.pushState(null, "", draftUrl(d));
  }, []);

  // A reload or a link straight to an editor opens it.
  const themesRef = useRef(state.themes);
  themesRef.current = state.themes;
  useEffect(() => {
    const d = draftFromUrl(themesRef.current);
    if (d) openDraft(d, false);
  }, [openDraft]);

  // Back and Forward move in and out of the editor, asking before changes are lost.
  const live = useRef({ draft, dirty });
  live.current = { draft, dirty };
  useEffect(() => {
    const onPop = () => {
      const want = draftFromUrl(themesRef.current);
      const cur = live.current.draft;
      if (cur && (!want || want.name !== cur.name)) {
        if (live.current.dirty && !window.confirm(`Discard your changes to ${cur.label}?`)) {
          window.history.pushState(null, "", draftUrl(cur));
          return;
        }
        setDraft(null);
        setOriginal(null);
        setFocus(returnKey.current ?? `open:${cur.name}`);
      }
      if (want && (!cur || want.name !== cur.name)) openDraft(want, false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [openDraft]);

  // A new theme's address follows its name as the label is typed.
  useEffect(() => {
    if (draft?.base && window.location.pathname + window.location.search !== draftUrl(draft)) {
      window.history.replaceState(null, "", draftUrl(draft));
    }
  }, [draft]);

  // Closing the tab or reloading with unsaved changes asks first.
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  function closeEditor(opts: { ask: boolean; focusKey?: string }) {
    if (!draft) return;
    if (opts.ask && dirty && !window.confirm(`Discard your changes to ${draft.label}?`)) return;
    const key = opts.focusKey ?? returnKey.current ?? (draft.base ? "new" : `open:${draft.name}`);
    setDraft(null);
    setOriginal(null);
    window.history.pushState(null, "", draftUrl(null));
    setFocus(key);
  }

  async function act(run: () => Promise<Record<string, unknown>>, done: string) {
    try {
      const data = await run();
      if (data && "themes" in data) setState(data as unknown as ThemesState);
      say.good(done);
      return true;
    } catch (err) {
      say.bad(err);
      return false;
    }
  }

  async function setDefault(name: string) {
    await act(async () => {
      await send("/api/settings", "PATCH", { default_theme: name });
      return send("/api/themes", "GET");
    }, `Pages without a theme now use ${byName.get(name)?.label ?? name}.`);
  }

  const open = (t: ThemeInfo) => (returnKey.current = `open:${t.name}`) && openDraft({ name: t.name, label: t.label, tokens: { ...t.tokens }, dark: { ...t.dark }, base: null, readOnly: t.preset }, true);

  if (draft) {
    return (
      <ThemeEditor
        draft={draft}
        original={original ?? draft}
        setDraft={setDraft}
        fonts={state.fonts}
        taken={(n) => byName.has(n)}
        onDuplicate={() => {
          const from = byName.get(draft.name);
          closeEditor({ ask: false, focusKey: "theme-name" });
          if (from) setNaming({ from, mode: "duplicate" });
        }}
        onSave={async (d) => {
          // Every colour is sent for dark: a value sets an override, null clears one.
          const dark = Object.fromEntries(COLOR_KEYS.map((k) => [k, d.dark[k] ?? null]));
          try {
            const data = d.base
              ? await send("/api/themes", "POST", { name: d.name, label: d.label, base: d.base, tokens: d.tokens, dark })
              : await send(`/api/themes/${encodeURIComponent(d.name)}`, "PUT", { label: d.label, tokens: d.tokens, dark });
            setState(data as unknown as ThemesState);
            say.good(d.base ? `Created ${d.label}.` : "Saved.");
            closeEditor({ ask: false, focusKey: `open:${d.name}` });
            return null;
          } catch (err) {
            // Shown by the name field: a name already taken, or one the server refuses.
            return err instanceof Error ? err.message : String(err);
          }
        }}
        onClose={() => closeEditor({ ask: true })}
      />
    );
  }

  const deleteTheme = async (t: ThemeInfo) => {
    const index = state.themes.findIndex((x) => x.name === t.name);
    const ok = await act(() => send(`/api/themes/${encodeURIComponent(t.name)}`, "DELETE"), `Deleted ${t.label}.`);
    setConfirming(null);
    if (ok) {
      const next = state.themes.filter((x) => x.name !== t.name)[index];
      setFocus(next ? `open:${next.name}` : "all");
    } else setFocus(`trash:${t.name}`);
  };

  return (
    <>
      <Head
        title="Themes"
        lede="How pages look. A page uses its project's theme, or the default when its project has none. Pages can also name a theme of their own."
      />

      <Card>
        <Row label="Default theme" htmlFor="default-theme" help="For pages whose project has no theme.">
          <SavedSelect id="default-theme" className="sm:w-56" value={state.defaultTheme} onCommit={(v) => void setDefault(v)}>
            {state.themes.map((t) => (
              <option key={t.name} value={t.name}>
                {t.label}
              </option>
            ))}
          </SavedSelect>
        </Row>
      </Card>

      <Card title="Projects">
        {state.projects.length === 0 ? (
          <p className="m-0 px-[18px] py-5 text-sm text-muted-foreground">No projects yet. A project appears here once an agent publishes a page with one.</p>
        ) : (
          state.projects.map((p) => (
            <Row key={p.name} label={p.name} htmlFor={`project-${p.name}`} help={`${p.pages} ${p.pages === 1 ? "page" : "pages"}`}>
              <SavedSelect
                id={`project-${p.name}`}
                className="sm:w-56"
                value={p.theme ?? ""}
                onCommit={(v) =>
                  void act(
                    () => send(`/api/projects/${encodeURIComponent(p.name)}/theme`, "PUT", { theme: v || null }),
                    v ? `${p.name} now uses ${byName.get(v)?.label ?? v}.` : `${p.name} now uses the default.`,
                  )
                }
              >
                <option value="">Default ({defaultLabel})</option>
                {state.themes.map((t) => (
                  <option key={t.name} value={t.name}>
                    {t.label}
                  </option>
                ))}
              </SavedSelect>
            </Row>
          ))
        )}
        <p className="m-0 border-t border-hairline px-[18px] py-3 text-[12.5px] leading-relaxed text-muted-foreground">
          An agent can make a theme that matches a project&rsquo;s own design and set it here with{" "}
          <code className="font-mono text-[12px]">artifact_theme_set</code>.
        </p>
      </Card>

      <Card
        title="All themes"
        titleRef={ref("all")}
        action={
          <Button
            ref={ref("new")}
            size="sm"
            variant="outline"
            className="max-sm:h-10"
            onClick={() => {
              setNaming({ from: byName.get(state.defaultTheme) ?? state.themes[0], mode: "new" });
              setFocus("theme-name");
            }}
          >
            <Plus /> New theme
          </Button>
        }
      >
        {naming ? (
          <NameForm
            themes={state.themes}
            from={naming.from}
            mode={naming.mode}
            inputRef={ref("theme-name")}
            onCancel={() => {
              setFocus(naming.mode === "new" ? "new" : `copy:${naming.from.name}`);
              setNaming(null);
            }}
            onDone={(name, label, base) => {
              returnKey.current = naming.mode === "new" ? "new" : `copy:${naming.from.name}`;
              setNaming(null);
              openDraft({ name, label, tokens: { ...base.tokens }, dark: { ...base.dark }, base: base.name, readOnly: false }, true);
            }}
          />
        ) : null}
        <div className="grid gap-3 p-[18px] sm:grid-cols-2">
          {state.themes.map((t) => (
            <ThemeCard
              key={t.name}
              theme={t}
              scheme={scheme}
              isDefault={t.name === state.defaultTheme}
              projects={state.projects.filter((p) => p.theme === t.name).map((p) => p.name)}
              confirming={confirming === t.name}
              defaultLabel={defaultLabel}
              fallbackLabel={byName.get(FALLBACK)?.label ?? "Paper"}
              refFor={(what) => ref(`${what}:${t.name}`)}
              onEdit={() => open(t)}
              onDuplicate={() => {
                setNaming({ from: t, mode: "duplicate" });
                setFocus("theme-name");
              }}
              onDefault={() => void setDefault(t.name)}
              onDelete={() => {
                setConfirming(t.name);
                setFocus(`keep:${t.name}`);
              }}
              onCancelDelete={() => {
                setConfirming(null);
                setFocus(`trash:${t.name}`);
              }}
              onConfirmDelete={() => void deleteTheme(t)}
            />
          ))}
        </div>
      </Card>
    </>
  );
}

/**
 * A select that saves when it settles. Arrow keys change a closed select's
 * value on some platforms, so each step would otherwise be a save and a toast.
 */
function SavedSelect(props: { id: string; value: string; className?: string; onCommit: (v: string) => void; children: React.ReactNode }) {
  const [value, setValue] = useState(props.value);
  const timer = useRef<number | null>(null);
  useEffect(() => setValue(props.value), [props.value]);
  useEffect(() => () => void (timer.current && window.clearTimeout(timer.current)), []);
  return (
    <select
      id={props.id}
      className={cn(SELECT, props.className)}
      value={value}
      onChange={(e) => {
        const v = e.target.value;
        setValue(v);
        if (timer.current) window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
          timer.current = null;
          if (v !== props.value) props.onCommit(v);
        }, 400);
      }}
    >
      {props.children}
    </select>
  );
}

const SWATCH_KEYS: ColorKey[] = ["background", "surface", "text", "accent", "good", "warn", "bad"];

function Swatches({ tokens, dark, scheme }: { tokens: ThemeTokens; dark: DarkOverrides; scheme: "light" | "dark" }) {
  const colors = scheme === "dark" ? darkColors(tokens, dark) : tokens;
  return (
    <div className="flex overflow-hidden rounded-md border border-hairline">
      {SWATCH_KEYS.map((k) => (
        <span key={k} aria-hidden className="h-6 flex-1" style={{ background: colors[k] }} />
      ))}
      <span className="sr-only">
        {scheme === "dark" ? "Dark colours: " : "Colours: "}
        {SWATCH_KEYS.map((k) => `${COLOR_NAMES[k].toLowerCase()} ${colors[k]}`).join(", ")}
      </span>
    </div>
  );
}

function fontLabel(id: string) {
  return FONTS[id]?.label ?? id;
}

function ThemeCard(props: {
  theme: ThemeInfo;
  scheme: "light" | "dark";
  isDefault: boolean;
  projects: string[];
  confirming: boolean;
  defaultLabel: string;
  fallbackLabel: string;
  refFor: (what: "open" | "copy" | "trash" | "keep") => (el: HTMLElement | null) => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDefault: () => void;
  onDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const { theme: t } = props;
  const fonts = [...new Set([t.tokens.fontDisplay, t.tokens.fontBody].map(fontLabel))].join(" and ");
  const action = "max-sm:h-10";
  return (
    <div className="flex min-w-0 flex-col gap-3 rounded-lg border border-border p-3.5">
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <h3 className="m-0 truncate text-sm font-medium">{t.label}</h3>
          <span className="truncate text-xs text-muted-foreground">{fonts}</span>
        </div>
        <div className="flex shrink-0 gap-1">
          {t.preset ? <span className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">Built in</span> : null}
          {props.isDefault ? <span className="rounded-full bg-sand-soft px-2 py-0.5 text-[11px] text-sand">Default</span> : null}
        </div>
      </div>
      <Swatches tokens={t.tokens} dark={t.dark} scheme={props.scheme} />
      {props.projects.length ? <p className="m-0 truncate text-xs text-fg-3">Used by {props.projects.join(", ")}</p> : null}
      {props.confirming ? (
        <div
          role="group"
          aria-label={`Delete ${t.label}`}
          className="flex flex-col gap-2 rounded-md bg-raised p-2.5"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              props.onCancelDelete();
            }
          }}
        >
          <p className="m-0 text-[12.5px] leading-relaxed text-fg-2">
            Delete {t.label}? Pages and projects using it switch to {props.isDefault ? props.fallbackLabel : props.defaultLabel}.
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="destructive" className={action} onClick={props.onConfirmDelete}>
              Delete
            </Button>
            <Button ref={props.refFor("keep")} size="sm" variant="ghost" className={action} onClick={props.onCancelDelete}>
              Keep
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          <Button ref={props.refFor("open")} size="sm" variant="ghost" className={action} onClick={props.onEdit} aria-label={`${t.preset ? "View" : "Edit"} ${t.label}`}>
            {t.preset ? <Eye /> : <Pencil />} {t.preset ? "View" : "Edit"}
          </Button>
          <Button ref={props.refFor("copy")} size="sm" variant="ghost" className={action} onClick={props.onDuplicate} aria-label={`Duplicate ${t.label}`}>
            <Copy /> Duplicate
          </Button>
          {props.isDefault ? null : (
            <Button size="sm" variant="ghost" className={action} onClick={props.onDefault} aria-label={`Use ${t.label} as default`}>
              Use as default
            </Button>
          )}
          {t.preset ? null : (
            <Button ref={props.refFor("trash")} size="sm" variant="ghost" className={cn(action, "text-bad hover:text-bad")} onClick={props.onDelete} aria-label={`Delete ${t.label}`}>
              <Trash2 />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** The name for a new theme or a copy, and for a new one the preset to start from. */
function NameForm(props: {
  themes: ThemeInfo[];
  from: ThemeInfo;
  mode: "new" | "duplicate";
  inputRef: (el: HTMLElement | null) => void;
  onCancel: () => void;
  onDone: (name: string, label: string, base: ThemeInfo) => void;
}) {
  const [label, setLabel] = useState(props.mode === "duplicate" ? `${props.from.label} copy` : "");
  const [base, setBase] = useState(props.from.name);
  const name = slugify(label);
  const problem = labelProblem(label, (n) => props.themes.some((t) => t.name === n));
  return (
    <form
      className="flex flex-col gap-3 border-b border-hairline bg-raised/40 px-[18px] py-4"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          props.onCancel();
        }
      }}
      onSubmit={(e) => {
        e.preventDefault();
        const from = props.themes.find((t) => t.name === base);
        if (!problem && label.trim() && from) props.onDone(name, label.trim(), from);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor="theme-name">{props.mode === "duplicate" ? `Name for the copy of ${props.from.label}` : "Name"}</Label>
          <Input
            id="theme-name"
            ref={props.inputRef}
            className={FIELD}
            value={label}
            maxLength={60}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Acme"
            aria-invalid={problem ? true : undefined}
            aria-describedby="theme-name-note"
          />
          <p id="theme-name-note" aria-live="polite" className={cn("m-0 text-xs", problem ? "text-bad" : "text-muted-foreground")}>
            {problem ?? (name ? `Pages and agents refer to it as ${name}.` : "Pages and agents refer to it by a short name made from this.")}
          </p>
        </div>
        {props.mode === "new" ? (
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="theme-base">Start from</Label>
            <select id="theme-base" className={SELECT} value={base} onChange={(e) => setBase(e.target.value)}>
              {props.themes.map((t) => (
                <option key={t.name} value={t.name}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
      <div className="flex gap-2">
        <Button type="submit" size="sm" className="max-sm:h-10" disabled={!label.trim() || !!problem}>
          Continue
        </Button>
        <Button type="button" size="sm" variant="ghost" className="max-sm:h-10" onClick={props.onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

type Report = (id: string, invalid: boolean) => void;

/** A colour: the native picker and the hex, which can be typed or pasted. */
function ColorField(props: { id: string; value: string; onChange: (hex: string) => void; disabled?: boolean; label: string; report: Report }) {
  const { id, value, report } = props;
  const [text, setText] = useState(value);
  const bad = normaliseHex(text) === null;
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    report(id, bad);
    return () => report(id, false);
  }, [id, bad, report]);
  const note = `${id}-note`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          type="color"
          aria-label={`${props.label} picker`}
          value={value}
          disabled={props.disabled}
          onChange={(e) => props.onChange(e.target.value)}
          className={cn("h-9 w-9 shrink-0 cursor-pointer rounded-md border border-input bg-transparent p-0.5 disabled:cursor-default max-sm:h-10 max-sm:w-10", RING)}
        />
        <Input
          id={id}
          aria-label={props.label}
          value={text}
          disabled={props.disabled}
          spellCheck={false}
          aria-invalid={bad ? true : undefined}
          aria-describedby={bad ? note : undefined}
          className={cn(FIELD, "w-[92px] min-w-0 font-mono text-[13px] uppercase")}
          onChange={(e) => {
            setText(e.target.value);
            const hex = normaliseHex(e.target.value);
            if (hex) props.onChange(hex);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && bad) {
              e.preventDefault();
              e.stopPropagation();
              setText(value);
            }
          }}
        />
      </div>
      {bad ? (
        <p id={note} className="m-0 text-[11.5px] text-bad">
          Use a hex colour like #2a50d6.
        </p>
      ) : null}
    </div>
  );
}

function NumberField(props: {
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  disabled?: boolean;
  onChange: (n: number) => void;
  report: Report;
}) {
  const { id, value, min, max, report } = props;
  const [text, setText] = useState(String(value));
  const n = Number(text);
  const bad = text.trim() === "" || !Number.isFinite(n) || n < min || n > max;
  useEffect(() => setText(String(value)), [value]);
  useEffect(() => {
    report(id, bad);
    return () => report(id, false);
  }, [id, bad, report]);
  const note = `${id}-note`;
  return (
    <div className="flex flex-col items-end gap-1 max-sm:items-start">
      <div className="flex items-center gap-1.5">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={min}
          max={max}
          step={props.step}
          value={text}
          disabled={props.disabled}
          aria-invalid={bad ? true : undefined}
          aria-describedby={bad ? note : undefined}
          className={cn(FIELD, "w-24")}
          onChange={(e) => {
            setText(e.target.value);
            const v = Number(e.target.value);
            if (e.target.value.trim() !== "" && Number.isFinite(v) && v >= min && v <= max) props.onChange(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && bad) {
              e.preventDefault();
              e.stopPropagation();
              setText(String(value));
            }
          }}
        />
        {props.unit ? <span className="text-xs text-muted-foreground">{props.unit}</span> : null}
      </div>
      {bad ? (
        <p id={note} className="m-0 text-[11.5px] text-bad">
          {min} to {max}
        </p>
      ) : null}
    </div>
  );
}

function ThemeEditor(props: {
  draft: Draft;
  original: Draft;
  setDraft: (d: Draft) => void;
  fonts: ThemesState["fonts"];
  taken: (name: string) => boolean;
  /** Resolves to the server's refusal, or null once saved. */
  onSave: (d: Draft) => Promise<string | null>;
  onDuplicate: () => void;
  onClose: () => void;
}) {
  const { draft: d } = props;
  const ro = d.readOnly;
  const [busy, setBusy] = useState(false);
  const appScheme = useAppScheme();
  const [scheme, setScheme] = useState<"light" | "dark">(appScheme);
  useEffect(() => setScheme(appScheme), [appScheme]);
  const [showPreview, setShowPreview] = useState(false);
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const report = useCallback<Report>((id, bad) => setInvalid((cur) => (!!cur[id] === bad ? cur : { ...cur, [id]: bad })), []);
  const anyInvalid = Object.values(invalid).some(Boolean);
  const [serverError, setServerError] = useState<string | null>(null);
  // A new theme's short name follows its label until it is saved.
  const nameProblem = ro
    ? null
    : !d.label.trim()
      ? "Give the theme a name."
      : d.base
        ? labelProblem(d.label, props.taken)
        : BAD_LABEL.test(d.label)
          ? LABEL_RULE
          : null;
  const labelIssue = nameProblem ?? serverError;

  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    window.scrollTo(0, 0);
    heading.current?.focus();
  }, [d.name]);

  const set = (patch: Partial<ThemeTokens>) => props.setDraft({ ...d, tokens: { ...d.tokens, ...patch } });
  const setDark = (key: ColorKey, hex: string | null) => {
    const dark = { ...d.dark };
    if (hex) dark[key] = hex;
    else delete dark[key];
    props.setDraft({ ...d, dark });
  };
  const derivedDark = useMemo(() => darkColors(d.tokens, {}), [d.tokens]);
  const shownDark = { ...derivedDark, ...d.dark };

  const save = async () => {
    setBusy(true);
    setServerError(await props.onSave({ ...d, label: d.label.trim() }));
    setBusy(false);
  };

  const fontSelect = (key: "fontSans" | "fontDisplay" | "fontBody" | "fontMono", label: string, mono: boolean) => (
    <Row label={label} htmlFor={`tok-${key}`} help={cap(TOKEN_HELP[key])}>
      <select id={`tok-${key}`} className={cn(SELECT, "sm:w-52")} disabled={ro} value={d.tokens[key]} onChange={(e) => set({ [key]: e.target.value })}>
        {props.fonts
          .filter((f) => (mono ? f.kind === "mono" : f.kind !== "mono"))
          .map((f) => (
            <option key={f.id} value={f.id}>
              {f.label}
            </option>
          ))}
      </select>
    </Row>
  );

  const schemeToggle = (
    <div className="flex rounded-md border border-border p-0.5" role="group" aria-label="Preview scheme">
      {(["light", "dark"] as const).map((s) => (
        <button
          key={s}
          type="button"
          aria-pressed={scheme === s}
          onClick={() => setScheme(s)}
          className={cn("flex min-h-9 items-center gap-1.5 rounded px-2.5 text-xs", RING, scheme === s ? "bg-raised text-foreground" : "text-muted-foreground")}
        >
          {s === "light" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />}
          {s === "light" ? "Light" : "Dark"}
        </button>
      ))}
    </div>
  );

  const actions = (className?: string) =>
    ro ? (
      <Button className={cn("flex-1 max-sm:h-10", className)} onClick={props.onDuplicate}>
        <Copy /> Duplicate to edit
      </Button>
    ) : (
      <>
        <Button className={cn("flex-1 max-sm:h-10", className)} disabled={busy || !!nameProblem || anyInvalid} onClick={() => void save()}>
          {busy ? "Saving…" : d.base ? "Create theme" : "Save"}
        </Button>
        <Button variant="outline" className="max-sm:h-10" onClick={props.onClose} disabled={busy}>
          Cancel
        </Button>
      </>
    );

  return (
    <>
      <div className="flex flex-col gap-1">
        <button type="button" onClick={props.onClose} className={cn(TEXT_BUTTON, "flex w-fit items-center gap-2 text-[13px]")}>
          <ArrowLeft className="size-4" /> All themes
        </button>
        <Head
          headingRef={heading}
          title={d.base ? `New theme: ${d.label}` : d.label}
          lede={
            ro
              ? "A built-in theme. Duplicate it to make one you can change."
              : `Referred to as ${d.name}. Set the colours for light pages. Dark ones are worked out from them, and you can set any of those yourself.`
          }
        />
        {anyInvalid ? (
          <p className="m-0 pt-1 text-[13px] text-bad" role="status">
            Some fields need fixing before you can save.
          </p>
        ) : null}
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {ro ? null : (
            <Card>
              <Row
                label="Name"
                htmlFor="theme-label"
                help={
                  <span id="theme-label-note" aria-live="polite" className={labelIssue ? "text-bad" : undefined}>
                    {labelIssue ?? (d.base ? `Pages and agents refer to it as ${d.name}.` : "Shown in Settings and to agents.")}
                  </span>
                }
              >
                <Input
                  id="theme-label"
                  className={cn(FIELD, "sm:w-52")}
                  value={d.label}
                  maxLength={60}
                  aria-invalid={labelIssue ? true : undefined}
                  aria-describedby="theme-label-note"
                  onChange={(e) => {
                    setServerError(null);
                    props.setDraft({ ...d, label: e.target.value, name: d.base ? slugify(e.target.value) || d.name : d.name });
                  }}
                />
              </Row>
            </Card>
          )}

          <Card title="Colours">
            <div className="hidden grid-cols-[minmax(0,1fr)_150px_160px] gap-3 border-b border-hairline px-[18px] py-2 text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase sm:grid">
              <span />
              <span>Light</span>
              <span>Dark</span>
            </div>
            {COLOR_KEYS.map((key) => {
              const name = COLOR_NAMES[key];
              const lower = name.toLowerCase();
              const overridden = d.dark[key] !== undefined;
              const lightChanged = d.tokens[key] !== props.original.tokens[key];
              return (
                <div
                  key={key}
                  className="grid items-start gap-x-3 gap-y-2 border-b border-hairline px-[18px] py-3 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_150px_160px] max-sm:grid-cols-2"
                >
                  <div className="flex min-w-0 flex-col gap-0.5 max-sm:col-span-2 sm:pt-1.5">
                    <Label htmlFor={`tok-${key}`} className="text-sm font-medium">
                      {name}
                    </Label>
                    <span className="text-[12px] text-muted-foreground">{cap(TOKEN_HELP[key])}</span>
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-[11px] text-muted-foreground sm:hidden">Light</span>
                    <ColorField
                      id={`tok-${key}`}
                      label={`Light ${lower}`}
                      value={d.tokens[key]}
                      disabled={ro}
                      report={report}
                      onChange={(hex) => set({ [key]: hex })}
                    />
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    <span className="text-[11px] text-muted-foreground sm:hidden">Dark</span>
                    {overridden ? (
                      <div className="flex flex-col items-start gap-0.5">
                        <ColorField id={`dark-${key}`} label={`Dark ${lower}`} value={shownDark[key]} disabled={ro} report={report} onChange={(hex) => setDark(key, hex)} />
                        {!ro && lightChanged ? <span className="text-[11.5px] text-warn">Dark still uses your own colour.</span> : null}
                        {ro ? null : (
                          <button type="button" className={cn(TEXT_BUTTON, "text-[12px]")} onClick={() => setDark(key, null)} aria-label={`Use automatic dark ${lower}`}>
                            Use automatic
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span aria-hidden className="size-9 shrink-0 rounded-md border border-input max-sm:size-10" style={{ background: shownDark[key] }} />
                        <div className="flex flex-col items-start">
                          <span className="font-mono text-[12px] uppercase">{shownDark[key]}</span>
                          {ro ? (
                            <span className="text-[11.5px] text-muted-foreground">Automatic</span>
                          ) : (
                            <button type="button" className={cn(TEXT_BUTTON, "py-1.5 text-[12px] underline underline-offset-2")} onClick={() => setDark(key, shownDark[key])} aria-label={`Set your own dark ${lower}`}>
                              Set your own
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </Card>

          <Card title="Type">
            {fontSelect("fontDisplay", "Headings", false)}
            {fontSelect("fontBody", "Paragraphs", false)}
            {fontSelect("fontSans", "Interface", false)}
            {fontSelect("fontMono", "Code", true)}
            <Row label="Text size" htmlFor="tok-fontSize" help="Body text, 12 to 22.">
              <NumberField id="tok-fontSize" value={d.tokens.fontSize} min={12} max={22} step={0.5} unit="px" disabled={ro} report={report} onChange={(n) => set({ fontSize: n })} />
            </Row>
            <Row label="Line height" htmlFor="tok-lineHeight" help="1.2 to 2.">
              <NumberField id="tok-lineHeight" value={d.tokens.lineHeight} min={1.2} max={2} step={0.05} disabled={ro} report={report} onChange={(n) => set({ lineHeight: n })} />
            </Row>
          </Card>

          <Card title="Shape">
            <Row label="Corner radius" htmlFor="tok-radius" help="0 for square corners, up to 24.">
              <NumberField id="tok-radius" value={d.tokens.radius} min={0} max={24} step={1} unit="px" disabled={ro} report={report} onChange={(n) => set({ radius: n })} />
            </Row>
            <Row label="Shadows" htmlFor="tok-shadow">
              <select id="tok-shadow" className={cn(SELECT, "sm:w-40")} disabled={ro} value={d.tokens.shadow} onChange={(e) => set({ shadow: e.target.value as ThemeTokens["shadow"] })}>
                {SHADOWS.map((s) => (
                  <option key={s} value={s}>
                    {s === "none" ? "None" : s === "soft" ? "Soft" : "Lifted"}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Spacing" htmlFor="tok-density">
              <select id="tok-density" className={cn(SELECT, "sm:w-40")} disabled={ro} value={d.tokens.density} onChange={(e) => set({ density: e.target.value as ThemeTokens["density"] })}>
                {DENSITIES.map((s) => (
                  <option key={s} value={s}>
                    {s === "compact" ? "Compact" : s === "normal" ? "Normal" : "Airy"}
                  </option>
                ))}
              </select>
            </Row>
            <Row label="Reading width" htmlFor="tok-measure" help="How wide paragraphs run, in characters. 50 to 110.">
              <NumberField id="tok-measure" value={d.tokens.measure} min={50} max={110} step={1} unit="ch" disabled={ro} report={report} onChange={(n) => set({ measure: n })} />
            </Row>
          </Card>
        </div>

        {/* Wide screens: the preview and the buttons stay beside the fields. */}
        <div className="flex min-w-0 flex-col gap-3 max-lg:hidden lg:sticky lg:top-6">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold tracking-[0.06em] text-muted-foreground uppercase">Preview</span>
            <div className="ml-auto">{schemeToggle}</div>
          </div>
          <Preview tokens={d.tokens} dark={d.dark} scheme={scheme} />
          <div className="flex gap-2">{actions()}</div>
        </div>
      </div>

      {/* Narrow screens: a bar that stays at the bottom, with a small live preview that opens into the full one. */}
      <div className="sticky bottom-0 z-10 -mx-4 flex flex-col gap-2 border-t border-hairline bg-background px-4 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgb(0_0_0/0.12)] lg:hidden">
        {showPreview ? (
          <div id="theme-preview-panel" className="flex max-h-[55vh] flex-col gap-2 overflow-y-auto">
            <div className="flex justify-end">{schemeToggle}</div>
            <Preview tokens={d.tokens} dark={d.dark} scheme={scheme} />
          </div>
        ) : null}
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-expanded={showPreview}
            aria-controls="theme-preview-panel"
            aria-label="Preview"
            onClick={() => setShowPreview((v) => !v)}
            className={cn("flex h-10 shrink-0 items-center gap-2 rounded-md border border-border pr-2 pl-1", RING)}
          >
            <MiniPreview tokens={d.tokens} dark={d.dark} scheme={scheme} />
            <span className="text-xs max-[420px]:sr-only">Preview</span>
            <ChevronDown className={cn("size-3.5 transition-transform", showPreview ? "" : "rotate-180")} />
          </button>
          <div className="flex min-w-0 flex-1 gap-2">{actions("min-w-0 px-3")}</div>
        </div>
      </div>
    </>
  );
}

function themeStyle(tokens: ThemeTokens, dark: DarkOverrides, scheme: "light" | "dark") {
  const derived = deriveTheme({ tokens, dark });
  const { "color-scheme": colorScheme, ...colors } = scheme === "dark" ? derived.dark : derived.light;
  return { ...derived.shape, ...colors, colorScheme } as React.CSSProperties;
}

const v = (name: string) => `var(--art-${name})`;

/** A thumbnail of the theme for the phone bar: background, a heading, the accent and the status colours. */
function MiniPreview({ tokens, dark, scheme }: { tokens: ThemeTokens; dark: DarkOverrides; scheme: "light" | "dark" }) {
  const style = useMemo(() => themeStyle(tokens, dark, scheme), [tokens, dark, scheme]);
  return (
    <span aria-hidden style={{ ...style, background: v("bg"), border: `1px solid ${v("border")}` }} className="flex h-8 items-center gap-1.5 rounded px-2">
      <span style={{ color: v("text"), fontFamily: v("font-display"), fontWeight: 650, fontSize: 14 }}>Aa</span>
      <span style={{ background: v("accent"), width: 14, height: 14, borderRadius: v("radius-sm") }} />
      {["good", "warn", "bad"].map((k) => (
        <span key={k} style={{ background: v(k), width: 6, height: 6, borderRadius: 99 }} />
      ))}
    </span>
  );
}

/** A small page in the theme, drawn from the same tokens a real page reads. */
function Preview({ tokens, dark, scheme }: { tokens: ThemeTokens; dark: DarkOverrides; scheme: "light" | "dark" }) {
  const style = useMemo(() => themeStyle(tokens, dark, scheme), [tokens, dark, scheme]);
  const callouts: [string, string, string][] = [
    ["good", "Good", "Backups finished"],
    ["warn", "Warning", "Disk at 81%"],
    ["bad", "Failed", "One host failed"],
    ["info", "Note", "Runs again at 02:00"],
  ];
  return (
    <div
      aria-label={`Preview, ${scheme}`}
      role="img"
      style={{
        ...style,
        background: v("bg"),
        color: v("text"),
        fontFamily: v("font-body"),
        fontSize: v("font-size"),
        lineHeight: v("line-height"),
        padding: v("space-5"),
        borderRadius: 12,
        border: "1px solid var(--border)",
        display: "flex",
        flexDirection: "column",
        gap: v("space-4"),
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: v("space-1") }}>
        <div style={{ fontFamily: v("font-display"), fontSize: "1.45em", fontWeight: 650, lineHeight: 1.15, letterSpacing: "-0.01em" }}>Nightly backups</div>
        <div style={{ fontFamily: v("font-sans"), fontSize: "0.8em", color: v("text-muted") }}>Updated 4 minutes ago by an agent</div>
      </div>
      <p style={{ margin: 0 }}>
        Three of four hosts finished. The photo share stopped at 61% and{" "}
        <span style={{ color: v("link"), textDecoration: "underline", textUnderlineOffset: 2 }}>its log</span> has the details.
      </p>
      <div
        style={{
          background: v("surface"),
          border: `1px solid ${v("border")}`,
          borderRadius: v("radius"),
          boxShadow: v("shadow-md"),
          padding: v("space-4"),
          display: "flex",
          flexDirection: "column",
          gap: v("space-3"),
          fontFamily: v("font-sans"),
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
          <span style={{ fontSize: "0.8em", color: v("text-muted") }}>Backed up</span>
          <span style={{ fontSize: "1.35em", fontWeight: 650, fontFamily: v("font-display") }}>1.76 TB</span>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 56 }}>
          {[70, 45, 90, 60, 35, 50].map((h, i) => (
            <span key={i} style={{ flex: 1, height: `${h}%`, background: v(`chart-${i + 1}`), borderRadius: `${v("radius-sm")} ${v("radius-sm")} 0 0` }} />
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <span style={{ background: v("accent"), color: v("on-accent"), borderRadius: v("radius-sm"), padding: `${v("space-2")} ${v("space-4")}`, fontSize: "0.85em", fontWeight: 600 }}>
            Run again
          </span>
          <span style={{ border: `1px solid ${v("border-strong")}`, borderRadius: v("radius-sm"), padding: `${v("space-2")} ${v("space-4")}`, fontSize: "0.85em" }}>Details</span>
        </div>
      </div>
      <div style={{ display: "grid", gap: v("space-2"), fontFamily: v("font-sans"), fontSize: "0.85em" }}>
        {callouts.map(([k, tag, text]) => (
          <div key={k} style={{ background: v(`${k}-wash`), borderLeft: `3px solid ${v(k)}`, borderRadius: v("radius-sm"), padding: `${v("space-2")} ${v("space-3")}` }}>
            <span style={{ color: v(k), fontWeight: 600 }}>{tag}</span> {text}
          </div>
        ))}
      </div>
      <code
        style={{
          fontFamily: v("font-mono"),
          fontSize: "0.8em",
          background: v("surface-2"),
          border: `1px solid ${v("border")}`,
          borderRadius: v("radius-sm"),
          padding: `${v("space-2")} ${v("space-3")}`,
          overflowX: "auto",
          whiteSpace: "nowrap",
        }}
      >
        restic backup /srv/photos --tag nightly
      </code>
    </div>
  );
}
