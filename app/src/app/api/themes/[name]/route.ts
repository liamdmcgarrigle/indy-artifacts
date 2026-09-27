import { getContext } from "@/lib/service/context";
import { requireMember, requireOwner } from "@/lib/auth/access";
import { deleteTheme, requireTheme, saveTheme } from "@/lib/service/themes";
import { body, fail, json } from "@/lib/api/respond";
import { themesState } from "@/lib/api/themes";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ name: string }> };

export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = getContext();
    requireMember(ctx, request);
    return json({ theme: requireTheme(ctx, (await params).name) });
  } catch (err) {
    return fail(err);
  }
}

/** Changes a theme's label, settings or dark colours. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const ctx = getContext();
    requireMember(ctx, request);
    const { name } = await params;
    requireTheme(ctx, name);
    const input = await body(request);
    const theme = saveTheme(ctx, {
      name,
      label: input.label === undefined ? undefined : String(input.label),
      tokens: (input.tokens ?? undefined) as Record<string, unknown> | undefined,
      dark: (input.dark ?? undefined) as Record<string, unknown> | undefined,
    });
    return json({ theme, ...themesState() });
  } catch (err) {
    return fail(err);
  }
}

/** Only the owner deletes; pages and projects that used it fall back to the default. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const ctx = getContext();
    requireOwner(ctx, request);
    deleteTheme(ctx, (await params).name);
    return json(themesState());
  } catch (err) {
    return fail(err);
  }
}
