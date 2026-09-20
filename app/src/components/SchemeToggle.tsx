"use client";

import { useEffect, useState } from "react";

function current(): "light" | "dark" {
  if (typeof document === "undefined") return "light";
  return document.documentElement.getAttribute("data-scheme") === "dark" ? "dark" : "light";
}

export function SchemeToggle() {
  const [scheme, setScheme] = useState<"light" | "dark">("light");

  useEffect(() => setScheme(current()), []);

  function toggle() {
    const next = scheme === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-scheme", next);
    try {
      localStorage.setItem("art-scheme", next);
    } catch {
      /* private mode */
    }
    setScheme(next);
    window.dispatchEvent(new CustomEvent("art:scheme", { detail: next }));
  }

  return (
    <button className="btn btn--ghost" onClick={toggle} title={`Switch to ${scheme === "dark" ? "light" : "dark"}`} aria-label="Toggle colour scheme">
      {scheme === "dark" ? "☽" : "☀"}
    </button>
  );
}
