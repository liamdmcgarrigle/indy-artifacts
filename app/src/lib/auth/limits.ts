import { ServiceError } from "../service/errors";

/**
 * Attempts counted in memory, per key, over a fixed window. Indy is one
 * process with one owner, so this is enough to stop password guessing, code
 * guessing and email bombing without a store; a restart forgets the counts.
 */

const buckets = new Map<string, { count: number; resetAt: number }>();
let swept = Date.now();

export class TooManyError extends ServiceError {
  constructor(minutes: number) {
    super("rate_limited", `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`, 429);
  }
}

function sweep(now: number) {
  if (now - swept < 60_000) return;
  swept = now;
  for (const [key, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(key);
}

/** Counts one attempt against `key`; throws once more than `max` land within `windowMs`. */
export function limit(key: string, max: number, windowMs: number): void {
  const now = Date.now();
  sweep(now);
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }
  bucket.count++;
  if (bucket.count > max) throw new TooManyError(Math.max(1, Math.ceil((bucket.resetAt - now) / 60_000)));
}

/** Forget a key, e.g. after a correct password. */
export function clearLimit(key: string): void {
  buckets.delete(key);
}

/**
 * The address a request came from. Indy's own proxy appends the peer it saw
 * as the last x-forwarded-for entry, which a client cannot forge; entries
 * before it can be. Behind another proxy this is that proxy's address, which
 * makes the limit shared, not absent.
 */
export function clientAddress(headers: Headers): string {
  const chain = headers.get("x-forwarded-for");
  const last = chain?.split(",").pop()?.trim();
  return last || "direct";
}

export function resetLimitsForTesting(): void {
  buckets.clear();
}
