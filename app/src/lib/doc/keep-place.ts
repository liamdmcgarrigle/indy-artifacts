import type { EditorView } from "@tiptap/pm/view";

/**
 * Where the reader is on a page, held across the switch between reading and
 * editing. The two are different editors with different node views (dropdowns
 * open, every tab shows), so the page above the reader changes height and a
 * plain scroll offset lands somewhere else. A place is a position in the
 * document instead, with how far each block around it sat from the reading
 * line, so the same block can be put back on the same line.
 */
export type Place = {
  pos: number;
  /** Per depth, the block's top less the reading line; the last is the text itself, or the block after a gap. */
  offsets: (number | null)[];
};

/** The reading line, as a share of the window's height. */
const LINE = 0.3;
/** How long the page is held in place once the new editor is on show. */
const HOLD_MS = 1500;
/** The longest the new editor may take to arrive; the editing code can be slow to fetch. */
const WAIT_MS = 15_000;

const line = () => window.innerHeight * LINE;

/** A block the reader cannot see: folded into a closed dropdown, or in a hidden tab. */
function hidden(el: Element): boolean {
  if (el.getClientRects().length === 0) return true;
  // A closed dropdown shows its own summary, so only one around it hides it.
  const closed = el.parentElement?.closest("details:not([open])") ?? null;
  return closed !== null && !el.closest("summary");
}

/** The top of each block around pos, outermost first, then the text; null where it is not shown. */
function tops(view: EditorView, pos: number): (number | null)[] {
  const $pos = view.state.doc.resolve(Math.min(pos, view.state.doc.content.size));
  const out: (number | null)[] = [];
  for (let d = 1; d <= $pos.depth; d++) {
    const dom = view.nodeDOM($pos.before(d));
    out.push(dom instanceof Element && !hidden(dom) ? dom.getBoundingClientRect().top : null);
  }
  const shown = out.length === 0 || out[out.length - 1] !== null;
  let text: number | null = null;
  if (shown && $pos.parent.isTextblock) {
    try {
      text = view.coordsAtPos($pos.pos).top;
    } catch {
      // A position the view cannot draw: the blocks above will do.
    }
  } else if (shown) {
    // Between blocks (a gap, a tab bar): the block that follows is the place.
    const next = $pos.nodeAfter ? view.nodeDOM($pos.pos) : null;
    text = next instanceof Element && !hidden(next) ? next.getBoundingClientRect().top : null;
  }
  out.push(text);
  return out;
}

export function capturePlace(view: EditorView): Place | null {
  // At the top of the page, the top of the page is the place.
  if (window.scrollY < 4) return null;
  const rect = view.dom.getBoundingClientRect();
  if (rect.height === 0) return null;
  const y = Math.min(Math.max(line(), rect.top + 1), rect.bottom - 1);
  const hit = view.posAtCoords({ left: rect.left + Math.min(40, rect.width / 2), top: y });
  if (!hit) return null;
  const at = line();
  return { pos: hit.pos, offsets: tops(view, hit.pos).map((t) => (t === null ? null : t - at)) };
}

/** Scroll so the deepest block shown both then and now is back where it was. */
export function restorePlace(view: EditorView, place: Place) {
  if (view.isDestroyed) return;
  let now: (number | null)[];
  try {
    now = tops(view, place.pos);
  } catch {
    return;
  }
  const at = line();
  // The text counts only when the blocks around it are the same depth as before.
  const depth = Math.min(now.length, place.offsets.length);
  for (let d = depth - 1; d >= 0; d--) {
    const was = place.offsets[d];
    const top = now[d];
    if (was === null || top === null) continue;
    if (d === depth - 1 && now.length !== place.offsets.length) continue;
    const delta = top - at - was;
    if (Math.abs(delta) >= 1) window.scrollTo({ top: window.scrollY + delta, behavior: "instant" });
    return;
  }
}

/**
 * Keep the reader at a place while the page settles: now, on demand, and
 * whenever the page changes height, until the reader scrolls for themselves
 * or the hold runs out. The hold runs out a moment after settle(), called
 * once the new editor is on show; until then it waits for it.
 */
export function keepPlace(place: Place, view: () => EditorView | null): { apply: () => void; settle: () => void; stop: () => void } {
  let live = true;
  const apply = () => {
    const v = view();
    if (live && v) restorePlace(v, place);
  };
  const observer = new ResizeObserver(apply);
  observer.observe(document.body);
  const taken = ["wheel", "touchstart", "keydown", "pointerdown"];
  const stop = () => {
    if (!live) return;
    live = false;
    observer.disconnect();
    clearTimeout(timer);
    for (const type of taken) window.removeEventListener(type, stop, true);
  };
  let timer = setTimeout(stop, WAIT_MS);
  const settle = () => {
    if (!live) return;
    apply();
    clearTimeout(timer);
    timer = setTimeout(stop, HOLD_MS);
  };
  for (const type of taken) window.addEventListener(type, stop, { capture: true, passive: true });
  apply();
  return { apply, settle, stop };
}
