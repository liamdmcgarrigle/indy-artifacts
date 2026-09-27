import { bind, withTx } from "../db/index";
import { taskItemsOf } from "../doc/parse";
import { normaliseTaskText, type TaskItem, type TickView } from "../tasks";
import type { ServiceContext } from "./context";
import { NotFoundError, ValidationError } from "./errors";
import { ackEvent, recordEvent } from "./events";
import { requireArtifact, requireVersion } from "./artifacts";
import type { Artifact, Version } from "./types";

/**
 * People ticking task-list items on a page.
 *
 * The source's `- [x]` is what the author wrote; a tick is laid over it and
 * kept by the item's words (lib/tasks.ts), so a new version that keeps the
 * words keeps the tick, and one that changes them no longer shows it. The
 * row stays, so putting the words back brings the tick back. Every tick and
 * untick is also logged, which is what agents read as activity.
 */

type Row = Record<string, unknown>;

export type TickerKind = "owner" | "visitor" | "agent";

/** Who ticked. A visitor's name and email are what they typed; `verified` means the email was confirmed by code. */
export interface Ticker {
  kind: TickerKind;
  name: string;
  email?: string | null;
  verified?: boolean;
  linkId?: string | null;
}

export interface Tick {
  key: string;
  itemText: string;
  checked: boolean;
  byKind: TickerKind;
  byName: string;
  byEmail: string | null;
  verified: boolean;
  linkId: string | null;
  versionNumber: number;
  at: string;
}

/** A task item on a version, with what people did to it. */
export interface TaskState extends TaskItem {
  /** What the page shows: the person's tick when there is one, else the source. */
  done: boolean;
  tick: Tick | null;
}

export interface TickLogEntry extends Tick {
  id: number;
  sentAt: string | null;
}

const now = () => new Date().toISOString();

function toTick(row: Row): Tick {
  return {
    key: String(row.item_key),
    itemText: String(row.item_text),
    checked: Number(row.checked) === 1,
    byKind: String(row.by_kind) as TickerKind,
    byName: String(row.by_name),
    byEmail: (row.by_email as string | null) ?? null,
    verified: Number(row.verified) === 1,
    linkId: (row.link_id as string | null) ?? null,
    versionNumber: Number(row.version_number),
    at: String(row.at ?? row.created_at),
  };
}

// ------------------------------------------------------------------- items

const itemCache = new Map<string, TaskItem[]>();

/** The task items on a version, parsed once per content. */
export function tasksOf(version: Pick<Version, "contentHash" | "source">): TaskItem[] {
  if (!version.source) return [];
  const hit = itemCache.get(version.contentHash);
  if (hit) return hit;
  const items = taskItemsOf(version.source);
  itemCache.set(version.contentHash, items);
  if (itemCache.size > 200) itemCache.delete(itemCache.keys().next().value as string);
  return items;
}

function ticksByKey(ctx: ServiceContext, artifactId: string): Map<string, Tick> {
  const rows = ctx.db.prepare("SELECT * FROM ticks WHERE artifact_id = ?").all(artifactId) as Row[];
  return new Map(rows.map((r) => [String(r.item_key), toTick(r)]));
}

/** Every task item on a version, in page order, with its tick. */
export function taskStates(ctx: ServiceContext, artifact: Artifact, version: Version): TaskState[] {
  if (artifact.kind !== "markdown") return [];
  const items = tasksOf(version);
  if (!items.length) return [];
  const ticks = ticksByKey(ctx, artifact.id);
  return items.map((item) => {
    const tick = ticks.get(item.key) ?? null;
    return { ...item, tick, done: tick ? tick.checked : item.checked };
  });
}

/** What the viewer needs: one entry per item a person ticked or unticked. No emails. */
export function tickViews(ctx: ServiceContext, artifact: Artifact, version: Version): TickView[] {
  return taskStates(ctx, artifact, version)
    .filter((t) => t.tick)
    .map((t) => ({
      key: t.key,
      checked: t.tick!.checked,
      byKind: t.tick!.byKind,
      byName: t.tick!.byName,
      at: t.tick!.at,
      ...(t.tick!.byKind === "visitor" ? { verified: t.tick!.verified } : {}),
    }));
}

// ------------------------------------------------------------------ ticking

export interface TickInput {
  key: string;
  checked: boolean;
  /** The version the person is looking at; the item has to be on it. Defaults to the latest. */
  version?: number;
  by: Ticker;
}

/**
 * Tick or untick one item. The item must be on the version the person sees,
 * so a key made up by hand is refused. Returns the item as it now stands.
 */
export function setTick(ctx: ServiceContext, slug: string, input: TickInput): TaskState {
  const artifact = requireArtifact(ctx, slug);
  if (artifact.kind !== "markdown") throw new ValidationError("only markdown pages have task lists");
  if (typeof input.key !== "string" || !input.key || input.key.length > 600) throw new ValidationError("which item? key is missing");
  if (typeof input.checked !== "boolean") throw new ValidationError("checked must be true or false");
  const version = requireVersion(ctx, artifact, input.version);
  const item = tasksOf(version).find((t) => t.key === input.key);
  if (!item) throw new NotFoundError(`version ${version.number} has no task item like that; reload the page`);

  const existing = ticksByKey(ctx, artifact.id).get(item.key) ?? null;
  const shown = existing ? existing.checked : item.checked;
  // A second tap that changes nothing is not news.
  if (shown === input.checked && existing) return { ...item, tick: existing, done: shown };

  const stamp = now();
  const by = input.by;
  const base = {
    artifact_id: artifact.id,
    item_key: item.key,
    item_text: item.text,
    checked: input.checked ? 1 : 0,
    by_kind: by.kind,
    by_name: by.name,
    by_email: by.email ?? null,
    verified: by.verified ? 1 : 0,
    link_id: by.linkId ?? null,
    version_number: version.number,
  };
  const params = bind({ ...base, at: stamp });
  withTx(ctx.db, () => {
    ctx.db
      .prepare(
        `INSERT INTO ticks (artifact_id, item_key, item_text, checked, by_kind, by_name, by_email, verified, link_id, version_number, at)
         VALUES (:artifact_id, :item_key, :item_text, :checked, :by_kind, :by_name, :by_email, :verified, :link_id, :version_number, :at)
         ON CONFLICT (artifact_id, item_key) DO UPDATE SET item_text = excluded.item_text, checked = excluded.checked,
           by_kind = excluded.by_kind, by_name = excluded.by_name, by_email = excluded.by_email, verified = excluded.verified,
           link_id = excluded.link_id, version_number = excluded.version_number, at = excluded.at`,
      )
      .run(params);
    // An agent's own tick is not news to the agent: it is logged as already
    // sent, and it wakes no artifact_wait. The page still shows it live.
    ctx.db
      .prepare(
        `INSERT INTO tick_log (artifact_id, item_key, item_text, checked, by_kind, by_name, by_email, verified, link_id, version_number, created_at, sent_at)
         VALUES (:artifact_id, :item_key, :item_text, :checked, :by_kind, :by_name, :by_email, :verified, :link_id, :version_number, :created_at, :sent_at)`,
      )
      .run(bind({ ...base, created_at: stamp, sent_at: by.kind === "agent" ? stamp : null }));
    if (by.kind === "agent") return;
    // artifact_wait wakes on this. Orca's forwarder skips it: ticks reach an
    // Orca session with the owner's next send, bundled, not one message each.
    const eventId = recordEvent(ctx, artifact.id, input.checked ? "task.ticked" : "task.unticked", {
      summary: `${who(by)} ${input.checked ? "ticked" : "unticked"} "${item.text}"`,
      tick: tickWire({ ...toTick({ ...params, at: stamp }), key: item.key }),
    });
    ackEvent(ctx, eventId, "batched: goes to Orca with the next send");
  });
  const tick = ticksByKey(ctx, artifact.id).get(item.key)!;
  return { ...item, tick, done: tick.checked };
}

export interface AgentTickInput {
  /** The item's words, or enough of them to pick one item. */
  item?: string;
  /** The item's first source line, as artifact_get lists it. */
  line?: number;
  done: boolean;
}

/**
 * An agent ticking items off as it works. Each item is found on the latest
 * version by line, by its words, or by a part of its words that only one item
 * has; anything that does not pick exactly one item is refused with the list,
 * so the agent can say it again.
 */
export function agentTick(ctx: ServiceContext, slug: string, inputs: AgentTickInput[], name: string): TaskState[] {
  const artifact = requireArtifact(ctx, slug);
  if (artifact.kind !== "markdown") throw new ValidationError("only markdown pages have task lists");
  if (!Array.isArray(inputs) || !inputs.length) throw new ValidationError("items is empty: say which items to tick");
  if (inputs.length > 100) throw new ValidationError("at most 100 items at a time");
  const version = requireVersion(ctx, artifact);
  const items = tasksOf(version);
  if (!items.length) throw new ValidationError(`"${slug}" has no task items; add "- [ ] ..." lines with artifact_update first`);
  const listing = () => items.map((t) => `  line ${t.line}: ${t.text}`).join("\n");
  const picked = inputs.map((input) => {
    if (typeof input?.done !== "boolean") throw new ValidationError("each item needs done: true or false");
    if (input.line !== undefined) {
      const hit = items.find((t) => t.line === Number(input.line));
      if (!hit) throw new NotFoundError(`no task item starts on line ${input.line}. The items are:\n${listing()}`);
      return { item: hit, done: input.done };
    }
    const want = normaliseTaskText(String(input.item ?? ""));
    if (!want) throw new ValidationError("each item needs its words (item) or its line");
    const exact = items.filter((t) => normaliseTaskText(t.text) === want);
    const hits = exact.length ? exact : items.filter((t) => normaliseTaskText(t.text).includes(want));
    if (hits.length !== 1)
      throw new NotFoundError(
        `${hits.length ? `"${input.item}" matches ${hits.length} items; give the line instead` : `no task item matches "${input.item}"`}. The items are:\n${listing()}`,
      );
    return { item: hits[0], done: input.done };
  });
  const by: Ticker = { kind: "agent", name: name.slice(0, 80) || "agent" };
  return picked.map(({ item, done }) => setTick(ctx, slug, { key: item.key, checked: done, version: version.number, by }));
}

// ------------------------------------------------------------------ reading

/** A person, labelled for an agent: a visitor's name is theirs to type, so it says so. */
export function who(by: Pick<Ticker, "kind" | "name" | "verified">): string {
  if (by.kind === "visitor") return `${JSON.stringify(by.name)} (visitor via share link${by.verified ? ", email confirmed" : ", name and email not verified"})`;
  return `${by.name} (${by.kind})`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 27 Sep 10:52 UTC */
export function shortTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} UTC`;
}

/** A tick as agents receive it. */
export function tickWire(t: Tick) {
  return {
    item: t.itemText,
    key: t.key,
    checked: t.checked,
    by: t.byName,
    by_kind: t.byKind,
    // A visitor's name is whatever they typed. Their email stays with the owner.
    ...(t.byKind === "visitor" ? { untrusted: true, email_verified: t.verified, needs_operator_ok: true } : {}),
    version_number: t.versionNumber,
    at: t.at,
  };
}

/**
 * The checklist as an agent should read it: one line per item, what the page
 * shows, and who changed it from the source. Null when the page has none.
 */
export function checklistText(states: TaskState[]): string | null {
  if (!states.length) return null;
  const done = states.filter((s) => s.done).length;
  const lines = states.map((s) => {
    const box = s.done ? "[x]" : "[ ]";
    let note = "";
    if (s.tick)
      note = `  ${s.tick.checked ? "✓ ticked" : "unticked"} by ${who({ kind: s.tick.byKind, name: s.tick.byName, verified: s.tick.verified })}, ${shortTime(s.tick.at)}${s.tick.byKind === "visitor" ? " [needs operator ok]" : ""}`;
    else if (s.checked) note = "  (ticked in the source)";
    return `  ${box} ${s.text}${note}  [line ${s.line}]`;
  });
  const byVisitor = states.some((s) => s.tick?.byKind === "visitor");
  return [
    `Checklist: ${done} of ${states.length} done. People tick these on the page; their ticks are kept apart from the source, so the source's [ ] and [x] are only your defaults.`,
    ...(byVisitor ? ["A tick marked [needs operator ok] was made by a visitor, not the operator: ask the operator before relying on it."] : []),
    ...lines,
  ].join("\n");
}

export function checklistWire(states: TaskState[]) {
  return states.map((s) => ({
    item: s.text,
    line: s.line,
    done: s.done,
    in_source: s.checked,
    ...(s.tick ? { tick: tickWire(s.tick) } : {}),
  }));
}

/** Ticks and unticks since a moment, oldest first. */
export function tickLogSince(ctx: ServiceContext, artifactId: string, since: string): TickLogEntry[] {
  const rows = ctx.db
    .prepare("SELECT * FROM tick_log WHERE artifact_id = ? AND created_at >= ? ORDER BY id ASC")
    .all(artifactId, since) as Row[];
  return rows.map((r) => ({ ...toTick(r), id: Number(r.id), sentAt: (r.sent_at as string | null) ?? null }));
}

/** Ticks not yet sent to the agent, the newest per item. */
export function unsentTicks(ctx: ServiceContext, artifactId: string): TickLogEntry[] {
  const rows = ctx.db.prepare("SELECT * FROM tick_log WHERE artifact_id = ? AND sent_at IS NULL ORDER BY id ASC").all(artifactId) as Row[];
  const latest = new Map<string, TickLogEntry>();
  for (const r of rows) latest.set(String(r.item_key), { ...toTick(r), id: Number(r.id), sentAt: null });
  return [...latest.values()];
}

export function markTicksSent(ctx: ServiceContext, artifactId: string, at: string): void {
  ctx.db.prepare("UPDATE tick_log SET sent_at = ? WHERE artifact_id = ? AND sent_at IS NULL").run(at, artifactId);
}

// ------------------------------------------------------------------ versions

/**
 * What a new version does to people's ticks. An item whose words change or go
 * no longer shows its tick (it comes back if the words do). An item the author
 * flips in the source, to a state other than the person's, takes the author's
 * word: the person's tick is cleared.
 */
export function reconcileTicks(
  ctx: ServiceContext,
  artifact: Artifact,
  previous: Pick<Version, "contentHash" | "source"> | null,
  next: Pick<Version, "contentHash" | "source">,
): { dropped: Tick[] } {
  if (artifact.kind !== "markdown" || !previous) return { dropped: [] };
  const ticks = ticksByKey(ctx, artifact.id);
  if (!ticks.size) return { dropped: [] };
  const before = new Map(tasksOf(previous).map((t) => [t.key, t]));
  const after = new Map(tasksOf(next).map((t) => [t.key, t]));
  const dropped: Tick[] = [];
  for (const [key, tick] of ticks) {
    const was = before.get(key);
    const now = after.get(key);
    if (was && !now && tick.checked) dropped.push(tick);
    if (was && now && was.checked !== now.checked && now.checked !== tick.checked) {
      ctx.db.prepare("DELETE FROM ticks WHERE artifact_id = ? AND item_key = ?").run(artifact.id, key);
    }
  }
  return { dropped };
}
