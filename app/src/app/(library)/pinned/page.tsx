import { getContext } from "@/lib/service/context";
import { listLibrary } from "@/lib/service/library";
import { ViewHeader } from "@/components/library/ViewHeader";
import { LibraryBoard } from "@/components/library/LibraryBoard";
import { EmptyState } from "@/components/library/EmptyState";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pinned" };

export default function Page() {
  const rows = listLibrary(getContext(), { view: "pinned" });
  return (
    <>
      <ViewHeader title="Pinned" subtitle="Kept at hand, and never archived" />
      {rows.length ? (
        <div className="pt-5">
          <LibraryBoard listLabel="Pinned" sections={[{ id: "rows", layout: "table", rows }]} />
        </div>
      ) : (
        <EmptyState title="Nothing pinned">Press p on any row, or use its menu, to keep a page here.</EmptyState>
      )}
    </>
  );
}
