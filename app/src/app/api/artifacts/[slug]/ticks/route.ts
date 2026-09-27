import { requireMember } from "@/lib/auth/access";
import { owner } from "@/lib/auth/accounts";
import { getContext } from "@/lib/service/context";
import { requireArtifact, requireVersion } from "@/lib/service/artifacts";
import { checklistWire, setTick, taskStates, tickViews, unsentTicks } from "@/lib/service/ticks";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

function versionOf(request: Request): number | undefined {
  const raw = new URL(request.url).searchParams.get("version");
  return raw ? Number(raw) : undefined;
}

/** The ticks on a version, and how many are waiting to go to the agent. */
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = getContext();
    const who = requireMember(ctx, request);
    const artifact = requireArtifact(ctx, (await params).slug);
    const version = requireVersion(ctx, artifact, versionOf(request));
    if (who.kind === "agent") return json({ checklist: checklistWire(taskStates(ctx, artifact, version)) });
    return json({ ticks: tickViews(ctx, artifact, version), unsent: unsentTicks(ctx, artifact.id).length });
  } catch (err) {
    return fail(err);
  }
}

/** Tick or untick an item: { key, checked, version }. */
export async function POST(request: Request, { params }: Params) {
  try {
    const ctx = getContext();
    const who = requireMember(ctx, request);
    const artifact = requireArtifact(ctx, (await params).slug);
    const input = await body(request);
    const version = input.version === undefined ? undefined : Number(input.version);
    const state = setTick(ctx, artifact.slug, {
      key: String(input.key ?? ""),
      checked: input.checked === true,
      version,
      by:
        who.kind === "agent"
          ? { kind: "agent", name: who.name }
          : // Visitors see this name, so it is the owner's own, never "you".
            { kind: "owner", name: who.user?.name ?? owner(ctx)?.name ?? "Owner" },
    });
    const shown = requireVersion(ctx, artifact, version);
    return json({ ticks: tickViews(ctx, artifact, shown), unsent: unsentTicks(ctx, artifact.id).length, done: state.done });
  } catch (err) {
    return fail(err);
  }
}
