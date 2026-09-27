import { getContext } from "@/lib/service/context";
import { endSession } from "@/lib/auth/accounts";
import { parseCookies, SESSION_COOKIE } from "@/lib/auth/access";
import { sessionCookie } from "@/lib/auth/page";
import { secureCookies } from "@/lib/config";
import { json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  if (token) endSession(getContext(), token);
  return json({ ok: true }, { headers: { "set-cookie": sessionCookie("", 0, secureCookies()) } });
}
