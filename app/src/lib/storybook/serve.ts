import type { ServiceContext } from "../service/context";
import type { Artifact, Version } from "../service/types";
import { buildForVersion, buildStories, similarStories, storybookSettings, type StorybookSettings } from "../service/storybooks";
import { storybookCapability } from "../auth/accounts";
import { parseStoryBlock, storyQuery } from "./spec";

/**
 * How a story reaches the page: the page's frame asks /embed for the block,
 * and /embed sends it on to the story's page in the uploaded build, under an
 * address that carries a capability for that build alone.
 */

export class StoryUnavailable extends Error {}

/** The Storybook a story block draws from: its own storybook: key, else the page's project. */
export function storybookOf(spec: { storybook?: string }, project: string | null): string | null {
  return spec.storybook ?? project ?? null;
}

export function storyLocation(
  ctx: ServiceContext,
  artifact: Pick<Artifact, "project">,
  version: Pick<Version, "storybooks">,
  block: string,
  scheme: "light" | "dark",
): string {
  const spec = parseStoryBlock(block);
  const name = storybookOf(spec, artifact.project);
  if (!name) {
    throw new StoryUnavailable("This story does not say which Storybook it is from. Give the page a project, or the block a storybook: line.");
  }
  const build = buildForVersion(ctx, version.storybooks, name);
  if (!build) throw new StoryUnavailable(`No Storybook named "${name}" has been uploaded yet.`);
  const stories = buildStories(ctx, build.id);
  if (!stories.some((s) => s.id === spec.id)) {
    const near = similarStories(stories, spec.id);
    throw new StoryUnavailable(
      `The "${name}" Storybook (uploaded ${build.createdAt.slice(0, 10)}) has no story "${spec.id}".${near.length ? ` Similar: ${near.join(", ")}.` : ""}`,
    );
  }
  const cap = storybookCapability(ctx, build.id);
  return `/sb/${cap}/${build.id}/iframe.html?${storyQuery(spec, scheme, storybookSettings(ctx, name))}`;
}

const HOST = /^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(:\d{1,5})?$/i;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The origin the browser used, which the frame's policy has to name exactly.
 *
 * The Host header is the client's to write, and the policy is built from it,
 * so only hosts Indy knows are taken: its own address, loopback, and the
 * extra names a development server is opened by (INDY_DEV_ORIGINS). Anything
 * else gets the configured address, and a frame opened by a stranger's name
 * simply does not load.
 */
export function requestOrigin(request: Request, fallback: string, extraHosts: string[] = devHosts()): string {
  const own = new URL(fallback);
  const proto = (request.headers.get("x-forwarded-proto") ?? "").split(",")[0].trim().toLowerCase();
  const host = (request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "").split(",")[0].trim().toLowerCase();
  if ((proto !== "http" && proto !== "https") || !HOST.test(host)) return own.origin;
  const name = host.replace(/:\d+$/, "");
  const known = host === own.host || LOOPBACK.has(name) || extraHosts.includes(name);
  return known ? `${proto}://${host}` : own.origin;
}

function devHosts(): string[] {
  return (process.env.INDY_DEV_ORIGINS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The policy for a page of an uploaded build. It is sandboxed like every
 * artifact frame, so it runs on an opaque origin with no cookies and no reach
 * into Indy, and it may load only from its own build: not other builds, not
 * Indy's API. Named hosts are for pictures, fonts and styles only.
 *
 * Sources are full addresses rather than 'self', which WebKit does not match
 * from an opaque origin.
 */
export function storyCsp(origin: string, prefix: string, settings: StorybookSettings): string {
  const own = `${origin}${prefix}`;
  const hosts = (settings.hosts ?? []).join(" ");
  const extra = hosts ? ` ${hosts}` : "";
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${own} ${origin}/embed-bridge.js`,
    `style-src 'unsafe-inline' ${own}${extra}`,
    `img-src ${own} data: blob:${extra}`,
    `font-src ${own} data:${extra}`,
    `media-src ${own} blob:${extra}`,
    `connect-src ${own}`,
    `worker-src ${own} blob:`,
    "form-action 'none'",
    "base-uri 'none'",
    "frame-ancestors 'self'",
    "sandbox allow-scripts allow-forms",
  ].join("; ");
}

/**
 * What Indy adds to a build's HTML: the bridge that sizes the frame and picks
 * elements for comments, and a rule that lets a scroll that reaches the end of
 * any scroller in the story carry on into the page around it. Apps often
 * contain their scrolling (overscroll-behavior: contain), which in a page
 * leaves a phone reader stuck on the story.
 */
export function withBridge(html: string): string {
  const bridge = `<style>*,html,body{overscroll-behavior:auto!important}</style>\n<script src="/embed-bridge.js"></script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${bridge}\n</body>`) : `${html}\n${bridge}`;
}

/** Any file that is not HTML: if it is opened on its own (an SVG, say), it runs nothing. */
export const FILE_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";
