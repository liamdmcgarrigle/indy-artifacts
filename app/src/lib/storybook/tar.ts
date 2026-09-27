import { createGunzip } from "node:zlib";
import type { Readable } from "node:stream";

/**
 * Reads a gzipped tar stream, as `tar -czf - -C storybook-static .` writes it,
 * one file at a time. Nothing touches the disk here and no path from the
 * archive is ever used as one: each file is handed on by its name, which is
 * checked, and the caller stores it by content hash.
 *
 * Only regular files are kept. Links, devices and folders are skipped, and a
 * name that climbs out of the archive or is absolute fails the whole upload.
 */

export interface TarLimits {
  /** Bytes after decompression, across every file. */
  totalBytes: number;
  fileBytes: number;
  files: number;
}

export class TarError extends Error {}

const BLOCK = 512;

function text(buf: Buffer, start: number, length: number): string {
  const slice = buf.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end < 0 ? slice.length : end).toString("utf8");
}

function octal(buf: Buffer, start: number, length: number): number {
  if (buf[start] & 0x80) throw new TarError("a file in the archive is too large");
  const value = text(buf, start, length).trim();
  if (!value) return 0;
  if (!/^[0-7]+$/.test(value)) throw new TarError("the archive is damaged (a size is not a number)");
  return parseInt(value, 8);
}

function checksumOk(header: Buffer): boolean {
  let stored: number;
  try {
    stored = octal(header, 148, 8);
  } catch {
    return false;
  }
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
  return sum === stored;
}

/** The records of a pax header: "len key=value\n" repeated. */
function paxPath(data: Buffer): string | null {
  let at = 0;
  let path: string | null = null;
  while (at < data.length) {
    const space = data.indexOf(32, at);
    if (space < 0) break;
    const len = Number(data.subarray(at, space).toString("ascii"));
    if (!Number.isInteger(len) || len <= 0 || at + len > data.length) break;
    const record = data.subarray(space + 1, at + len - 1).toString("utf8");
    const eq = record.indexOf("=");
    if (eq > 0 && record.slice(0, eq) === "path") path = record.slice(eq + 1);
    at += len;
  }
  return path;
}

/**
 * A name from the archive, made relative to its root: "./iframe.html" and
 * "iframe.html" are the same file. Returns null for the root itself.
 */
export function cleanPath(raw: string): string | null {
  if (raw.includes("\0") || raw.includes("\\")) throw new TarError(`the archive has a file name Indy will not store: ${JSON.stringify(raw)}`);
  if (raw.startsWith("/")) throw new TarError(`the archive has an absolute path: ${raw}`);
  const parts = raw.split("/").filter((p) => p !== "" && p !== ".");
  if (parts.some((p) => p === "..")) throw new TarError(`the archive has a path that leaves it: ${raw}`);
  if (!parts.length) return null;
  const path = parts.join("/");
  if (path.length > 400) throw new TarError(`a path in the archive is too long: ${path.slice(0, 80)}…`);
  return path;
}

/** Hidden files, and the ._ copies macOS tar adds for extended attributes. */
function ignored(path: string): boolean {
  return path.split("/").some((p) => p.startsWith("._") || p === ".DS_Store");
}

export interface TarFile {
  path: string;
  data: Buffer;
}

/**
 * Calls `onFile` for each regular file, in order, and resolves when the
 * archive has ended. `onFile` may be async; the stream waits for it.
 */
export async function readTarGz(source: Readable | AsyncIterable<Uint8Array>, limits: TarLimits, onFile: (file: TarFile) => Promise<void>): Promise<{ skipped: string[] }> {
  const gunzip = createGunzip();
  const input = source as AsyncIterable<Uint8Array>;
  const pump = (async () => {
    try {
      for await (const chunk of input) {
        if (!gunzip.write(chunk)) await new Promise((r) => gunzip.once("drain", r));
      }
      gunzip.end();
    } catch (err) {
      gunzip.destroy(err as Error);
    }
  })();

  let total = 0;
  let count = 0;
  let longName: string | null = null;
  let paxName: string | null = null;
  let ended = false;
  const skipped: string[] = [];
  let skippedCount = 0;

  // A byte-at-a-time reader over the stream, without joining chunks: a header
  // is gathered into its own 512 bytes, an entry's data into a list of pieces
  // joined once, and data that is not kept is only counted past.
  const headerBuf = Buffer.alloc(BLOCK);
  let headerFill = 0;
  interface Entry {
    header: Buffer;
    type: string;
    size: number;
    keep: boolean;
    parts: Buffer[];
    left: number;
    pad: number;
  }
  let entry: Entry | null = null;
  // TypeScript does not see the helpers below assign `entry`; read it through this.
  const currentEntry = (): Entry | null => entry;

  const startEntry = (header: Buffer) => {
    const size = octal(header, 124, 12);
    const type = String.fromCharCode(header[156] || 48);
    const regular = type === "0" || type === "7";
    const meta = type === "x" || type === "L" || type === "g";
    if (regular && size > limits.fileBytes) throw new TarError(`a file is over ${Math.round(limits.fileBytes / 1024 / 1024)} MB`);
    if (meta && size > 64 * 1024) throw new TarError("the archive has an oversized header");
    // Links, folders and devices carry no data; one that claims to is not a
    // build a tool wrote.
    if (!regular && !meta && size > 0) throw new TarError(`the archive has a "${type}" entry with data in it, which Indy does not accept`);
    entry = { header, type, size, keep: regular || type === "x" || type === "L", parts: [], left: size, pad: Math.ceil(size / BLOCK) * BLOCK - size };
  };

  const finishEntry = async () => {
    const current = entry!;
    entry = null;
    const data = current.parts.length === 1 ? current.parts[0] : Buffer.concat(current.parts);
    const { type, header } = current;
    if (type === "L") {
      longName = text(data, 0, data.length);
      return;
    }
    if (type === "x") {
      paxName = paxPath(data);
      return;
    }
    if (type === "g") return;

    const prefix = text(header, 257, 6).startsWith("ustar") ? text(header, 345, 155) : "";
    const name = longName ?? paxName ?? (prefix ? `${prefix}/${text(header, 0, 100)}` : text(header, 0, 100));
    longName = null;
    paxName = null;

    const path = cleanPath(name);
    if (path === null || type === "5") return;
    if (type !== "0" && type !== "7") {
      if (skippedCount++ < 20) skipped.push(path);
      return;
    }
    if (ignored(path)) return;
    if (++count > limits.files) throw new TarError(`the Storybook has more than ${limits.files} files`);
    await onFile({ path, data });
  };

  try {
    for await (const chunk of gunzip as AsyncIterable<Buffer>) {
      total += chunk.length;
      if (total > limits.totalBytes) throw new TarError(`the Storybook is over ${Math.round(limits.totalBytes / 1024 / 1024)} MB unpacked`);
      let at = 0;
      while (at < chunk.length && !ended) {
        const current = currentEntry();
        if (!current) {
          const take = Math.min(BLOCK - headerFill, chunk.length - at);
          chunk.copy(headerBuf, headerFill, at, at + take);
          headerFill += take;
          at += take;
          if (headerFill < BLOCK) break;
          headerFill = 0;
          if (headerBuf.every((b) => b === 0)) {
            ended = true;
            break;
          }
          if (!checksumOk(headerBuf)) throw new TarError("that is not a tar archive (or it is damaged); send `tar -czf - -C <build folder> .`");
          startEntry(Buffer.from(headerBuf));
          const started = currentEntry()!;
          if (started.left === 0 && started.pad === 0) await finishEntry();
          continue;
        }
        if (current.left > 0) {
          const take = Math.min(current.left, chunk.length - at);
          if (current.keep) current.parts.push(Buffer.from(chunk.subarray(at, at + take)));
          current.left -= take;
          at += take;
          if (current.left > 0) break;
        }
        if (current.pad > 0) {
          const take = Math.min(current.pad, chunk.length - at);
          current.pad -= take;
          at += take;
          if (current.pad > 0) break;
        }
        await finishEntry();
      }
      if (ended) break;
    }
  } finally {
    gunzip.destroy();
    await pump.catch(() => {});
  }
  if (!ended && (currentEntry() || headerFill)) throw new TarError("the archive ended part way through a file");
  if (skippedCount > skipped.length) skipped.push(`and ${skippedCount - skipped.length} more`);
  return { skipped };
}
