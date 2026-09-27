"use client";

import { useEffect, useRef } from "react";

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>;

/** True while typing somewhere, when single-letter shortcuts must stay out of the way. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Inside a dialog or an open menu, the page's own shortcuts step aside. */
function inLayer(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el?.closest?.('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'));
}

/** Enter and space belong to a focused link or button: that is how they are pressed. */
function activates(target: EventTarget | null, key: string): boolean {
  if (key !== "enter" && key !== " ") return false;
  const el = target as HTMLElement | null;
  return Boolean(el?.closest?.('a[href], button, summary, [role="button"], [role="menuitem"], [role="option"], [role="radio"], [role="tab"]'));
}

/**
 * Keys like "j", "shift+d", "mod+k" (⌘ on a Mac, Ctrl elsewhere), "?" and
 * "escape". Letter shortcuts are ignored while typing; "mod+" ones are not.
 */
export function useHotkeys(map: HotkeyMap, enabled = true) {
  const ref = useRef(map);
  ref.current = map;

  useEffect(() => {
    if (!enabled) return;
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const parts = [mod ? "mod" : "", event.shiftKey ? "shift" : "", event.altKey ? "alt" : "", key].filter(Boolean);
      // "?" is shift+/ on most layouts; match it by the character it types.
      const handler = event.key === "?" ? ref.current["?"] : ref.current[parts.join("+")];
      if (!handler) return;
      if (!mod && isTyping(event.target)) return;
      if (!mod && inLayer(event.target) && key !== "escape") return;
      if (activates(event.target, key)) return;
      if (event.defaultPrevented) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
