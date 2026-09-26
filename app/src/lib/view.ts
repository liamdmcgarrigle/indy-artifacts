import { getContext } from "./service/context";
import { requireArtifact, requireVersion, listVersions } from "./service/artifacts";
import { listComments } from "./service/comments";
import { renderVersion } from "./service/render";
import { capability } from "./auth/accounts";
import { docForView } from "./doc";
import type { ArtifactViewProps, ThreadView } from "@/components/ArtifactView";

/** Everything the viewer needs for one version of one artifact. */
export function loadView(slug: string, versionNumber?: number): ArtifactViewProps {
  const ctx = getContext();
  const artifact = requireArtifact(ctx, slug);
  const version = requireVersion(ctx, artifact, versionNumber);
  const framed = artifact.kind !== "markdown";
  const cap = capability(ctx, artifact.slug, version.number);
  const embedBase = `/embed/${cap}/${artifact.slug}/${version.number}`;
  const assetBase = `/api/assets/${cap}/${artifact.slug}/${version.number}`;
  const rendered = framed ? null : renderVersion(version, artifact.title, assetBase);

  const threads: ThreadView[] = listComments(ctx, slug, { status: "all" }).map((t) => ({
    id: t.id,
    authorKind: t.authorKind,
    authorName: t.authorName,
    body: t.body,
    anchor: t.anchor,
    status: t.status,
    sentAt: t.sentAt,
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
  return {
    slug: artifact.slug,
    title: artifact.title,
    project: artifact.project,
    series: artifact.series,
    description: artifact.description,
    agentName: artifact.agentName ?? versions.find((v) => v.authorKind === "agent")?.authorName ?? null,
    pinned: artifact.pinnedAt !== null,
    archived: artifact.archivedAt !== null,
    createdAt: version.createdAt,
    doc: rendered && version.source !== null ? docForView(version.source, rendered) : null,
    assetBase,
    kind: artifact.kind,
    theme: artifact.theme,
    currentVersion: artifact.currentVersion,
    versionNumber: version.number,
    authorKind: version.authorKind,
    authorName: version.authorName,
    buildStatus: version.buildStatus,
    buildLog: version.buildLog,
    warnings: rendered?.warnings ?? version.warnings,
    html: rendered?.html ?? null,
    // The viewer edits one block at a time by splicing source lines, so it
    // needs the source of the version it is showing.
    source: version.source,
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
  };
}
