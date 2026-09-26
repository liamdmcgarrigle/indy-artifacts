import { cn } from "@/lib/utils";

/** The sack, in line. Stroke follows currentColor unless a colour is given. */
export function SackMark({
  className,
  size = 16,
  strokeWidth = 5,
  tie = true,
  title,
}: {
  className?: string;
  size?: number;
  strokeWidth?: number;
  tie?: boolean;
  title?: string;
}) {
  return (
    <svg
      width={size}
      height={(size * 80) / 64}
      viewBox="0 0 64 80"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinejoin="round"
      strokeLinecap="round"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <path d="M24 30 L19 17 L27 21 L32 14 L37 21 L45 17 L40 30" />
      <path d="M24 30 C12 36 8 52 12 62 C16 72 48 72 52 62 C56 52 52 36 40 30" />
      {tie ? <path d="M22 29.5 H42" /> : null}
    </svg>
  );
}

export function Wordmark({ className, size = 14 }: { className?: string; size?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <SackMark size={size + 2} className="text-sand" />
      <span className="font-display font-semibold tracking-[-0.02em]" style={{ fontSize: size + 1 }}>
        indy
      </span>
    </span>
  );
}
