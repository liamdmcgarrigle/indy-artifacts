"use client";

import { useEffect } from "react";

const QUESTION = "Leave without saving? Your changes will be lost.";

/**
 * Asks before unsaved work is thrown away: on reload or close (beforeunload),
 * and on Back, which in the App Router is a client navigation that never
 * fires beforeunload. For Back, a copy of the current history entry is pushed
 * while there are changes; popping it asks, and either steps back for real or
 * puts the guard entry back.
 */
export function useLeaveGuard(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const onUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onUnload);

    const guard = () => window.history.pushState({ ...(window.history.state ?? {}), __indyGuard: true }, "", window.location.href);
    guard();
    const onPop = (event: PopStateEvent) => {
      if (event.state?.__indyGuard) return;
      // Capture on window runs before the router's own listener, which must
      // not see this pop unless the answer is to leave.
      event.stopImmediatePropagation();
      if (window.confirm(QUESTION)) {
        window.removeEventListener("popstate", onPop, true);
        window.history.back();
      } else {
        guard();
      }
    };
    window.addEventListener("popstate", onPop, true);
    return () => {
      window.removeEventListener("beforeunload", onUnload);
      window.removeEventListener("popstate", onPop, true);
      // Saved or cancelled: the extra entry stays (Back through it is a no-op
      // on the same page) but stops asking. Stepping back here instead would
      // race a remount's fresh guard entry.
      const state = window.history.state;
      if (state?.__indyGuard) window.history.replaceState({ ...state, __indyGuard: false }, "", window.location.href);
    };
  }, [active]);
}

/** For links out of an editor: true to go ahead. */
export function confirmLeave(dirty: boolean): boolean {
  return !dirty || window.confirm(QUESTION);
}
