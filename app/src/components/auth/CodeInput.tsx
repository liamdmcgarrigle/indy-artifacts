"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Six boxes for a six-digit code. Pasting the whole code fills them all. */
export function CodeInput({ onComplete, disabled }: { onComplete: (code: string) => void; disabled?: boolean }) {
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function set(next: string[]) {
    setDigits(next);
    if (next.every((d) => d !== "")) onComplete(next.join(""));
  }

  function type(i: number, value: string) {
    const clean = value.replace(/\D/g, "");
    if (!clean) {
      const next = [...digits];
      next[i] = "";
      setDigits(next);
      return;
    }
    const next = [...digits];
    for (let k = 0; k < clean.length && i + k < 6; k++) next[i + k] = clean[k];
    set(next);
    refs.current[Math.min(i + clean.length, 5)]?.focus();
  }

  return (
    <fieldset className="flex gap-2" disabled={disabled}>
      <legend className="sr-only">Code</legend>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          aria-label={`Digit ${i + 1}`}
          inputMode="numeric"
          autoComplete={i === 0 ? "one-time-code" : "off"}
          autoFocus={i === 0}
          value={d}
          onChange={(e) => type(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Backspace" && !digits[i] && i > 0) refs.current[i - 1]?.focus();
          }}
          className={cn(
            "h-16 w-14 rounded-lg border border-input bg-card text-center font-mono text-[26px] outline-none",
            "focus:border-sand focus:ring-[3px] focus:ring-sand-soft",
          )}
        />
      ))}
    </fieldset>
  );
}
