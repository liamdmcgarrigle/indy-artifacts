import { pageOwner } from "@/lib/auth/page";
import { notFound } from "next/navigation";
import { ArtifactView } from "@/components/ArtifactView";
import { loadView } from "@/lib/view";
import { NotFoundError } from "@/lib/service/errors";

export const dynamic = "force-dynamic";

export default async function ArtifactPage({ params }: { params: Promise<{ slug: string }> }) {
  const { user } = await pageOwner();
  const { slug } = await params;
  try {
    return <ArtifactView {...loadView(slug)} userName={user?.name ?? null} />;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
