import { getContext } from "@/lib/service/context";
import { sendFeedback } from "@/lib/service/comments";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  try {
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
