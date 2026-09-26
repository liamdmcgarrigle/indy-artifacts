export type Kind = "markdown" | "react" | "svelte" | "html";
export type AuthorKind = "agent" | "human";
export type BuildStatus = "none" | "ok" | "error";
export type CommentStatus = "open" | "resolved";
export type EventKind = "comment.created" | "feedback.sent" | "version.created";

export const KINDS: Kind[] = ["markdown", "react", "svelte", "html"];

export const LIMITS = {
  sourceBytes: 1024 * 1024,
  fileCount: 40,
  filesBytes: 2 * 1024 * 1024,
  assetBytes: 20 * 1024 * 1024,
  assetCount: 30,
  commentBytes: 20 * 1024,
  titleChars: 200,
  waitSeconds: 55,
};

export interface AgentIdentity {
  name?: string;
  terminal?: string;
  session?: string;
}

export interface AssetInput {
  name: string;
  path: string;
}

export interface AssetRecord {
  name: string;
  size: number;
  type: string;
}

export interface Anchor {
  type: "point" | "range" | "element";
  block: string;
  lines?: [number, number];
  quote?: string;
  context?: string;
  offset?: number;
  start?: number;
  end?: number;
  selector?: string;
  x?: number;
  y?: number;
}

export interface PublishInput {
  title?: string;
  kind?: Kind;
  slug?: string;
  theme?: string;
  project?: string;
  /** Groups recurring pages, such as nightly runs, under one name. */
  series?: string;
  /** The git branch the agent is on, e.g. feat/share-links. */
  branch?: string;
  description?: string;
  tags?: string[];
  source?: string;
  files?: Record<string, string>;
  assets?: AssetInput[];
  message?: string;
  agent?: AgentIdentity;
}

export interface UpdateInput extends PublishInput {
  expectedVersion: number;
}

export interface Artifact {
  id: string;
  slug: string;
  title: string;
  kind: Kind;
  theme: string;
  project: string | null;
  series: string | null;
  branch: string | null;
  description: string | null;
  tags: string[];
  agentName: string | null;
  terminalHandle: string | null;
  sessionId: string | null;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  pinnedAt: string | null;
  archivedAt: string | null;
  seenVersion: number;
  seenAt: string | null;
  liveBy: string | null;
  liveAt: string | null;
}

export interface Version {
  id: number;
  artifactId: string;
  number: number;
  authorKind: AuthorKind;
  authorName: string;
  message: string | null;
  frontmatter: Record<string, unknown>;
  source: string | null;
  files: Record<string, string> | null;
  assets: AssetRecord[];
  buildStatus: BuildStatus;
  buildLog: string | null;
  warnings: { line: number; message: string }[];
  contentHash: string;
  createdAt: string;
}

export interface Comment {
  id: string;
  artifactId: string;
  versionNumber: number;
  parentId: string | null;
  authorKind: AuthorKind;
  authorName: string;
  body: string;
  anchor: Anchor | null;
  status: CommentStatus;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EventRecord {
  id: number;
  kind: EventKind;
  createdAt: string;
  deliveredAt: string | null;
  deliveryNote: string | null;
  artifact: {
    slug: string;
    title: string;
    url: string;
    terminalHandle: string | null;
    agentName: string | null;
  };
  payload: Record<string, unknown>;
}

export interface PublishResult {
  slug: string;
  version: number;
  url: string;
  warnings: { line: number; message: string }[];
  buildStatus: BuildStatus;
  buildLog?: string;
}
