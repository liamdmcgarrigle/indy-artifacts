import { z } from "zod";
import {
  diffVersions,
  listArtifacts,
  listVersions,
  publishArtifact,
  requireArtifact,
  requireVersion,
  updateArtifact,
} from "../service/artifacts.js";
import { createComment, getComment, listComments, patchComment } from "../service/comments.js";
import { listEvents } from "../service/events.js";
import { artifactUrl, type ServiceContext } from "../service/context.js";
import { ServiceError } from "../service/errors.js";
import { KINDS, LIMITS, type Kind } from "../service/types.js";

export const REFERENCE_URI = "artifacts://reference";

type Content = { content: { type: "text"; text: string }[]; isError?: boolean };

function ok(summary: string, data?: unknown): Content {
  const text = data === undefined ? summary : `${summary}\n\n${JSON.stringify(data, null, 2)}`;
  return { content: [{ type: "text", text }] };
}

function fail(err: unknown): Content {
  const message =
    err instanceof ServiceError ? err.message : err instanceof Error ? err.message : String(err);
  return { content: [{ type: "text", text: `Error: ${message}` }], isError: true };
}

const agentSchema = z
  .object({
    name: z.string().max(80).optional().describe("the agent's name, e.g. claude or codex"),
    terminal: z.string().max(120).optional().describe("$ORCA_TERMINAL_HANDLE, so comments can reach this session"),
    session: z.string().max(120).optional().describe("$CLAUDE_CODE_SESSION_ID"),
  })
  .optional();

const assetsSchema = z
  .array(
    z.object({
      name: z.string().describe("the name the page refers to, e.g. shot.png"),
      path: z.string().describe("absolute host path under an allowed root"),
    }),
  )
  .optional();

export const PUBLISH_SHAPE = {
  title: z.string().max(LIMITS.titleChars).optional().describe("required unless markdown frontmatter sets it"),
  kind: z.enum(KINDS as [Kind, ...Kind[]]).optional().describe("markdown (default), react, svelte or html"),
  slug: z.string().optional().describe("optional stable url segment; derived from the title when omitted"),
  theme: z.enum(["default", "picaflick", "backup-studio"]).optional(),
  project: z.string().max(80).optional(),
  description: z.string().max(400).optional(),
  tags: z.array(z.string().max(40)).max(20).optional(),
  source: z.string().optional().describe("markdown or a complete html document"),
  files: z.record(z.string(), z.string()).optional().describe("for react/svelte: App.tsx or App.svelte plus siblings"),
  assets: assetsSchema,
  message: z.string().max(400).optional().describe("what changed, shown in the version list"),
  agent: agentSchema,
};

function summarise(result: { slug: string; version: number; url: string; warnings: { line: number; message: string }[]; buildStatus: string; buildLog?: string }) {
  const lines = [`Published "${result.slug}" version ${result.version}: ${result.url}`];
  if (result.buildStatus === "error") lines.push(`Build FAILED; the page shows the error. Fix and update:\n${result.buildLog}`);
  else if (result.buildStatus === "ok" && result.buildLog) lines.push(`Build warnings:\n${result.buildLog}`);
  if (result.warnings.length)
    lines.push(`Block warnings:\n${result.warnings.map((w) => `  line ${w.line}: ${w.message}`).join("\n")}`);
  return lines.join("\n");
}

export interface ToolDef {
  name: string;
  config: { title: string; description: string; inputSchema: z.ZodObject<z.ZodRawShape> };
  run: (args: Record<string, unknown>) => Promise<Content>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function buildTools(ctx: ServiceContext): ToolDef[] {
  return [
    {
      name: "artifacts_publish",
      config: {
        title: "Publish an artifact",
        description:
          "Publish a new visual artifact and get its URL. Use this instead of dumping a long report into the terminal. Pass the agent identity once so the operator's comments can reach this session.",
        inputSchema: z.object(PUBLISH_SHAPE),
      },
      run: async (args) => {
        try {
          const result = await publishArtifact(ctx, args as never);
          return ok(summarise(result), result);
        } catch (err) {
          return fail(err);
        }
      },
    },
    {
      name: "artifacts_update",
      config: {
        title: "Update an artifact",
        description:
          "Publish a new version of an existing artifact. expected_version must be the version you last saw; a mismatch means the operator edited it, so read it again with artifacts_get first.",
        inputSchema: z.object({
          slug: z.string(),
          expected_version: z.number().int().positive(),
          ...PUBLISH_SHAPE,
        }),
      },
      run: async (args) => {
        try {
          const { slug, expected_version: expectedVersion, ...rest } = args as Record<string, unknown>;
          const result = await updateArtifact(ctx, String(slug), {
            ...(rest as never),
            expectedVersion: Number(expectedVersion),
          });
          return ok(summarise(result), result);
        } catch (err) {
          return fail(err);
        }
      },
    },
    {
      name: "artifacts_get",
      config: {
        title: "Read an artifact",
        description:
          "Read an artifact's current or historical version, including the exact source, who wrote it and the build log. Use it after the operator edits, and before any update where you might have stale content.",
        inputSchema: z.object({
          slug: z.string(),
          version: z.number().int().positive().optional().describe("defaults to the current version"),
        }),
      },
      run: async (args) => {
        try {
          const artifact = requireArtifact(ctx, String(args.slug));
          const version = requireVersion(ctx, artifact, args.version ? Number(args.version) : undefined);
          return ok(
            `"${artifact.title}" (${artifact.kind}) version ${version.number} of ${artifact.currentVersion}, last written by ${version.authorKind} ${version.authorName}.`,
            {
              slug: artifact.slug,
              title: artifact.title,
              kind: artifact.kind,
              theme: artifact.theme,
              project: artifact.project,
              url: artifactUrl(ctx, artifact.slug),
              current_version: artifact.currentVersion,
              version: version.number,
              author_kind: version.authorKind,
              author_name: version.authorName,
              message: version.message,
              source: version.source,
              files: version.files,
              assets: version.assets,
              build_status: version.buildStatus,
              build_log: version.buildLog,
              warnings: version.warnings,
              versions: listVersions(ctx, artifact.id).map((v) => ({
                number: v.number,
                author_kind: v.authorKind,
                author_name: v.authorName,
                message: v.message,
                created_at: v.createdAt,
              })),
            },
          );
        } catch (err) {
          return fail(err);
        }
      },
    },
    {
      name: "artifacts_list",
      config: {
        title: "List artifacts",
        description: "List published artifacts with their URLs and how many open comments each has.",
        inputSchema: z.object({
          project: z.string().optional(),
          limit: z.number().int().min(1).max(200).optional(),
        }),
      },
      run: async (args) => {
        try {
          const rows = listArtifacts(ctx, {
            project: args.project ? String(args.project) : undefined,
            limit: args.limit ? Number(args.limit) : undefined,
          });
          return ok(
            `${rows.length} artifact${rows.length === 1 ? "" : "s"}.`,
            rows.map((r) => ({
              slug: r.slug,
              title: r.title,
              kind: r.kind,
              theme: r.theme,
              project: r.project,
              current_version: r.currentVersion,
              open_comments: r.openComments,
              url: r.url,
              updated_at: r.updatedAt,
            })),
          );
        } catch (err) {
          return fail(err);
        }
      },
    },
    {
      name: "artifacts_diff",
      config: {
        title: "Diff two versions",
        description: "Show a unified diff of an artifact's source between two versions, to see exactly what the operator changed.",
        inputSchema: z.object({
          slug: z.string(),
          from: z.number().int().positive(),
          to: z.number().int().positive(),
        }),
      },
      run: async (args) => {
        try {
          const patch = diffVersions(ctx, String(args.slug), Number(args.from), Number(args.to));
          return ok(patch.trim() || "No differences.");
        } catch (err) {
          return fail(err);
        }
      },
    },
    {
      name: "artifacts_comments",
      config: {
        title: "Read comments",
        description:
          "List comment threads on an artifact. Each anchored comment carries the source lines it refers to, so you can act on it directly.",
        inputSchema: z.object({
          slug: z.string(),
          status: z.enum(["open", "resolved", "all"]).optional().describe("defaults to open"),
        }),
      },
      run: async (args) => {
        try {
          const threads = listComments(ctx, String(args.slug), {
            status: (args.status as "open" | "resolved" | "all") ?? "open",
          });
          const artifact = requireArtifact(ctx, String(args.slug));
          return ok(
            `${threads.length} ${args.status ?? "open"} thread${threads.length === 1 ? "" : "s"} on "${artifact.title}" (current version ${artifact.currentVersion}).`,
            threads.map((t) => ({
              id: t.id,
              author: t.authorName,
              author_kind: t.authorKind,
              body: t.body,
              status: t.status,
              version_number: t.versionNumber,
              sent: t.sentAt !== null,
              anchor: t.anchor,
              created_at: t.createdAt,
              replies: t.replies.map((r) => ({
                id: r.id,
                author: r.authorName,
                author_kind: r.authorKind,
                body: r.body,
                created_at: r.createdAt,
              })),
            })),
          );
        } catch (err) {
          return fail(err);
        }
      },
    },
    {
      name: "artifacts_reply",
      config: {
        title: "Reply to a comment",
        description: "Reply in a comment thread, so the operator sees your answer next to their comment.",
        inputSchema: z.object({
          comment_id: z.string(),
          body: z.string().min(1),
          agent: agentSchema,
        }),
      },
      run: async (args) => {
        try {
          const parent = getComment(ctx, String(args.comment_id));
          const artifact = ctx.db
            .prepare("SELECT slug FROM artifacts WHERE id = ?")
            .get(parent.artifactId) as { slug: string };
          const comment = createComment(ctx, artifact.slug, {
            body: String(args.body),
            authorName: (args.agent as { name?: string } | undefined)?.name ?? "agent",
            authorKind: "agent",
            parentId: parent.parentId ?? parent.id,
          });
          return ok(`Replied in thread ${parent.parentId ?? parent.id}.`, { id: comment.id });
        } catch (err) {
          return fail(err);
        }
      },
    },
    {
      name: "artifacts_resolve",
      config: {
        title: "Resolve a comment thread",
        description: "Mark a comment thread resolved once you have acted on it. Resolve only threads you actually addressed.",
        inputSchema: z.object({ comment_id: z.string() }),
      },
      run: async (args) => {
        try {
          const comment = patchComment(ctx, String(args.comment_id), { status: "resolved" });
          return ok(`Thread ${comment.id} resolved.`);
        } catch (err) {
          return fail(err);
        }
      },
    },
    {
      name: "artifacts_wait",
      config: {
        title: "Wait for feedback",
        description:
          "Block until the operator sends comments or edits this artifact, or until the timeout. Use it only when the operator asked you to wait for their review.",
        inputSchema: z.object({
          slug: z.string(),
          after: z.number().int().min(0).optional().describe("event id from a previous call"),
          timeout_s: z.number().int().min(1).max(LIMITS.waitSeconds).optional(),
        }),
      },
      run: async (args) => {
        try {
          const slug = String(args.slug);
          requireArtifact(ctx, slug);
          const timeoutMs = (args.timeout_s ? Number(args.timeout_s) : 30) * 1000;
          let after = args.after !== undefined ? Number(args.after) : listEvents(ctx, { slug }).lastId;
          const deadline = Date.now() + timeoutMs;
          for (;;) {
            const { events, lastId } = listEvents(ctx, { slug, after });
            if (events.length) return ok(`${events.length} event(s) on "${slug}".`, { events, last_id: lastId });
            if (Date.now() >= deadline) return ok(`No feedback on "${slug}" within the timeout.`, { events: [], last_id: lastId });
            after = lastId;
            await sleep(1000);
          }
        } catch (err) {
          return fail(err);
        }
      },
    },
  ];
}
