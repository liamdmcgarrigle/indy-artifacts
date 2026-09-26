import { pageOwner } from "@/lib/auth/page";
import { notFound } from "next/navigation";
import { Editor } from "@/components/Editor";
import { getContext } from "@/lib/service/context";
import { requireArtifact, requireVersion } from "@/lib/service/artifacts";
import { NotFoundError } from "@/lib/service/errors";

/** Where the browser reaches the document server, or null when it is not run. */
function collabPort(): number | null {
  const raw = process.env.ARTIFACTS_COLLAB_PORT;
  if (raw === "off") return null;
  const port = Number(raw || 5175);
  return Number.isFinite(port) && port > 0 ? port : null;
}

export const dynamic = "force-dynamic";

export default async function EditPage({ params }: { params: Promise<{ slug: string }> }) {
  await pageOwner();
  const { slug } = await params;
  try {
    const ctx = getContext();
    const artifact = requireArtifact(ctx, slug);
    const version = requireVersion(ctx, artifact);
    return (
      <Editor
        slug={artifact.slug}
        title={artifact.title}
        theme={artifact.theme}
        kind={artifact.kind}
        version={version.number}
        source={version.source}
        files={version.files}
        collabPort={collabPort()}
      />
    );
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
