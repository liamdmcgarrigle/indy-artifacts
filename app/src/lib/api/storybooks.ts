import { Readable } from "node:stream";
import type { ServiceContext } from "../service/context";
import { buildNotes, findStories, listBuilds, listStorybooks, receiveUpload, requireStorybook, latestBuild, buildStories, type StorybookSettings } from "../service/storybooks";
import { ValidationError } from "../service/errors";
import { json } from "./respond";

/** The Storybooks for Settings. */
export function storybooksState(ctx: ServiceContext) {
  return { storybooks: listStorybooks(ctx) };
}

/** One Storybook, its builds, and the stories of its latest build (filtered by ?q). */
export function storybookDetail(ctx: ServiceContext, name: string, query?: string, limit = 200) {
  const storybook = requireStorybook(ctx, name);
  const latest = latestBuild(ctx, storybook.name);
  const stories = latest ? findStories(buildStories(ctx, latest.id), query) : [];
  return {
    storybook,
    builds: listBuilds(ctx, storybook.name),
    notes: latest ? buildNotes(ctx, latest.id) : [],
    total: stories.length,
    stories: stories.slice(0, limit),
  };
}

/** Receives a gzipped tar of a build from a request body and answers with what was stored. */
export async function uploadFrom(
  ctx: ServiceContext,
  request: Request,
  target: { storybook: string; settings?: StorybookSettings | null; by: string },
): Promise<Response> {
  if (!request.body) throw new ValidationError("send the build as the request body: tar -czf - -C storybook-static . | curl --data-binary @- …");
  const length = Number(request.headers.get("content-length") ?? "") || null;
  const result = await receiveUpload(ctx, {
    ...target,
    body: Readable.fromWeb(request.body as import("node:stream/web").ReadableStream),
    length,
  });
  const { build, storybook, notes } = result;
  const message = [
    `Stored build ${build.id} of the "${storybook.name}" Storybook: ${build.stories} stories, ${build.files} files.`,
    ...notes,
    `Show a story on a page with a \`\`\`story block (id: <story id>). artifact_stories lists the ids.`,
  ].join("\n");
  return json({ ok: true, message, build, storybook, notes }, { status: 201 });
}
