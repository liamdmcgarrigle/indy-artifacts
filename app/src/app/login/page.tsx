import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/service/context";
import { owner, sessionUser } from "@/lib/auth/accounts";
import { SESSION_COOKIE } from "@/lib/auth/access";
import { config } from "@/lib/config";
import { Swap } from "@/components/indy/swap";
import { SackMark } from "@/components/indy/brand";
import { LoginForm } from "@/components/auth/LoginForm";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

function safeNext(next: string | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const ctx = getContext();
  const next = safeNext((await searchParams).next);
  if (!owner(ctx)) redirect("/setup");
  if (config().auth === "local" || sessionUser(ctx, (await cookies()).get(SESSION_COOKIE)?.value)) redirect(next);

  return (
    <main className="grid min-h-dvh grid-cols-1 bg-background lg:grid-cols-[minmax(0,1fr)_520px]">
      <section
        aria-label="The swap"
        className="relative hidden flex-col items-center justify-center gap-7 overflow-hidden border-r border-hairline bg-sidebar lg:flex"
      >
        <div
          className="swap-glow pointer-events-none absolute left-1/2 top-[46%] size-[620px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgb(217 178 111 / 0.16) 0%, rgb(217 178 111 / 0.05) 38%, rgb(217 178 111 / 0) 70%)",
          }}
        />
        <Swap className="relative h-[504px] w-[420px] max-h-[62vh]" />
        <p className="swap-caption relative font-mono text-[13px] tracking-[0.02em] text-fg-3">
          every version replaces the last, and nothing is lost
        </p>
      </section>

      <section aria-label="Sign in" className="flex flex-col justify-center gap-7 px-6 py-16 sm:px-[72px]">
        <div className="flex items-center gap-3">
          <SackMark size={30} strokeWidth={4} className="text-sand" />
          <span className="font-display text-[40px] font-semibold leading-none tracking-[-0.03em]">indy</span>
        </div>
        <div className="flex flex-col gap-2.5">
          <h1 className="text-balance text-[26px] font-semibold leading-tight tracking-[-0.015em]">
            Your agents publish here. You read, edit, comment and answer.
          </h1>
          <p className="text-[15px] leading-relaxed text-fg-3">
            Reports, live pages and forms from Claude, Codex or anything that speaks MCP.
          </p>
        </div>
        <LoginForm next={next} />
      </section>
    </main>
  );
}
