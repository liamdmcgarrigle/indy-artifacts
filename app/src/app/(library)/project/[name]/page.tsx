import { getContext } from "@/lib/service/context";
import { listLibrary } from "@/lib/service/library";
import { projectColour } from "@/lib/colors";
import { ViewHeader } from "@/components/library/ViewHeader";
import { LibraryBoard } from "@/components/library/LibraryBoard";
import { EmptyState } from "@/components/library/EmptyState";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  return { title: decodeURIComponent((await params).name) };
}

export default async function ProjectPage({ params }: { params: Promise<{ name: string }> }) {
  const name = decodeURIComponent((await params).name);
  const rows = listLibrary(getContext(), { view: "project", name });
  const live = rows.filter((r) => !r.archived);
  const archived = rows.filter((r) => r.archived);
  return (
    <>
      <ViewHeader
        title={name}
        subtitle={`${live.length} page${live.length === 1 ? "" : "s"}${archived.length ? `, ${archived.length} archived` : ""}`}
        icon={<span className="size-2.5 rounded-[3px]" style={{ background: projectColour(name) }} />}
      />
      {rows.length ? (
        <div className="pt-5">
          <LibraryBoard
            listLabel={name}
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
