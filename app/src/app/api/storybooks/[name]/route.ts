import { getContext } from "@/lib/service/context";
import { requireMember, requireOwner } from "@/lib/auth/access";
import { deleteStorybook, setStorybookSettings } from "@/lib/service/storybooks";
import { storybookDetail, storybooksState } from "@/lib/api/storybooks";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ name: string }> };

/** A Storybook, its builds, and its latest build's stories; ?q= narrows them. */
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = getContext();
    requireMember(ctx, request);
    const q = new URL(request.url).searchParams.get("q") ?? undefined;
    return json(storybookDetail(ctx, (await params).name, q));
  } catch (err) {
    return fail(err);
  }
}

/** Changes its settings: { light?, dark?, hosts? }. */
export async function PUT(request: Request, { params }: Params) {
  try {
    const ctx = getContext();
    requireMember(ctx, request);
    const storybook = setStorybookSettings(ctx, (await params).name, await body(request));
    return json({ storybook, ...storybooksState(ctx) });
  } catch (err) {
    return fail(err);
  }
}

/** Only the owner deletes. Pages that showed its stories say it is gone. */
export async function DELETE(request: Request, { params }: Params) {
  try {
    const ctx = getContext();
    requireOwner(ctx, request);
    await deleteStorybook(ctx, (await params).name);
    return json(storybooksState(ctx));
  } catch (err) {
    return fail(err);
  }
}
