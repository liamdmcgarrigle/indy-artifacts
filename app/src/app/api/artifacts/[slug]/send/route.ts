import { requireMember } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { sendFeedback } from "@/lib/service/comments";
import { body, fail, json } from "@/lib/api/respond";
import { requireArtifact } from "@/lib/service/artifacts";
import { listenerFor } from "@/lib/service/listeners";

export const dynamic = "force-dynamic";

/** Who would get a send right now, for the Send panel to say. */
export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    requireMember(getContext(), request);
    const { slug } = await params;
    return json({ listener: listenerFor(requireArtifact(getContext(), slug)) });
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
    requireMember(getContext(), request);
    const { slug } = await params;
    const payload = await body(request);
    return json(
      sendFeedback(getContext(), slug, {
        message: payload.message as string | undefined,
        authorName: (payload.author_name ?? payload.authorName) as string | undefined,
      }),
    );
  } catch (err) {
    return fail(err);
  }
}
