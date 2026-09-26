import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { buildDir, getContext } from "@/lib/service/context";
import { requireArtifact, requireVersion } from "@/lib/service/artifacts";
import { checkCapability } from "@/lib/auth/accounts";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  "bundle.js": "text/javascript; charset=utf-8",
  "bundle.css": "text/css; charset=utf-8",
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cap: string; slug: string; n: string; file: string }> },
) {
  const { cap, slug, n, file } = await params;
  const type = TYPES[file];
  if (!type) return new Response("not found", { status: 404 });
  try {
    const ctx = getContext();
    if (!checkCapability(ctx, cap, slug, Number(n))) return new Response("expired", { status: 403 });
    const artifact = requireArtifact(ctx, slug);
    const version = requireVersion(ctx, artifact, Number(n));
    const contents = await readFile(join(buildDir(ctx, artifact.id, version.number), file), "utf8");
    return new Response(contents, {
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
        // The frame that loads this has an opaque origin, so the module script
        // fetch is a cross-origin one and needs an allow header to run at all.
        "access-control-allow-origin": "*",
      },
    });
  } catch {
    return new Response(file.endsWith(".css") ? "/* no stylesheet */" : "/* no bundle */", {
      status: 404,
      headers: { "content-type": type },
    });
  }
}
