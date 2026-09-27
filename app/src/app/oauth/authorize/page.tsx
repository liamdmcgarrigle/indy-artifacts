import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/service/context";
import { config } from "@/lib/config";
import { owner, sessionUser } from "@/lib/auth/accounts";
import { hostAllowed, SESSION_COOKIE } from "@/lib/auth/access";
import { checkAuthorize } from "@/lib/auth/oauth";
import { SackMark } from "@/components/indy/brand";
import { Consent } from "@/components/auth/Consent";
import { requestBase } from "@/lib/api/oauth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect an agent" };

/** Where the code goes back to, in words: most agents listen on this machine. */
function destination(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    if (["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return "an app on the computer you started it from";
    if (url.protocol === "https:") return url.host;
    return `the ${url.protocol.replace(/:$/, "")} app`;
  } catch {
    return redirectUri;
  }
}

export default async function AuthorizePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (typeof v === "string") params.set(k, v);

  const ctx = getContext();
  const c = config();
  if (!owner(ctx)) redirect("/setup");
  const signedIn = (c.auth === "local" && hostAllowed(await headers())) || sessionUser(ctx, (await cookies()).get(SESSION_COOKIE)?.value);
  if (!signedIn) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${params}`)}`);

  const checked = checkAuthorize(ctx, params, `${requestBase(await headers())}/mcp`);
  if ("redirect" in checked) redirect(checked.redirect);

  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12">
      <div className="flex w-full max-w-[440px] flex-col gap-6">
        <div className="flex items-center gap-2.5">
          <SackMark size={24} strokeWidth={4} className="text-sand" />
          <span className="font-display text-[26px] font-semibold leading-none tracking-[-0.03em]">indy</span>
        </div>
        {"fatal" in checked ? (
          <section className="flex flex-col gap-2 rounded-xl border border-hairline bg-card p-6">
            <h1 className="m-0 text-lg font-semibold">This link can&rsquo;t connect an agent</h1>
            <p className="m-0 text-sm leading-relaxed text-fg-3">{checked.fatal}</p>
          </section>
        ) : (
          <Consent
            clientName={checked.ok.client.name}
            destination={destination(checked.ok.redirectUri)}
            params={params.toString()}
          />
        )}
      </div>
    </main>
  );
}
