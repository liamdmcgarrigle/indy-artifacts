"use client";

import { useEffect } from "react";

/**
 * How much of the bottom of the window the on-screen keyboard covers, kept in
 * two properties on the root: --keyboard-inset and --visible-height.
 *
 * Phone browsers open the keyboard over the page without moving anything
 * fixed to the bottom of the window, so a sheet pinned there ends up behind
 * it, its buttons out of reach. The visual viewport is what is still showing;
 * a sheet that sits on its bottom edge stays above the keyboard.
 */
export function useKeyboardInset(on: boolean): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!on || !vv) return;
    const root = document.documentElement;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Zoomed in, the visual viewport is smaller for another reason: no keyboard to clear.
        const zoomed = vv.scale > 1.01;
        const inset = zoomed ? 0 : Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
        root.style.setProperty("--keyboard-inset", `${inset}px`);
        root.style.setProperty("--visible-height", zoomed ? "100vh" : `${Math.round(vv.height)}px`);
      });
    };
    measure();
    vv.addEventListener("resize", measure);
    vv.addEventListener("scroll", measure);
    return () => {
      cancelAnimationFrame(frame);
      vv.removeEventListener("resize", measure);
      vv.removeEventListener("scroll", measure);
      root.style.removeProperty("--keyboard-inset");
      root.style.removeProperty("--visible-height");
    };
  }, [on]);
}
