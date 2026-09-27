import { getContext } from "@/lib/service/context";
import { requireMember } from "@/lib/auth/access";
import { saveTheme } from "@/lib/service/themes";
import { themesState } from "@/lib/api/themes";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    requireMember(getContext(), request);
    return json(themesState());
  } catch (err) {
    return fail(err);
  }
}

/** Creates or changes a theme: { name, label?, base?, tokens?, dark? }. */
export async function POST(request: Request) {
  try {
    const ctx = getContext();
    requireMember(ctx, request);
    const input = await body(request);
    const theme = saveTheme(ctx, {
      name: String(input.name ?? ""),
      create: true,
      label: input.label === undefined ? undefined : String(input.label),
      base: input.base === undefined ? undefined : String(input.base),
      tokens: (input.tokens ?? undefined) as Record<string, unknown> | undefined,
      dark: (input.dark ?? undefined) as Record<string, unknown> | undefined,
    });
    return json({ theme, ...themesState() });
  } catch (err) {
    return fail(err);
  }
}
