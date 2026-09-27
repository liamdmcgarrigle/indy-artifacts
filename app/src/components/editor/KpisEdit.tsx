"use client";

import { NodeViewWrapper, type ReactNodeViewProps } from "@tiptap/react";
import { Plus, X } from "lucide-react";
import type { KpiItem } from "@/lib/doc/schema";
import { cn } from "@/lib/utils";
import { Typeable } from "./Typeable";

const TONES = [null, "good", "warn", "bad", "info"] as const;
const TONE_NAME: Record<string, string> = { good: "Good", warn: "Warn", bad: "Bad", info: "Info" };

/**
 * Counter tiles, edited where they stand: type over a value or a label, tap
 * the dot to change its colour, add or drop a tile.
 */
export function KpisEdit({ node, updateAttributes }: ReactNodeViewProps) {
  const items = (node.attrs.items ?? []) as KpiItem[];
  const write = (next: KpiItem[]) => updateAttributes({ items: next });
  const change = (i: number, patch: Partial<KpiItem>) => write(items.map((k, j) => (j === i ? { ...k, ...patch } : k)));

  return (
    <NodeViewWrapper className="kpi-edit" data-drag-handle="">
      {items.map((k, i) => (
        <div key={i} className={cn("kpi-edit__tile", k.tone && `kpi-edit__tile--${k.tone}`)}>
          <Typeable className="kpi-edit__value" value={k.value} placeholder="Value" onChange={(value) => change(i, { value })} />
          <Typeable className="kpi-edit__label" value={k.label} placeholder="Label" onChange={(label) => change(i, { label })} />
          <Typeable className="kpi-edit__delta" value={k.delta ?? ""} placeholder="+ change" onChange={(delta) => change(i, { delta: delta || null })} />
          <div className="kpi-edit__tools">
            <button
              type="button"
              className={cn("kpi-edit__tone", k.tone && `kpi-edit__tone--${k.tone}`)}
              title={`Colour: ${k.tone ? TONE_NAME[k.tone] : "plain"}. Tap to change.`}
              aria-label="Change colour"
              onClick={() => change(i, { tone: TONES[(TONES.indexOf((k.tone ?? null) as never) + 1) % TONES.length] })}
            />
            <button type="button" className="kpi-edit__drop" aria-label="Remove tile" onClick={() => write(items.filter((_, j) => j !== i))}>
              <X className="size-3.5" />
            </button>
          </div>
        </div>
      ))}
      <button type="button" className="kpi-edit__add" onClick={() => write([...items, { label: "", value: "", tone: null, delta: null }])}>
        <Plus className="size-4" /> Tile
      </button>
    </NodeViewWrapper>
  );
}
