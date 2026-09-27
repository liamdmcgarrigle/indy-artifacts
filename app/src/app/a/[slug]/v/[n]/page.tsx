import { effectiveTheme, themeHref } from "@/lib/service/themes";
import { pageOwner } from "@/lib/auth/page";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArtifactView } from "@/components/ArtifactView";
import { artifactMetadata, loadView } from "@/lib/view";
import { diffVersions, requireArtifact } from "@/lib/service/artifacts";
import { getContext } from "@/lib/service/context";
import { NotFoundError } from "@/lib/service/errors";
import { SchemeToggle } from "@/components/SchemeToggle";

export const dynamic = "force-dynamic";

export const generateMetadata = ({ params }: { params: Promise<{ slug: string; n: string }> }) =>
  params.then(({ n }) => artifactMetadata(params, (title) => `${title}, version ${n}`));

function DiffLine({ line }: { line: string }) {
  if (line.startsWith("+++") || line.startsWith("---")) return <span className="hunk">{line}</span>;
  if (line.startsWith("@@")) return <span className="hunk">{line}</span>;
  if (line.startsWith("+")) return <span className="add">{line}</span>;
  if (line.startsWith("-")) return <span className="del">{line}</span>;
  return <span>{line || " "}</span>;
}

export default async function VersionPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; n: string }>;
  searchParams: Promise<{ diff?: string }>;
}) {
  const { user } = await pageOwner();
  const { slug, n } = await params;
  const { diff } = await searchParams;
  const number = Number(n);
  if (!Number.isFinite(number)) notFound();

  try {
    if (diff !== undefined) {
      const ctx = getContext();
      const artifact = requireArtifact(ctx, slug);
      const from = Number(diff) || Math.max(number - 1, 1);
      const patch = diffVersions(ctx, slug, from, number);
      return (
        <>
          <link rel="stylesheet" href={themeHref(effectiveTheme(ctx, artifact))} />
          <header className="top">
            <Link className="top__home" href="/">
              <span className="top__dot" /> Indy
            </Link>
            <div className="top__title">
              {artifact.title} <span className="top__meta">v{from} to v{number}</span>
            </div>
            <div className="top__actions">
              <Link className="btn" href={`/a/${slug}/v/${number}`}>
                Back to v{number}
              </Link>
              <SchemeToggle />
            </div>
          </header>
          <main className="index">
            <div className="diff">
              {patch.split("\n").map((line, i) => (
                <DiffLine key={i} line={line} />
              ))}
            </div>
          </main>
        </>
      );
    }
    return <ArtifactView {...loadView(slug, number)} userName={user?.name ?? null} />;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
