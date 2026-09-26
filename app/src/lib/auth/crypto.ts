import { createHash, createHmac, randomBytes, randomInt, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEY_LENGTH = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** A self-describing hash: `scrypt$N$r$p$salt$key`, so the cost can change later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), key.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltText, keyText] = parts;
  const expected = Buffer.from(keyText, "base64url");
  const key = await new Promise<Buffer>((resolve, reject) =>
    scrypt(
      password.normalize("NFKC"),
      Buffer.from(saltText, "base64url"),
      expected.length,
      { N: Number(n), r: Number(r), p: Number(p), maxmem: SCRYPT.maxmem },
      (err, out) => (err ? reject(err) : resolve(out)),
    ),
  );
  return key.length === expected.length && timingSafeEqual(key, expected);
}

/** A random secret for a cookie, a link or a token. 32 bytes unless asked otherwise. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Six digits, for a code someone types from an email. */
export function randomCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Tokens are stored hashed, so a copy of the database does not hand out sessions. */
export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function hmac(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
