import { getContext } from "./service/context";
import { requireArtifact, requireVersion, listVersions } from "./service/artifacts";
import { listComments } from "./service/comments";
import { renderVersion } from "./service/render";
import { capability } from "./auth/accounts";
import { docForView } from "./doc";
import { countResponses, formOf } from "./service/responses";
import type { ArtifactViewProps, ThreadView } from "@/components/ArtifactView";
import type { Audience } from "./service/comments";
import { activeLink } from "./service/sharing";

/**
 * The asset address differs on every load (it carries a signed, expiring
 * capability), so pages are rendered against a stand-in and the real address
 * is put in afterwards. The render cache and this doc cache then hit on the
 * content alone.
 */
const ASSET_STANDIN = "/api/assets/__indy_asset_base__";
const docs = new Map<string, string>();
const MAX_DOCS = 60;

function withAssets<T>(value: T, assetBase: string): T {
  if (typeof value === "string") return value.split(ASSET_STANDIN).join(assetBase) as T;
  return JSON.parse(JSON.stringify(value).split(ASSET_STANDIN).join(assetBase)) as T;
}

/** The editor document for a version, parsed once per content (and fallback title). */
function docFor(key: string, source: string, rendered: ReturnType<typeof renderVersion>) {
  let json = docs.get(key);
  if (json === undefined) {
    json = JSON.stringify(docForView(source, rendered));
    docs.set(key, json);
    if (docs.size > MAX_DOCS) docs.delete(docs.keys().next().value as string);
  }
  return JSON.parse(json) as ReturnType<typeof docForView>;
}

/** Everything the viewer needs for one version of one artifact. */
export function loadView(slug: string, versionNumber?: number, opts: { audience?: Audience } = {}): ArtifactViewProps {
  const ctx = getContext();
  const artifact = requireArtifact(ctx, slug);
  const version = requireVersion(ctx, artifact, versionNumber);
  const framed = artifact.kind !== "markdown";
  const cap = capability(ctx, artifact.slug, version.number);
  const embedBase = `/embed/${cap}/${artifact.slug}/${version.number}`;
  const assetBase = `/api/assets/${cap}/${artifact.slug}/${version.number}`;
  const rendered = framed ? null : renderVersion(version, artifact.title, ASSET_STANDIN);

  const threads: ThreadView[] = listComments(ctx, slug, { status: "all", audience: opts.audience ?? "owner" }).map((t) => ({
    id: t.id,
    authorKind: t.authorKind,
    authorName: t.authorName,
    body: t.body,
    anchor: t.anchor,
    status: t.status,
    sentAt: t.sentAt,
    approvedAt: t.approvedAt,
    versionNumber: t.versionNumber,
    createdAt: t.createdAt,
    replies: t.replies.map((r) => ({
      id: r.id,
      authorKind: r.authorKind,
      authorName: r.authorName,
      body: r.body,
      createdAt: r.createdAt,
    })),
  }));

  const versions = listVersions(ctx, artifact.id);
  const form = framed ? null : formOf(version.source);
  return {
    slug: artifact.slug,
    title: artifact.title,
    project: artifact.project,
    series: artifact.series,
    branch: artifact.branch,
    description: artifact.description,
    agentName: artifact.agentName ?? versions.find((v) => v.authorKind === "agent")?.authorName ?? null,
    pinned: artifact.pinnedAt !== null,
    archived: artifact.archivedAt !== null,
    createdAt: version.createdAt,
    doc: rendered && version.source !== null ? withAssets(docFor(`${version.contentHash}|${artifact.title}`, version.source, rendered), assetBase) : null,
    assetBase,
    form: form && form.fields.length ? { ...form, responses: countResponses(ctx, artifact.id) } : null,
    kind: artifact.kind,
    theme: artifact.theme,
    currentVersion: artifact.currentVersion,
    versionNumber: version.number,
    authorKind: version.authorKind,
    authorName: version.authorName,
    buildStatus: version.buildStatus,
    buildLog: version.buildLog,
    warnings: rendered?.warnings ?? version.warnings,
    // The server-rendered first paint, until the editor takes over. The
    // source itself is not sent: editing works on the document.
    html: rendered ? withAssets(rendered.html, assetBase) : null,
    embedBase,
    framed,
    versions: versions.map((v) => ({
      number: v.number,
      authorKind: v.authorKind,
      authorName: v.authorName,
      message: v.message,
      createdAt: v.createdAt,
      buildStatus: v.buildStatus,
    })),
    initialThreads: threads,
    sharing: activeLink(ctx, slug)?.mode ?? "private",
  };
}
