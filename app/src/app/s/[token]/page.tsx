import { cookies } from "next/headers";
import type { Metadata } from "next";
import { ArtifactView } from "@/components/ArtifactView";
import { ShareGate, ShareGone } from "@/components/share/ShareGate";
import { getContext } from "@/lib/service/context";
import { NotFoundError } from "@/lib/service/errors";
import { formOf } from "@/lib/service/responses";
import { requireVersion } from "@/lib/service/artifacts";
import { recordOpen, resolveShare, sharedBy, visitCookieName, visitorOf, type Share } from "@/lib/service/sharing";
import { loadView } from "@/lib/view";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

function share(token: string): Share | string {
  try {
    return resolveShare(getContext(), token);
  } catch (err) {
    if (err instanceof NotFoundError) return err.message;
    throw err;
  }
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const found = share((await params).token);
  return { title: typeof found === "string" ? "Not shared" : found.artifact.title, robots: { index: false, follow: false } };
}

/**
 * A page opened through a share link. The visitor sees the page, and its
 * comments when the link allows them; never the library, other versions or
 * anything the owner and their agents said.
 */
export default async function SharedPage({ params }: Params) {
  const { token } = await params;
  const ctx = getContext();
  const found = share(token);
  if (typeof found === "string") return <ShareGone message={found} />;
  const { link, artifact } = found;

  const jar = await cookies();
  const visitor = visitorOf(ctx, link, jar.get(visitCookieName(link))?.value);
  const owner = sharedBy(ctx);
  if (link.mode === "email" && !visitor) {
    const isForm = formOf(requireVersion(ctx, artifact).source).fields.length > 0;
    return <ShareGate token={token} title={artifact.title} sharedBy={owner} isForm={isForm} />;
  }
  recordOpen(ctx, link, visitor?.email ?? null);

  const view = loadView(artifact.slug, link.pinnedVersion ?? undefined, { audience: { linkId: link.id } });
  return (
    <ArtifactView
      {...view}
      // Only what the page itself shows: no history, no organisation, no build notes.
      project={null}
      series={null}
      branch={null}
      agentName={null}
      versions={[]}
      currentVersion={view.versionNumber}
      warnings={[]}
      buildLog={null}
      sharing={undefined}
      initialThreads={link.allowComments ? view.initialThreads : []}
      form={view.form ? { ...view.form, responses: 0 } : null}
      userName={null}
      visitor={{ token, email: visitor?.email ?? null, allowComments: link.allowComments, sharedBy: owner }}
    />
  );
}
