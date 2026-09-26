/**
 * A project's colour, chosen from its name so it is the same everywhere and
 * needs no setting. Eight hues that read on both schemes and differ in
 * lightness as well as hue.
 */
const PROJECT_COLOURS = ["#7F8CFF", "#3CBF8A", "#F08A4B", "#C38BF0", "#4FB6D8", "#E06C8A", "#B8B04A", "#8B8D93"];

export function projectColour(name: string | null | undefined): string {
  if (!name) return "#6E7076";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PROJECT_COLOURS[h % PROJECT_COLOURS.length];
}

/** An agent's colour for carets and chips. Claude and Codex get fixed ones. */
export function agentColour(name: string | null | undefined): string {
  const n = (name ?? "").toLowerCase();
  if (n.includes("claude")) return "#F08A4B";
  if (n.includes("codex")) return "#4FB6D8";
  return projectColour(name ?? "agent");
}
