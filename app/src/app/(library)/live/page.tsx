import { getContext } from "@/lib/service/context";
import { listLibrary } from "@/lib/service/library";
import { ViewHeader } from "@/components/library/ViewHeader";
import { LibraryBoard } from "@/components/library/LibraryBoard";
import { EmptyState } from "@/components/library/EmptyState";

export const dynamic = "force-dynamic";
export const metadata = { title: "Live now" };

export default function Page() {
  const rows = listLibrary(getContext(), { view: "live" });
  return (
    <>
      <ViewHeader title="Live now" subtitle="Pages an agent is writing into right now" />
      {rows.length ? (
        <div className="pt-5">
          <LibraryBoard listLabel="Live now" sections={[{ id: "rows", layout: "table", rows }]} />
        </div>
      ) : (
        <EmptyState title="No one is writing right now">When an agent types into a page, it shows here and you can watch.</EmptyState>
      )}
    </>
  );
}
