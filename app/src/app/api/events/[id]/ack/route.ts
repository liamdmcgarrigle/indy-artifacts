import { requireMember } from "@/lib/auth/access";
import { getContext } from "@/lib/service/context";
import { ackEvent } from "@/lib/service/events";
import { body, fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireMember(getContext(), request);
    const { id } = await params;
    const payload = await body(request);
    ackEvent(getContext(), Number(id), String(payload.note ?? "sent"));
    return json({ ok: true });
  } catch (err) {
    return fail(err);
  }
}
