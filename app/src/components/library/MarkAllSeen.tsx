"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function MarkAllSeen() {
  const router = useRouter();
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={async () => {
        await fetch("/api/library/seen", { method: "POST" });
        router.refresh();
      }}
    >
      Mark all seen
    </Button>
  );
}
