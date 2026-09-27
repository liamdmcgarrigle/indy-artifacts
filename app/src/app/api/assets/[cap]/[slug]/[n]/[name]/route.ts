import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { assetDir, getContext } from "@/lib/service/context";
import { requireArtifact, versionAssets } from "@/lib/service/artifacts";
import { assetType } from "@/lib/service/assets";
import { fail, json } from "@/lib/api/respond";
import { checkCapability } from "@/lib/auth/accounts";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ cap: string; slug: string; n: string; name: string }> },
) {
  try {
    const ctx = getContext();
    const { cap, slug, n, name } = await params;
    if (!checkCapability(ctx, cap, slug, Number(n))) return json({ error: { code: "forbidden", message: "this link has expired; reload the page" } }, { status: 403 });
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(name)) return json({ error: { code: "invalid", message: "bad asset name" } }, { status: 400 });
    const artifact = requireArtifact(ctx, slug);
    const record = versionAssets(ctx, artifact, Number(n)).find((a) => a.name === name);
    if (!record) return json({ error: { code: "not_found", message: `no asset "${name}"` } }, { status: 404 });

    const path = join(assetDir(ctx, artifact.id, Number(n)), name);
    const info = await stat(path);
    const stream = Readable.toWeb(createReadStream(path)) as ReadableStream;
    return new Response(stream, {
      headers: {
        "content-type": record.type || assetType(name) || "application/octet-stream",
        "content-length": String(info.size),
        "cache-control": "public, max-age=31536000, immutable",
        "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (err) {
    return fail(err);
  }
}
