import { getContext } from "@/lib/service/context";
import { getSettings } from "@/lib/service/settings";
import { listProjects, listThemes } from "@/lib/service/themes";
import { COLOR_KEYS, FONTS, TOKEN_HELP } from "@/lib/themes/tokens";

/** Everything Settings > Themes shows: the themes, the projects, the default and the choices. */
export function themesState() {
  const ctx = getContext();
  return {
    themes: listThemes(ctx),
    projects: listProjects(ctx),
    defaultTheme: getSettings(ctx).defaultTheme,
    fonts: Object.entries(FONTS).map(([id, f]) => ({ id, label: f.label, kind: f.kind })),
    colors: COLOR_KEYS,
    help: TOKEN_HELP,
  };
}

