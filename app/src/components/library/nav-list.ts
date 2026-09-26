/**
 * The list a page was opened from, so j and k in the viewer move through the
 * same list: "2 of 7 in Needs you". Kept per tab.
 */
export interface NavList {
  label: string;
  slugs: string[];
}

const KEY = "indy-nav";

export function saveNavList(label: string, slugs: string[]) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ label, slugs } satisfies NavList));
  } catch {
    /* storage off: j and k simply do nothing in the viewer */
  }
}

export function readNavList(): NavList | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as NavList;
    return Array.isArray(parsed.slugs) ? parsed : null;
  } catch {
    return null;
  }
}
