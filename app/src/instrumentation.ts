/**
 * Runs once when the server starts. On an install with no account yet, say
 * where to create it, so the first thing in the log is the next step.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ getContext }, { owner, setupBanner }, { config }] = await Promise.all([
    import("./lib/service/context"),
    import("./lib/auth/accounts"),
    import("./lib/config"),
  ]);
  try {
    const c = config();
    if (c.auth === "local") return;
    if (!owner(getContext())) console.log(setupBanner(c.url));
  } catch (err) {
    console.error("[indy] could not open the data folder:", err instanceof Error ? err.message : err);
  }
}
