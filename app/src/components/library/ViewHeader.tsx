import { MobileNavButton, MobileSearchButton } from "./MobileNav";

export function ViewHeader({
  title,
  subtitle,
  icon,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-3 border-b border-hairline bg-background/90 px-4 backdrop-blur md:h-[52px] md:px-7">
      <MobileNavButton />
      {icon}
      <h1 className="truncate text-base font-semibold md:text-[15px]">{title}</h1>
      {subtitle ? <span className="truncate text-[13px] text-muted-foreground max-md:hidden">{subtitle}</span> : null}
      <div className="ml-auto flex items-center gap-2">
        {actions}
        <MobileSearchButton />
      </div>
    </header>
  );
}
