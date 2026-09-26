import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

function themesDir(): string {
  return config().themesDir;
}

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const base = name.replace(/\.css$/, "");
  if (!/^[a-z0-9-]{1,40}$/.test(base)) return new Response("not found", { status: 404 });
  try {
    const css = await readFile(join(themesDir(), `${base}.css`), "utf8");
    return new Response(css, {
      headers: { "content-type": "text/css; charset=utf-8", "cache-control": "public, max-age=60" },
    });
  } catch {
    return new Response("/* theme not found */", { status: 404, headers: { "content-type": "text/css" } });
  }
}
