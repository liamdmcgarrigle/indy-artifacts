import { ownerContext } from "@/lib/auth/page";
import { listLibrary } from "@/lib/service/library";
import { ViewHeader } from "@/components/library/ViewHeader";
import { LibraryBoard } from "@/components/library/LibraryBoard";
import { EmptyState } from "@/components/library/EmptyState";

export const dynamic = "force-dynamic";
export const metadata = { title: "Pinned" };

export default async function Page() {
  const rows = listLibrary((await ownerContext()), { view: "pinned" });
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
