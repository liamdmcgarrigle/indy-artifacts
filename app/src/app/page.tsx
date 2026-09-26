import { pageOwner } from "@/lib/auth/page";
import Link from "next/link";
import { getContext } from "@/lib/service/context";
import { listArtifacts } from "@/lib/service/artifacts";
import { SchemeToggle } from "@/components/SchemeToggle";

export const dynamic = "force-dynamic";

function when(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return days < 30 ? `${days}d ago` : new Date(iso).toISOString().slice(0, 10);
}

export default async function IndexPage() {
  await pageOwner();
  const artifacts = listArtifacts(getContext(), { limit: 300 });
  const groups = new Map<string, typeof artifacts>();
  for (const artifact of artifacts) {
    const key = artifact.project ?? "Ungrouped";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(artifact);
  }

  return (
    <>
      <link rel="stylesheet" href="/themes/default.css" />
      <header className="top">
        <Link className="top__home" href="/">
          <span className="top__dot" /> Artifacts
        </Link>
        <span className="top__title" />
        <div className="top__actions">
          <SchemeToggle />
        </div>
      </header>

      <main className="index">
        <h1>Artifacts</h1>
        <p className="index__lede">
          {artifacts.length === 0
            ? "Nothing published yet."
            : `${artifacts.length} artifact${artifacts.length === 1 ? "" : "s"} published by the agents on this box.`}
        </p>

        {artifacts.length === 0 ? (
          <div className="empty">
            <p>An agent publishes here with the <code>artifact_publish</code> tool.</p>
            <p className="tiny">
              The MCP endpoint is <code>/mcp</code>. Install the plugin, then ask an agent for a report.
            </p>
          </div>
        ) : (
          [...groups.entries()].map(([project, rows]) => (
            <section className="index__group" key={project}>
              <div className="index__groupname">{project}</div>
              <div className="cards">
                {rows.map((artifact) => (
                  <Link className="card" href={`/a/${artifact.slug}`} key={artifact.id}>
                    <div className="card__title">{artifact.title}</div>
                    {artifact.description ? <div className="card__desc">{artifact.description}</div> : null}
                    <div className="card__foot">
                      <span className="badge">{artifact.kind}</span>
                      <span>v{artifact.currentVersion}</span>
                      <span>{when(artifact.updatedAt)}</span>
                      {artifact.updatedBy === "human" ? <span className="badge badge--human">edited</span> : null}
                      {artifact.openComments > 0 ? (
                        <span className={artifact.unsentComments > 0 ? "badge badge--unsent" : "badge"}>
                          {artifact.openComments} comment{artifact.openComments === 1 ? "" : "s"}
                        </span>
                      ) : null}
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          ))
        )}
      </main>
    </>
  );
}
