import { customAlphabet } from "nanoid";
import { bind } from "../db/index";
import type { ServiceContext } from "../service/context";
import { ValidationError } from "../service/errors";
import { hashPassword, hmac, randomCode, randomToken, safeEqual, sha256, verifyPassword } from "./crypto";

/**
 * The owner's account, their sessions, the codes emailed to them or to a
 * visitor, and the tokens agents connect with.
 *
 * There is one owner. The users table can hold more rows, but nothing creates
 * a second one: setup refuses once an owner exists.
 */

const id12 = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);
const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const later = (ms: number) => iso(new Date(Date.now() + ms));

const DAY = 24 * 60 * 60 * 1000;
export const SESSION_DAYS = 30;
const CODE_MINUTES = 10;
const CODE_ATTEMPTS = 5;

type Row = Record<string, unknown>;

export interface User {
  id: string;
  email: string;
  name: string;
  twoStep: boolean;
  createdAt: string;
}

function toUser(row: Row): User {
  return {
    id: String(row.id),
    email: String(row.email),
    name: String(row.name),
    twoStep: Number(row.two_step) === 1,
    createdAt: String(row.created_at),
  };
}

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
}

export function owner(ctx: ServiceContext): User | null {
  const row = ctx.db.prepare("SELECT * FROM users ORDER BY created_at LIMIT 1").get() as Row | undefined;
  return row ? toUser(row) : null;
}

export function userById(ctx: ServiceContext, id: string): User | null {
  const row = ctx.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as Row | undefined;
  return row ? toUser(row) : null;
}

export async function createOwner(
  ctx: ServiceContext,
  input: { email: string; password: string; name?: string },
): Promise<User> {
  if (owner(ctx)) throw new ValidationError("this install already has an owner");
  const email = normaliseEmail(input.email);
  if (!validEmail(email)) throw new ValidationError("that email address does not look right");
  if (input.password.length < 10) throw new ValidationError("use a password of at least 10 characters");
  const id = id12();
  ctx.db
    .prepare(
      "INSERT INTO users (id, email, name, password_hash, two_step, created_at) VALUES (:id, :email, :name, :hash, 0, :at)",
    )
    .run(
      bind({
        id,
        email,
        name: input.name?.trim() || email.split("@")[0],
        hash: await hashPassword(input.password),
        at: iso(now()),
      }),
    );
  return userById(ctx, id)!;
}

/** The user if the email and password match, otherwise null. Same cost either way. */
export async function checkPassword(ctx: ServiceContext, email: string, password: string): Promise<User | null> {
  const row = ctx.db.prepare("SELECT * FROM users WHERE email = ?").get(normaliseEmail(email)) as Row | undefined;
  // Hash against a throwaway when there is no such user, so timing does not say which.
  const stored = row ? String(row.password_hash) : "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAA";
  const ok = await verifyPassword(password, stored);
  return ok && row ? toUser(row) : null;
}

export async function changePassword(ctx: ServiceContext, userId: string, current: string, next: string) {
  const user = userById(ctx, userId);
  if (!user || !(await checkPassword(ctx, user.email, current))) throw new ValidationError("current password is wrong");
  if (next.length < 10) throw new ValidationError("use a password of at least 10 characters");
  ctx.db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(await hashPassword(next), userId);
}

export function setTwoStep(ctx: ServiceContext, userId: string, on: boolean): void {
  ctx.db.prepare("UPDATE users SET two_step = ? WHERE id = ?").run(on ? 1 : 0, userId);
}

export function updateProfile(ctx: ServiceContext, userId: string, input: { name?: string; email?: string }) {
  if (input.email !== undefined) {
    const email = normaliseEmail(input.email);
    if (!validEmail(email)) throw new ValidationError("that email address does not look right");
    ctx.db.prepare("UPDATE users SET email = ? WHERE id = ?").run(email, userId);
  }
  if (input.name !== undefined && input.name.trim()) {
    ctx.db.prepare("UPDATE users SET name = ? WHERE id = ?").run(input.name.trim().slice(0, 80), userId);
  }
}

// ---------------------------------------------------------------- sessions

export function createSession(ctx: ServiceContext, userId: string): { token: string; expiresAt: string } {
  const token = randomToken();
  const expiresAt = later(SESSION_DAYS * DAY);
  const at = iso(now());
  ctx.db
    .prepare(
      "INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(sha256(token), userId, at, expiresAt, at);
  return { token, expiresAt };
}

export function sessionUser(ctx: ServiceContext, token: string | undefined | null): User | null {
  if (!token) return null;
  const row = ctx.db
    .prepare(
      `SELECT u.*, s.expires_at AS session_expires, s.last_seen_at AS session_seen
         FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
    )
    .get(sha256(token)) as Row | undefined;
  if (!row) return null;
  if (String(row.session_expires) < iso(now())) {
    endSession(ctx, token);
    return null;
  }
  // Touch at most once an hour, so reads do not turn into writes.
  if (Date.now() - Date.parse(String(row.session_seen)) > 60 * 60 * 1000) {
    ctx.db.prepare("UPDATE sessions SET last_seen_at = ? WHERE id_hash = ?").run(iso(now()), sha256(token));
  }
  return toUser(row);
}

export function endSession(ctx: ServiceContext, token: string): void {
  ctx.db.prepare("DELETE FROM sessions WHERE id_hash = ?").run(sha256(token));
}

export function endAllSessions(ctx: ServiceContext, userId: string): void {
  ctx.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

// ---------------------------------------------------------------- codes

/**
 * Issue a six-digit code for a purpose and a subject (a user id, or a share
 * link id), replacing any earlier one. Returns the id the second request
 * refers to, and the code to send.
 */
export function issueCode(
  ctx: ServiceContext,
  purpose: "sign_in" | "visitor",
  subject: string,
  email: string,
): { id: string; code: string } {
  const code = randomCode();
  const id = randomToken(18);
  ctx.db.prepare("DELETE FROM email_codes WHERE purpose = ? AND subject = ? AND email = ?").run(purpose, subject, email);
  ctx.db
    .prepare(
      `INSERT INTO email_codes (id, purpose, subject, email, code_hash, attempts, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .run(id, purpose, subject, email, sha256(`${id}:${code}`), later(CODE_MINUTES * 60 * 1000), iso(now()));
  return { id, code };
}

/** Check a code. Five wrong tries or ten minutes and it is gone. */
export function redeemCode(
  ctx: ServiceContext,
  id: string,
  code: string,
): { purpose: string; subject: string; email: string } | null {
  const row = ctx.db.prepare("SELECT * FROM email_codes WHERE id = ?").get(id) as Row | undefined;
  if (!row) return null;
  if (String(row.expires_at) < iso(now()) || Number(row.attempts) >= CODE_ATTEMPTS) {
    ctx.db.prepare("DELETE FROM email_codes WHERE id = ?").run(id);
    return null;
  }
  const clean = code.replace(/\D/g, "");
  if (!safeEqual(sha256(`${id}:${clean}`), String(row.code_hash))) {
    ctx.db.prepare("UPDATE email_codes SET attempts = attempts + 1 WHERE id = ?").run(id);
    return null;
  }
  ctx.db.prepare("DELETE FROM email_codes WHERE id = ?").run(id);
  return { purpose: String(row.purpose), subject: String(row.subject), email: String(row.email) };
}

// ---------------------------------------------------------------- api tokens

export interface ApiToken {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export const TOKEN_PREFIX = "indy_tk_";

export function createApiToken(ctx: ServiceContext, name: string): { token: string; record: ApiToken } {
  const clean = name.trim().slice(0, 60);
  if (!clean) throw new ValidationError("give the token a name, such as the machine and agent it is for");
  const token = TOKEN_PREFIX + randomToken(24);
  const id = id12();
  const prefix = token.slice(0, TOKEN_PREFIX.length + 4);
  ctx.db
    .prepare("INSERT INTO api_tokens (id, name, prefix, hash, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(id, clean, prefix, sha256(token), iso(now()));
  return { token, record: { id, name: clean, prefix, createdAt: iso(now()), lastUsedAt: null } };
}

export function listApiTokens(ctx: ServiceContext): ApiToken[] {
  const rows = ctx.db
    .prepare("SELECT * FROM api_tokens WHERE revoked_at IS NULL ORDER BY created_at DESC")
    .all() as Row[];
  return rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    prefix: String(r.prefix),
    createdAt: String(r.created_at),
    lastUsedAt: (r.last_used_at as string | null) ?? null,
  }));
}

export function revokeApiToken(ctx: ServiceContext, id: string): void {
  ctx.db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE id = ?").run(iso(now()), id);
}

/** The token's name if it is live, touching its last-used time. */
export function checkApiToken(ctx: ServiceContext, token: string): { id: string; name: string } | null {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const row = ctx.db
    .prepare("SELECT id, name, last_used_at FROM api_tokens WHERE hash = ? AND revoked_at IS NULL")
    .get(sha256(token)) as Row | undefined;
  if (!row) return null;
  if (!row.last_used_at || Date.now() - Date.parse(String(row.last_used_at)) > 60 * 1000) {
    ctx.db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(iso(now()), String(row.id));
  }
  return { id: String(row.id), name: String(row.name) };
}

// ---------------------------------------------------------------- signing

/**
 * The install's signing secret, made on first use and kept in the database,
 * so there is nothing to configure and a restored backup keeps its links.
 */
export function secret(ctx: ServiceContext): string {
  const row = ctx.db.prepare("SELECT value FROM settings WHERE key = 'secret'").get() as Row | undefined;
  if (row) return String(row.value);
  const value = randomToken(32);
  ctx.db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES ('secret', ?)").run(value);
  return String((ctx.db.prepare("SELECT value FROM settings WHERE key = 'secret'").get() as Row).value);
}

/**
 * A capability for one version of one artifact, carried as the first path
 * segment of its asset, bundle and frame URLs.
 *
 * A sandboxed frame has an opaque origin, so its requests arrive with no
 * cookie, and a share-link visitor has no session at all. The page that hands
 * out the URL has already checked access; the capability lets everything that
 * page loads follow. It sits in the path rather than the query so a bundle's
 * relative imports inherit it.
 */
export const CAPABILITY_TTL_MS = 7 * DAY;

export function capability(ctx: ServiceContext, slug: string, version: number, ttlMs = CAPABILITY_TTL_MS): string {
  const exp = Math.floor((Date.now() + ttlMs) / 1000);
  return `${exp}.${hmac(secret(ctx), `${slug}/${version}|${exp}`)}`;
}

export function checkCapability(ctx: ServiceContext, cap: string, slug: string, version: number): boolean {
  const dot = cap.indexOf(".");
  if (dot < 0) return false;
  const exp = Number(cap.slice(0, dot));
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  return safeEqual(hmac(secret(ctx), `${slug}/${version}|${exp}`), cap.slice(dot + 1));
}
