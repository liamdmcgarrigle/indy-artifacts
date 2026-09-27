import { getContext } from "@/lib/service/context";
import { themeStylesheet } from "@/lib/service/themes";

export const dynamic = "force-dynamic";

/**
 * A theme's stylesheet, generated from its settings. Pages link it with the
 * theme's current version in the query string, and only that exact address is
 * cached for good; any other, bare or stale, is checked every time, so no one
 * can pin old or future contents under a URL.
 */
export async function GET(request: Request, { params }: { params: Promise<{ name: string }> }) {
  const base = (await params).name.replace(/\.css$/, "");
  const sheet = /^[a-z0-9][a-z0-9-]{0,39}$/.test(base) ? themeStylesheet(getContext(), base) : null;
  if (!sheet) {
    // Not cached anywhere, so a theme made a moment later is found.
    return new Response("/* no such theme */", { status: 404, headers: { "content-type": "text/css; charset=utf-8", "cache-control": "no-store" } });
  }
  const current = new URL(request.url).searchParams.get("v") === sheet.version;
  return new Response(sheet.css, {
    headers: {
      "content-type": "text/css; charset=utf-8",
      // Frames on an opaque origin load it too.
      "access-control-allow-origin": "*",
      "cache-control": current ? "public, max-age=31536000, immutable" : "no-cache",
    },
  });
}
