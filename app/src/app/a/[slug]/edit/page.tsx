import { notFound } from "next/navigation";
import { Editor } from "@/components/Editor";
import { getContext } from "@/lib/service/context";
import { requireArtifact, requireVersion } from "@/lib/service/artifacts";
import { NotFoundError } from "@/lib/service/errors";

export const dynamic = "force-dynamic";

export default async function EditPage({ params }: { params: Promise<{ slug: string }> }) {
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
      />
    );
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
