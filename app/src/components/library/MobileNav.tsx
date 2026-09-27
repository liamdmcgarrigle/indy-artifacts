"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Menu, Search } from "lucide-react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { openCommand } from "@/components/indy/CommandPalette";
import { Sidebar } from "./Sidebar";

const OPEN_EVENT = "indy:open-nav";

/** Open the library navigation on a phone, where the sidebar is tucked away. */
export function openNav() {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** The sidebar in a sheet, for narrow screens. Closes itself on navigation. */
export function MobileNav(props: React.ComponentProps<typeof Sidebar>) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent side="left" showCloseButton={false} className="w-[280px] max-w-[85vw] gap-0 border-hairline p-0">
        <SheetTitle className="sr-only">Library</SheetTitle>
        <Sidebar {...props} className="w-full border-r-0" />
      </SheetContent>
    </Sheet>
  );
}

/** The two buttons a phone needs in a view header: the menu and search. */
export function MobileNavButton() {
  return (
    <button
      type="button"
      onClick={openNav}
      aria-label="Open the library menu"
      className="-ml-2 flex size-10 shrink-0 items-center justify-center rounded-lg text-fg-2 active:bg-raised md:hidden"
    >
      <Menu className="size-5" />
    </button>
  );
}

export function MobileSearchButton() {
  return (
    <button
      type="button"
      onClick={() => openCommand()}
      aria-label="Search"
      className="-mr-2 flex size-10 shrink-0 items-center justify-center rounded-lg text-fg-2 active:bg-raised md:hidden"
    >
      <Search className="size-5" />
    </button>
  );
}
