import { ownerContext } from "@/lib/auth/page";
import { listLibrary } from "@/lib/service/library";
import { ViewHeader } from "@/components/library/ViewHeader";
import { LibraryBoard } from "@/components/library/LibraryBoard";
import { EmptyState } from "@/components/library/EmptyState";

export const dynamic = "force-dynamic";
export const metadata = { title: "Archive" };

export default async function Page() {
  const rows = listLibrary((await ownerContext()), { view: "archive" });
  return (
    <>
      <ViewHeader title="Archive" subtitle="Untouched for 30 days, or archived by hand. Nothing is deleted." />
      {rows.length ? (
        <div className="pt-5">
          <LibraryBoard listLabel="Archive" sections={[{ id: "rows", layout: "table", rows }]} />
        </div>
      ) : (
        <EmptyState title="The archive is empty">Pages idle for 30 days move here on their own. A new version brings one back.</EmptyState>
      )}
    </>
  );
}
