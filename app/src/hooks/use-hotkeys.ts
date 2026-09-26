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
      if (event.defaultPrevented) return;
      event.preventDefault();
      handler(event);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled]);
}
