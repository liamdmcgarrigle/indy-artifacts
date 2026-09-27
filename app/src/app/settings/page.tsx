import { pageOwner } from "@/lib/auth/page";
import { getContext } from "@/lib/service/context";
import { listApiTokens } from "@/lib/auth/accounts";
import { config, emailEnabled } from "@/lib/config";
import { getSettings } from "@/lib/service/settings";
import { dataUsage } from "@/lib/service/storage";
import { listSharedPages } from "@/lib/service/sharing";
import { SettingsView } from "@/components/settings/SettingsView";
import { themesState } from "@/lib/api/themes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const { user } = await pageOwner();
  const ctx = getContext();
  const c = config();
  return (
    <SettingsView
      user={user ? { name: user.name, email: user.email, twoStep: user.twoStep } : null}
      tokens={listApiTokens(ctx)}
      shares={listSharedPages(ctx)}
      settings={getSettings(ctx)}
      usage={await dataUsage(ctx)}
      email={{ on: emailEnabled(c), from: c.emailFrom }}
      themes={themesState()}
    />
  );
}
