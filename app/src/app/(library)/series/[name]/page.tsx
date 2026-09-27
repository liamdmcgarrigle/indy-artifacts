import Link from "next/link";
import { Layers3 } from "lucide-react";
import { ownerContext } from "@/lib/auth/page";
import { listLibrary } from "@/lib/service/library";
import { ViewHeader } from "@/components/library/ViewHeader";
import { LibraryBoard } from "@/components/library/LibraryBoard";
import { EmptyState } from "@/components/library/EmptyState";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ name: string }> }) {
  return { title: decodeURIComponent((await params).name) };
}

export default async function SeriesPage({ params }: { params: Promise<{ name: string }> }) {
  const name = decodeURIComponent((await params).name);
  const rows = listLibrary((await ownerContext()), { view: "series", name });
  const [latest, ...earlier] = rows;
  return (
    <>
      <ViewHeader
        title={name}
        subtitle={`Series · ${rows.length} run${rows.length === 1 ? "" : "s"}`}
        icon={<Layers3 className="size-4 text-muted-foreground" />}
        actions={
          latest ? (
            <Link href={`/a/${latest.slug}`} className="text-[13px] text-sand-strong hover:underline">
              Open the latest
            </Link>
          ) : null
        }
      />
      {rows.length ? (
        <div className="pt-5">
          <LibraryBoard
            listLabel={name}
            sections={[
              { id: "latest", title: "Latest", layout: "table", rows: latest ? [latest] : [] },
              ...(earlier.length ? [{ id: "earlier", title: "Earlier", layout: "table" as const, rows: earlier }] : []),
            ]}
          />
        </div>
      ) : (
        <EmptyState title="This series is empty" />
      )}
    </>
  );
}
