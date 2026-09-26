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
    <header className="sticky top-0 z-10 flex h-[52px] shrink-0 items-center gap-3 border-b border-hairline bg-background/90 px-7 backdrop-blur">
      {icon}
      <h1 className="text-[15px] font-semibold">{title}</h1>
      {subtitle ? <span className="truncate text-[13px] text-muted-foreground">{subtitle}</span> : null}
      {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
    </header>
  );
}
