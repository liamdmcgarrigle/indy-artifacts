/** "just now", "25m", "2h", "yesterday", "3d", then a date. Short, for rows. */
export function ago(iso: string, now = Date.now()): string {
  const diff = now - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d`;
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date(now).getFullYear();
  return d.toLocaleDateString("en", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

/** "25 min ago" style, for sentences. */
export function agoLong(iso: string, now = Date.now()): string {
  const short = ago(iso, now);
  if (short === "just now" || short === "yesterday") return short;
  const m = short.match(/^(\d+)([mhd])$/);
  if (!m) return short;
  const unit = { m: "min", h: "hour", d: "day" }[m[2] as "m" | "h" | "d"];
  const n = Number(m[1]);
  return `${n} ${unit}${n === 1 || m[2] === "m" ? "" : "s"} ago`;
}
