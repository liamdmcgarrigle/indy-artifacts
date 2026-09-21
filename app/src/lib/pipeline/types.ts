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

export type EmbedKind = "html" | "mermaid";

export interface Embed {
  id: string;
  kind: EmbedKind;
  content: string;
  block: string | null;
}

export interface RenderResult {
  frontmatter: Frontmatter;
  html: string;
  blocks: Block[];
  embeds: Embed[];
  warnings: Warning[];
}

export interface ChartSpec {
  type: "bar" | "line" | "area" | "pie" | "doughnut" | "scatter";
  title?: string;
  x: string;
  y: string[];
  data: Record<string, unknown>[];
  stacked: boolean;
  unit?: string;
  height: number;
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
  /** The markdown being rendered, for recovering the literal text of a node. */
  source?: string;
}

export const CHART_TYPES = ["bar", "line", "area", "pie", "doughnut", "scatter"] as const;
export const THEMES = ["default", "picaflick", "backup-studio"] as const;
export const DEFAULT_THEME = "default";
