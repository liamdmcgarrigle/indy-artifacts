import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { getContext } from "@/lib/service/context";
import { checkStorybookCapability } from "@/lib/auth/accounts";
import { buildFile, encodedFile, getBuild, isHtml, storybookSettings } from "@/lib/service/storybooks";
import { FILE_CSP, requestOrigin, storyCsp, withBridge } from "@/lib/storybook/serve";

export const dynamic = "force-dynamic";

const SCRIPT = /\.(m|c)?js$/i;

type Params = { params: Promise<{ cap: string; build: string; path: string[] }> };

/** Every answer from here may be read by the opaque-origin frame that asked. */
const SHARED = {
  "access-control-allow-origin": "*",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "cross-origin-resource-policy": "cross-origin",
};

function refuse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { ...SHARED, "content-type": "text/plain; charset=utf-8", "content-security-policy": FILE_CSP, "cache-control": "no-store" },
  });
}

/**
 * A file of an uploaded Storybook build. The capability in the path is for
 * this build alone and comes from a page that shows one of its stories.
 */
export async function GET(request: Request, { params }: Params) {
  const { cap, build, path } = await params;
  const ctx = getContext();
  if (!checkStorybookCapability(ctx, cap, build)) return refuse(403, "This link has expired. Reload the page.");
  const rel = path.join("/");
  const file = buildFile(ctx, build, rel);
  if (!file) return refuse(404, "Not in this Storybook build.");

  // The page's policy names the address it was opened at, so answers that
  // carry it differ by host and must not be shared between hosts.
  const policy = () => {
    const summary = getBuild(ctx, build);
    const origin = requestOrigin(request, ctx.publicUrl);
    return storyCsp(origin, `/sb/${cap}/${build}/`, summary ? storybookSettings(ctx, summary.storybook) : {});
  };
  const VARY = { vary: "Host, X-Forwarded-Host, X-Forwarded-Proto" };

  if (isHtml(rel)) {
    const csp = policy();
    let html: string;
    try {
      html = await readFile(file.file, "utf8");
    } catch {
      return refuse(404, "This file of the build is missing on the server.");
    }
    return new Response(withBridge(html), {
      headers: {
        ...SHARED,
        "content-type": file.type,
        "content-security-policy": csp,
        ...VARY,
        "cache-control": "private, no-cache",
      },
    });
  }

  let stream: ReadableStream;
  let sent: Awaited<ReturnType<typeof encodedFile>>;
  try {
    sent = await encodedFile(file.file, request.headers.get("accept-encoding"));
    const node = createReadStream(sent.path);
    await new Promise<void>((resolve, reject) => {
      node.once("open", () => resolve());
      node.once("error", reject);
    });
    stream = Readable.toWeb(node) as ReadableStream;
  } catch {
    return refuse(404, "This file of the build is missing on the server.");
  }
  return new Response(stream, {
    headers: {
      ...SHARED,
      "content-type": file.type,
      "content-length": String(sent.size),
      ...(sent.encoding ? { "content-encoding": sent.encoding } : {}),
      // A script may be started as a worker, and a worker runs under its own
      // response's policy, so a script gets the page's. Anything else opened
      // on its own (an SVG, say) runs nothing.
      ...(SCRIPT.test(rel) ? { "content-security-policy": policy() } : { "content-security-policy": FILE_CSP }),
      // A build never changes, and the capability in the address changes daily.
      "cache-control": "private, max-age=172800, immutable",
      ...(SCRIPT.test(rel) ? { vary: "Accept-Encoding, Host, X-Forwarded-Host, X-Forwarded-Proto" } : { vary: "Accept-Encoding" }),
    },
  });
}
