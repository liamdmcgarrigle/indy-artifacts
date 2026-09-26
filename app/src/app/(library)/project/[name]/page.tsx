import { getContext } from "@/lib/service/context";
import { branchesOf, listLibrary } from "@/lib/service/library";
import { BranchFilter } from "@/components/library/BranchFilter";
import { projectColour } from "@/lib/colors";
import { ViewHeader } from "@/components/library/ViewHeader";
import { LibraryBoard } from "@/components/library/LibraryBoard";
import { EmptyState } from "@/components/library/EmptyState";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  return { title: decodeURIComponent((await params).name) };
}

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ name: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const name = decodeURIComponent((await params).name);
  const branch = (await searchParams).branch || null;
  const ctx = getContext();
  const rows = listLibrary(ctx, { view: "project", name, branch: branch ?? undefined });
  const live = rows.filter((r) => !r.archived);
  const archived = rows.filter((r) => r.archived);
  return (
    <>
      <ViewHeader
        title={name}
        subtitle={`${live.length} page${live.length === 1 ? "" : "s"}${branch ? ` on ${branch}` : ""}${archived.length ? `, ${archived.length} archived` : ""}`}
        icon={<span className="size-2.5 rounded-[3px]" style={{ background: projectColour(name) }} />}
      />
      <BranchFilter project={name} branches={branchesOf(ctx, name)} active={branch} />
      {rows.length ? (
        <div className="pt-3">
          <LibraryBoard
            listLabel={branch ? `${name} · ${branch}` : name}
            sections={[
              { id: "live", layout: "table", rows: live },
              ...(archived.length ? [{ id: "archived", title: "Archived", layout: "table" as const, rows: archived }] : []),
            ]}
          />
        </div>
      ) : (
        <EmptyState title="No pages in this project" />
      )}
    </>
  );
}
