import type { Warning } from "./types";

/**
 * remark-directive ends a container at the first fence carrying at least as many
 * colons as the opener, so `:::columns` wrapping `:::col` closes on the inner
 * `:::` and everything after it leaks out as text. Agents write three colons at
 * every level, so widen the outer fences here rather than asking them to count:
 * a container gets 3 + its nesting height colons, which leaves every parent
 * strictly wider than its deepest descendant.
 *
 * Only the colon run on a line that already exists is touched. Blocks are
 * stamped with data-lines and comments anchor to those numbers, so this pass
 * must never add, remove or reorder a line.
 */

const OPENER = /^(:{3,})([a-zA-Z][a-zA-Z0-9-]*)(?:\[[^\]]*\])?(?:\{[^}]*\})?\s*$/;
const CLOSER = /^(:{3,})\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

interface OpenContainer {
  line: number;
  colons: number;
  name: string;
  /** Height of the deepest container closed inside this one, 0 when it has none. */
  height: number;
}

interface Pair {
  openLine: number;
  openColons: number;
  closeLine: number;
  closeColons: number;
  height: number;
}

function widen(line: string, oldColons: number, colons: number): string {
  return ":".repeat(colons) + line.slice(oldColons);
}

export function normalizeContainers(source: string): { source: string; warnings: Warning[] } {
  const lines = source.split("\n");
  const warnings: Warning[] = [];
  const stack: OpenContainer[] = [];
  const pairs: Pair[] = [];
  let fence: { marker: string; length: number } | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fenced = FENCE.exec(line);

    if (fence) {
      // A closing fence is the same character, at least as long, nothing after it.
      if (fenced && fenced[1][0] === fence.marker && fenced[1].length >= fence.length && fenced[2].trim() === "") {
        fence = null;
      }
      continue;
    }
    // Artifacts legitimately show `:::` examples in code, so a fence body is opaque.
    // A backtick fence cannot carry a backtick in its info string (CommonMark).
    if (fenced && !(fenced[1][0] === "`" && fenced[2].includes("`"))) {
      fence = { marker: fenced[1][0], length: fenced[1].length };
      continue;
    }

    const opener = OPENER.exec(line);
    if (opener) {
      stack.push({ line: i, colons: opener[1].length, name: opener[2], height: 0 });
      continue;
    }

    const closer = CLOSER.exec(line);
    // A closer with nothing open is stray text; leave it as the author wrote it.
    if (closer && stack.length) {
      const open = stack.pop() as OpenContainer;
      pairs.push({
        openLine: open.line,
        openColons: open.colons,
        closeLine: i,
        closeColons: closer[1].length,
        height: open.height,
      });
      const parent = stack[stack.length - 1];
      if (parent) parent.height = Math.max(parent.height, open.height + 1);
    }
  }

  // An unclosed container is reported, not rewritten: guessing where it ends
  // would move content the author never put there.
  for (const open of stack) {
    warnings.push({
      line: open.line + 1,
      message: `container ":::${open.name}" opened on line ${open.line + 1} is never closed`,
    });
  }
  warnings.sort((a, b) => a.line - b.line);

  for (const pair of pairs) {
    const colons = 3 + pair.height;
    lines[pair.openLine] = widen(lines[pair.openLine], pair.openColons, colons);
    lines[pair.closeLine] = widen(lines[pair.closeLine], pair.closeColons, colons);
  }

  return { source: lines.join("\n"), warnings };
}
