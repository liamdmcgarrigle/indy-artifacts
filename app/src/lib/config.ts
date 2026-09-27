import { resolve } from "node:path";

/**
 * Everything Indy reads from the environment, in one place.
 *
 * Only INDY_URL matters for a real install. The rest have defaults that suit a
 * container with a volume at /data, and each older ARTIFACTS_* name is still
 * read so an existing install keeps working after the rename.
 */

function env(name: string, legacy?: string): string | undefined {
  const value = process.env[name] ?? (legacy ? process.env[legacy] : undefined);
  return value === undefined || value.trim() === "" ? undefined : value.trim();
}

export type AuthMode = "password" | "local";

export interface Config {
  /** The address people reach Indy at. Every link handed out is built from it. */
  url: string;
  dataDir: string;
  /** "local" trusts every request: for an install only you can reach. */
  auth: AuthMode;
  /** Host directories an artifact may reference assets from by path. Empty on a VPS. */
  assetRoots: string[];
  resendKey?: string;
  emailFrom: string;
  /** Loopback address of the document server, for the app's own calls to it. */
  collabUrl: string;
  /** Where the theme CSS files are. */
  themesDir: string;
  /** Extra node_modules directories a compiled artifact may import from. */
  buildModules: string[];
  /** Indy's shadcn components (components/ui, lib/utils), which artifacts import as "@/...". */
  artifactKit: string | null;
  /** Scratch space for compiling artifacts. */
  tmpDir: string | null;
}

/**
 * INDY_URL, checked once at start. Links, cookies and OAuth are all built
 * from it, so a typo such as a missing scheme fails loudly here instead of as
 * a 500 on every page.
 */
function publicUrl(raw: string): string {
  const url = raw.trim().replace(/\/+$/, "");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`INDY_URL must be a full address such as https://indy.example.com, not "${raw}".`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    throw new Error(`INDY_URL must start with http:// or https://, not "${raw}".`);
  if (parsed.pathname !== "/" || parsed.search || parsed.hash)
    throw new Error(`INDY_URL must be the site's root, with no path: "${raw}". Indy can't run under a sub-path.`);
  return url;
}

export function readConfig(): Config {
  const url = publicUrl(env("INDY_URL", "ARTIFACTS_PUBLIC_URL") ?? "http://localhost:1936");
  const roots = env("INDY_ASSET_ROOTS", "ARTIFACTS_ASSET_ROOTS");
  return {
    url,
    dataDir: env("INDY_DATA", "ARTIFACTS_DATA") ?? resolve(process.cwd(), "data"),
    auth: env("INDY_AUTH") === "local" ? "local" : "password",
    assetRoots: roots
      ? roots
          .split(":")
          .map((p) => p.trim())
          .filter(Boolean)
          .map((p) => resolve(p))
      : [],
    resendKey: env("RESEND_API_KEY"),
    // Resend's shared test sender only delivers to the account's own address,
    // which is exactly the owner's second step; a real domain widens that.
    emailFrom: env("INDY_EMAIL_FROM") ?? "Indy <onboarding@resend.dev>",
    collabUrl: env("INDY_COLLAB_URL", "ARTIFACTS_COLLAB_URL") ?? `http://127.0.0.1:${env("COLLAB_PORT") ?? "5175"}`,
    themesDir: env("INDY_THEMES", "ARTIFACTS_THEMES") ?? resolve(process.cwd(), "..", "themes"),
    buildModules: (env("INDY_BUILD_MODULES", "ARTIFACTS_BUILD_MODULES") ?? "")
      .split(":")
      .map((p) => p.trim())
      .filter(Boolean),
    artifactKit: env("INDY_ARTIFACT_KIT") ?? resolve(process.cwd(), "src"),
    tmpDir: env("INDY_TMP", "ARTIFACTS_TMP") ?? null,
  };
}

let cached: Config | null = null;

export function config(): Config {
  if (!cached) cached = readConfig();
  return cached;
}

export function resetConfigForTesting(): void {
  cached = null;
}

/** Whether email features are available, which only needs a Resend key. */
export function emailEnabled(c: Config = config()): boolean {
  return Boolean(c.resendKey);
}

/** True when the configured address is https, so cookies should be Secure. */
export function secureCookies(c: Config = config()): boolean {
  return c.url.startsWith("https://");
}
