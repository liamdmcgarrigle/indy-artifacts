import { pageOwner } from "@/lib/auth/page";
import { getContext } from "@/lib/service/context";
import { sidebarCounts } from "@/lib/service/library";
import { config } from "@/lib/config";
import { Sidebar } from "@/components/library/Sidebar";
import { MobileNav } from "@/components/library/MobileNav";
import { CommandPalette } from "@/components/indy/CommandPalette";

export const dynamic = "force-dynamic";

export default async function LibraryLayout({ children }: { children: React.ReactNode }) {
  const { user } = await pageOwner();
  const counts = sidebarCounts(getContext());
  const host = new URL(config().url).hostname;
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar counts={counts} userName={user?.name ?? "you"} host={host} signedIn={Boolean(user)} className="max-md:hidden" />
      <MobileNav counts={counts} userName={user?.name ?? "you"} host={host} signedIn={Boolean(user)} />
      <main className="scroll-thin flex min-w-0 flex-1 flex-col overflow-y-auto pb-24">{children}</main>
      <CommandPalette projects={counts.projects.map((p) => p.name)} />
    </div>
  );
}
