import { access, constants } from "node:fs/promises";
import { redirect } from "next/navigation";
import { getContext } from "@/lib/service/context";
import { owner } from "@/lib/auth/accounts";
import { config, emailEnabled } from "@/lib/config";
import { SetupFlow, type InstallCheck } from "@/components/auth/SetupFlow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up" };

export default async function SetupPage() {
  const ctx = getContext();
  if (owner(ctx)) redirect("/login");
  const c = config();
  const count = Number((ctx.db.prepare("SELECT COUNT(*) AS n FROM artifacts").get() as { n: number }).n);
  const writable = await access(c.dataDir, constants.W_OK).then(
    () => true,
    () => false,
  );

  const checks: InstallCheck[] = [
    { ok: true, name: "Address", detail: c.url },
    {
      ok: writable,
      name: "Data folder",
      detail: writable ? `${c.dataDir} is writable · ${count} artifact${count === 1 ? "" : "s"}` : `${c.dataDir} is not writable`,
    },
    {
      ok: c.url.startsWith("https://") ? true : null,
      name: "HTTPS",
      detail: c.url.startsWith("https://") ? "on" : "off. Fine on your own network; use HTTPS anywhere public.",
    },
    {
      ok: emailEnabled(c) ? true : null,
      name: "Email",
      detail: emailEnabled(c)
        ? `Resend, from ${c.emailFrom}`
        : "RESEND_API_KEY not set. Add it later for sign-in codes and email-confirmed links.",
    },
  ];

  return <SetupFlow checks={checks} email={emailEnabled(c)} />;
}
