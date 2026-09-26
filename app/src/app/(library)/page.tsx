import { getContext } from "@/lib/service/context";
import { listLibrary, needsYou } from "@/lib/service/library";
import { ViewHeader } from "@/components/library/ViewHeader";
import { LibraryBoard } from "@/components/library/LibraryBoard";
import { ConnectHint, EmptyState } from "@/components/library/EmptyState";
import { MarkAllSeen } from "@/components/library/MarkAllSeen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Needs you" };

export default function NeedsYouPage() {
  const ctx = getContext();
  const inbox = needsYou(ctx);
  const inInbox = new Set(inbox.map((r) => r.slug));
  const recent = listLibrary(ctx, { view: "recent" }, 40).filter((r) => !inInbox.has(r.slug));
  const nothing = inbox.length === 0 && recent.length === 0;

  return (
    <>
      <ViewHeader
        title="Needs you"
        subtitle="Replies, unsent comments, new versions and pages being written"
        actions={inbox.length ? <MarkAllSeen /> : null}
      />
      {nothing ? (
        <ConnectHint />
      ) : (
        <div className="pt-5">
          <LibraryBoard
            listLabel="Needs you"
            sections={[
              {
                id: "inbox",
                layout: "inbox",
                rows: inbox,
                empty: (
                  <EmptyState compact title="You are all caught up">
                    New pages, agent replies and comments you have not sent show up here.
                  </EmptyState>
                ),
              },
              { id: "recent", title: "Recent", subtitle: "Sorted by last change", layout: "table", rows: recent },
            ]}
          />
        </div>
      )}
    </>
  );
}
