import { getContext } from "@/lib/service/context";
import { listLibrary } from "@/lib/service/library";
import { ViewHeader } from "@/components/library/ViewHeader";
import { LibraryBoard } from "@/components/library/LibraryBoard";
import { EmptyState } from "@/components/library/EmptyState";

export const dynamic = "force-dynamic";
export const metadata = { title: "All recent" };

export default function Page() {
  const rows = listLibrary(getContext(), { view: "recent" });
  return (
    <>
      <ViewHeader title="All recent" subtitle="Everything not archived, newest change first" />
      {rows.length ? (
        <div className="pt-5">
          <LibraryBoard listLabel="All recent" sections={[{ id: "rows", layout: "table", rows }]} />
        </div>
      ) : (
        <EmptyState title="Nothing here yet">Pages your agents publish appear here.</EmptyState>
      )}
    </>
  );
}
