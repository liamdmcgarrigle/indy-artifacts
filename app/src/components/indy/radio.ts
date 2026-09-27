import type { KeyboardEvent } from "react";

/**
 * Arrow keys for a custom radiogroup, the way native radios behave: the
 * arrows (and Home and End) move to the next enabled option and choose it.
 * Put it on the group; give the chosen option tabIndex 0 and the rest -1
 * (see radioTab), so Tab enters the group once.
 */
export function onRadioKeys(event: KeyboardEvent<HTMLElement>) {
  const steps: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  const step = steps[event.key];
  if (!step && event.key !== "Home" && event.key !== "End") return;
  const radios = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled]):not([aria-disabled="true"])')];
  if (!radios.length) return;
  event.preventDefault();
  const at = radios.indexOf(document.activeElement as HTMLElement);
  const next = event.key === "Home" ? 0 : event.key === "End" ? radios.length - 1 : (Math.max(at, 0) + step + radios.length) % radios.length;
  radios[next].focus();
  radios[next].click();
}

/** tabIndex for option `index`: the chosen one, or the first when none is. */
export function radioTab(checked: boolean, index: number, anyChecked: boolean): 0 | -1 {
  return checked || (!anyChecked && index === 0) ? 0 : -1;
}
