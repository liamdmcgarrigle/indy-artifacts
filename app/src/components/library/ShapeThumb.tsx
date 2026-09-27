import type { ShapeToken } from "@/lib/service/library";

/**
 * A drawing of the page's structure, top to bottom, in 56 by 38 pixels: a bar
 * for a heading, lines for text, three boxes for counters, bars for a chart.
 * Tells two reports apart at a glance without rendering either.
 */
export function ShapeThumb({ shape, colour }: { shape: ShapeToken[]; colour: string }) {
  const tokens = shape.slice(0, 3);
  return (
    <span
      aria-hidden
      className="flex h-[38px] w-14 flex-col gap-[3px] overflow-hidden rounded-[5px] border border-border bg-raised p-[5px]"
    >
      {tokens.map((t, i) => (
        <Token key={i} token={t} colour={colour} />
      ))}
    </span>
  );
}

function Token({ token, colour }: { token: ShapeToken; colour: string }) {
  switch (token) {
    case "heading":
      return <span className="h-1 w-3/5 shrink-0 rounded-sm bg-fg-3/60" />;
    case "text":
      return (
        <span className="flex shrink-0 flex-col gap-[2px]">
          <span className="h-[2px] w-full rounded-sm bg-faint/60" />
          <span className="h-[2px] w-4/5 rounded-sm bg-faint/60" />
        </span>
      );
    case "kpis":
      return (
        <span className="flex h-[7px] shrink-0 gap-[2px]">
          <span className="flex-1 rounded-[1px] bg-faint/40" />
          <span className="flex-1 rounded-[1px] bg-faint/40" />
          <span className="flex-1 rounded-[1px] bg-faint/40" />
        </span>
      );
    case "chart":
      return (
        <span className="flex h-3 shrink-0 items-end gap-[2px]">
          {[40, 80, 60, 100, 70].map((h, i) => (
            <span key={i} className="w-[4px] rounded-t-[1px]" style={{ height: `${h}%`, background: colour }} />
          ))}
        </span>
      );
    case "table":
      return (
        <span className="grid h-[9px] shrink-0 grid-cols-3 gap-[1px]">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="bg-faint/35" />
          ))}
        </span>
      );
    case "callout":
      return <span className="h-[6px] w-full shrink-0 rounded-[1px]" style={{ background: `color-mix(in oklab, ${colour} 35%, transparent)` }} />;
    case "form":
      return (
        <span className="flex shrink-0 flex-col gap-[2px]">
          <span className="h-[4px] w-full rounded-[1px] border border-faint/60" />
          <span className="h-[4px] w-2/5 rounded-[1px] bg-sand/70" />
        </span>
      );
    case "code":
      return <span className="h-[6px] w-full shrink-0 rounded-[1px] bg-sidebar" />;
    case "image":
      return <span className="h-[9px] w-full shrink-0 rounded-[1px] bg-faint/30" />;
    case "app":
      return (
        <span className="flex h-full flex-col gap-[3px]">
          <span className="flex gap-[2px]">
            <span className="size-[3px] rounded-full bg-faint/60" />
            <span className="size-[3px] rounded-full bg-faint/60" />
            <span className="size-[3px] rounded-full bg-faint/60" />
          </span>
          <span className="flex flex-1 gap-[3px]">
            <span className="w-1/3 rounded-[1px] bg-faint/25" />
            <span className="flex-1 rounded-[1px]" style={{ background: `color-mix(in oklab, ${colour} 30%, transparent)` }} />
          </span>
        </span>
      );
  }
}
