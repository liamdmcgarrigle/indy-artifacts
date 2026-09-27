import { getContext } from "@/lib/service/context";
import { requireMember } from "@/lib/auth/access";
import { setProjectTheme } from "@/lib/service/themes";
import { body, fail, json } from "@/lib/api/respond";
import { themesState } from "@/lib/api/themes";

export const dynamic = "force-dynamic";

/** { theme: "name" } gives the project a theme; { theme: null } takes it away. */
export async function PUT(request: Request, { params }: { params: Promise<{ name: string }> }) {
  try {
    const ctx = getContext();
    requireMember(ctx, request);
    const input = await body(request);
    setProjectTheme(ctx, (await params).name, input.theme ? String(input.theme) : null);
    return json(themesState());
  } catch (err) {
    return fail(err);
  }
}
