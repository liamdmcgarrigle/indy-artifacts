export interface Frontmatter {
  title: string;
  theme: string;
  project?: string;
  description?: string;
  tags: string[];
}

export interface Block {
  id: string;
  lines: [number, number];
  kind: string;
}

export interface Warning {
  line: number;
  message: string;
}

export type EmbedKind = "html" | "mermaid" | "story";

export interface Embed {
  id: string;
  kind: EmbedKind;
  content: string;
  block: string | null;
  /** The fence's first source line. */
  line?: number;
}

export interface RenderResult {
  frontmatter: Frontmatter;
  html: string;
  blocks: Block[];
  embeds: Embed[];
  warnings: Warning[];
  /** Each top-level block's HTML, keyed by its first source line. */
  blockHtml: Record<number, string>;
}

/** How one y key is drawn when it differs from the chart's type. */
export interface ChartSeries {
  as?: "bar" | "line" | "area";
  axis?: "left" | "right";
}

/** A value axis (left, right) or the category axis (x). */
export interface ChartAxis {
  title?: string;
  unit?: string;
  min?: number;
  max?: number;
}

/**
 * Something drawn on the chart that is not data: a line at a value (a budget,
 * a target), a line at one category, or a shaded range of categories.
 */
export type ChartMark =
  | { kind: "value"; value: number; axis: "left" | "right"; label?: string; tone?: string }
  | { kind: "at"; at: string | number; label?: string; tone?: string }
  | { kind: "band"; from: string | number; to: string | number; label?: string; tone?: string };

export interface ChartSpec {
  type: "bar" | "line" | "area" | "pie" | "doughnut" | "scatter";
  title?: string;
  x: string;
  y: string[];
  data: Record<string, unknown>[];
  stacked: boolean;
  unit?: string;
  height: number;
  /** Bars run sideways, categories down the left. */
  horizontal?: boolean;
  series?: Record<string, ChartSeries>;
  axes?: { x?: ChartAxis; left?: ChartAxis; right?: ChartAxis };
  marks?: ChartMark[];
}

export interface TableSpec {
  columns: string[];
  rows: (string | number)[][];
  sortable: boolean;
}

export interface RenderOptions {
  assetBase?: string;
}

export interface PipelineContext {
  warnings: Warning[];
  embeds: Embed[];
  blocks: Block[];
  frontmatter: Record<string, unknown> | null;
  embedCounter: number;
  assetBase?: string;
  blockHtml: Record<number, string>;
  /** The markdown being rendered, for recovering the literal text of a node. */
  source?: string;
}

export const CHART_TYPES = ["bar", "line", "area", "pie", "doughnut", "scatter"] as const;
