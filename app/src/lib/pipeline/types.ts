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

export type {
  ChartAxis,
  ChartFormat,
  ChartMark,
  ChartSeries,
  ChartSpec,
  ChartType,
  Curve,
} from "../../../../packages/primitives/src/chart-spec";

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
