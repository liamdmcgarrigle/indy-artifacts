"use client";

import { useCallback, useSyncExternalStore } from "react";

export type Scheme = "dark" | "light";

const EVENT = "indy:scheme";

function read(): Scheme {
  return document.documentElement.dataset.scheme === "light" ? "light" : "dark";
}

function subscribe(onChange: () => void) {
  window.addEventListener(EVENT, onChange);
  return () => window.removeEventListener(EVENT, onChange);
}

/** The page's colour scheme, kept on <html data-scheme> and remembered per browser. */
export function useScheme() {
  const scheme = useSyncExternalStore(subscribe, read, () => "dark" as Scheme);
  const set = useCallback((next: Scheme) => {
    document.documentElement.dataset.scheme = next;
    try {
      localStorage.setItem("indy-scheme", next);
    } catch {
      /* private window: the choice lasts this page */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  const toggle = useCallback(() => set(read() === "dark" ? "light" : "dark"), [set]);
  return { scheme, set, toggle };
}
