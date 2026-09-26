import { getContext } from "@/lib/service/context";
import { json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/**
 * For the container's health check and any uptime monitor: the app answers
 * and the database opens. Says nothing about the install beyond that.
 */
export async function GET() {
  try {
    getContext().db.prepare("SELECT 1").get();
    return json({ ok: true });
  } catch {
    return json({ ok: false }, { status: 503 });
  }
}
