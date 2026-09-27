"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { copyText } from "@/lib/clipboard";

export function CopyButton({ text, label = "Copy", className, size = "sm" }: { text: string; label?: string; className?: string; size?: "sm" | "default" }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      className={cn("gap-1.5", className)}
      onClick={async () => {
        if (!(await copyText(text))) return;
        setDone(true);
        setTimeout(() => setDone(false), 1400);
      }}
    >
      {done ? <Check className="size-3.5 text-good" /> : <Copy className="size-3.5" />}
      {done ? "Copied" : label}
    </Button>
  );
}
