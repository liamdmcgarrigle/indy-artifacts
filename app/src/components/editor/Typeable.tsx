"use client";

import { useEffect, useRef } from "react";

/**
 * A line of text you edit where it is shown, with no box around it. The
 * element is uncontrolled while focused, so typing never fights a re-render;
 * the value is written back on every keystroke.
 */
export function Typeable({
  value,
  onChange,
  placeholder,
  className,
  multiline = false,
  as: Tag = "div",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  as?: "div" | "span" | "h1" | "p";
}) {
  const ref = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (el && document.activeElement !== el && el.textContent !== value) el.textContent = value;
  }, [value]);
  return (
    <Tag
      ref={ref as never}
      className={["art-typeable", className].filter(Boolean).join(" ")}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      role="textbox"
      aria-label={placeholder}
      data-placeholder={placeholder}
      onInput={(e: React.FormEvent<HTMLElement>) => onChange((e.currentTarget.textContent ?? "").replace(multiline ? /[ \t]+/g : /\s+/g, " "))}
      onKeyDown={(e: React.KeyboardEvent<HTMLElement>) => {
        if (e.key === "Enter" && !multiline) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      onPaste={(e: React.ClipboardEvent<HTMLElement>) => {
        // Plain words only; formatting from elsewhere has nowhere to go.
        e.preventDefault();
        document.execCommand("insertText", false, e.clipboardData.getData("text/plain"));
      }}
    />
  );
}
