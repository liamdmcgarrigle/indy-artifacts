import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fail, json } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const dir = process.env.ARTIFACTS_THEMES ?? resolve(process.cwd(), "..", "themes");
    const files = await readdir(dir);
    return json({ themes: files.filter((f) => f.endsWith(".css")).map((f) => f.replace(/\.css$/, "")).sort() });
  } catch (err) {
    return fail(err);
  }
}
