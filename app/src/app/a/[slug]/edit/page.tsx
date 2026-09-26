import { pageOwner } from "@/lib/auth/page";
import { notFound, redirect } from "next/navigation";
import { Editor } from "@/components/Editor";
import { getContext } from "@/lib/service/context";
import { requireArtifact, requireVersion } from "@/lib/service/artifacts";
import { NotFoundError } from "@/lib/service/errors";

export const dynamic = "force-dynamic";

export default async function EditPage({ params }: { params: Promise<{ slug: string }> }) {
  await pageOwner();
  const { slug } = await params;
  try {
    const ctx = getContext();
    const artifact = requireArtifact(ctx, slug);
    // A markdown page is edited where it is read.
    if (artifact.kind === "markdown") redirect(`/a/${artifact.slug}?edit=1`);
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
        collab
      />
    );
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
