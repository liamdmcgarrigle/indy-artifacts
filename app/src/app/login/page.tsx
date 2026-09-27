import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/service/context";
import { owner, sessionUser } from "@/lib/auth/accounts";
import { SESSION_COOKIE } from "@/lib/auth/access";
import { config } from "@/lib/config";
import { SackMark } from "@/components/indy/brand";
import { LoginForm } from "@/components/auth/LoginForm";
import { safeNext } from "@/lib/auth/next";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const ctx = getContext();
  const next = safeNext((await searchParams).next);
  if (!owner(ctx)) redirect("/setup");
  if (config().auth === "local" || sessionUser(ctx, (await cookies()).get(SESSION_COOKIE)?.value)) redirect(next);

  return (
    <main className="grid min-h-dvh grid-cols-1 bg-background lg:grid-cols-[minmax(0,1fr)_520px]">
      <section
        aria-hidden
        className="relative hidden flex-col items-center justify-center border-r border-hairline bg-sidebar px-16 lg:flex"
      >
        <p className="max-w-[440px] text-balance text-center font-display text-[44px] font-semibold leading-[1.08] tracking-[-0.025em] text-fg-2">
          Where you&rsquo;ll find the world&rsquo;s best artifacts.
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
