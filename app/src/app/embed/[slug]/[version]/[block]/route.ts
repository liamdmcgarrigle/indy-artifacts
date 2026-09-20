import { buildDir, getContext } from "@/lib/service/context";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { requireArtifact, requireVersion } from "@/lib/service/artifacts";
import { renderVersion } from "@/lib/service/render";
import {
  bundleDocument,
  embedHeaders,
  errorDocument,
  htmlFragmentDocument,
  htmlPageDocument,
  mermaidDocument,
  type EmbedOptions,
} from "@/lib/embed/document";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; version: string; block: string }> };

export async function GET(request: Request, { params }: Params) {
  const ctx = getContext();
  const { slug, version, block } = await params;
  const scheme = new URL(request.url).searchParams.get("scheme") === "dark" ? "dark" : "light";

  let options: EmbedOptions = { theme: "default", scheme, title: "Artifact block" };
  try {
    const artifact = requireArtifact(ctx, slug);
    const v = requireVersion(ctx, artifact, Number(version));
    options = { theme: artifact.theme, scheme, title: artifact.title };

    if (artifact.kind === "html") {
      return new Response(htmlPageDocument(v.source ?? "", options), { headers: embedHeaders() });
    }

    if (artifact.kind === "react" || artifact.kind === "svelte") {
      if (v.buildStatus !== "ok") {
        return new Response(
          errorDocument(`This version did not build.\n\n${v.buildLog ?? "no build log"}`, options),
          { headers: embedHeaders() },
        );
      }
      // Svelte injects its CSS into the bundle, so a stylesheet only exists for
      // artifacts that imported one. Linking it unconditionally would 404.
      const base = `/api/bundle/${encodeURIComponent(slug)}/${v.number}`;
      const hasCss = await stat(join(buildDir(ctx, artifact.id, v.number), "bundle.css"))
        .then(() => true)
        .catch(() => false);
      return new Response(
        bundleDocument({ ...options, bundleUrl: `${base}/bundle.js`, cssUrl: hasCss ? `${base}/bundle.css` : null }),
        { headers: embedHeaders() },
      );
    }

    const rendered = renderVersion(v, artifact.title);
    const embed = rendered.embeds.find((e) => e.id === block);
    if (!embed) {
      return new Response(errorDocument(`No block "${block}" in this version.`, options), {
        status: 404,
        headers: embedHeaders(),
      });
    }
    const document =
      embed.kind === "mermaid"
        ? mermaidDocument(embed.content, options)
        : htmlFragmentDocument(embed.content, options);
    return new Response(document, { headers: embedHeaders() });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(errorDocument(message, options), { status: 404, headers: embedHeaders() });
  }
}
