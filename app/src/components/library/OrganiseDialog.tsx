"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { LibraryRow } from "@/lib/service/library";

/** Move a page to another project, or into or out of a series. */
export function OrganiseDialog({
  target,
  onClose,
  onSaved,
}: {
  target: { row: LibraryRow; what: "project" | "series" } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState("");
  useEffect(() => {
    if (target) setValue((target.what === "project" ? target.row.project : target.row.series) ?? "");
  }, [target]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!target) return;
    const res = await fetch(`/api/artifacts/${encodeURIComponent(target.row.slug)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [target.what]: value.trim() || null }),
    });
    if (!res.ok) toast.error("That did not save.");
    else onSaved();
  };

  return (
    <Dialog open={Boolean(target)} onOpenChange={(o) => (o ? null : onClose())}>
      <DialogContent className="sm:max-w-[420px]">
        <form onSubmit={save} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>{target?.what === "project" ? "Move to project" : "Add to series"}</DialogTitle>
            <DialogDescription>
              {target?.what === "project"
                ? "Pages usually take their project from the repository the agent was in. Leave it empty to ungroup."
                : "A series collects recurring pages, like nightly runs, under one name. Leave it empty to take this page out."}
            </DialogDescription>
          </DialogHeader>
          <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder={target?.what === "project" ? "picaflick" : "Nightly backup"} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
