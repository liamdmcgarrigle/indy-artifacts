// Sets Indy's version everywhere it is written down.
//
//   npm run set-version 0.3.0
//
// VERSION is the source; this copies it into the package manifests, the
// lockfile's workspace entries and both plugin manifests. Claude Code only
// offers a plugin update when the plugin's version changes, so they move
// together. app/test/version.test.ts fails when any of them disagree.
import { readFileSync, writeFileSync } from "node:fs";

const root = new URL("../", import.meta.url);
const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next ?? "")) {
  console.error("usage: npm run set-version <major.minor.patch>");
  process.exit(1);
}

const edit = (path, change) => {
  const url = new URL(path, root);
  const data = JSON.parse(readFileSync(url, "utf8"));
  change(data);
  writeFileSync(url, JSON.stringify(data, null, 2) + "\n");
};

writeFileSync(new URL("VERSION", root), next + "\n");
const packages = ["package.json", "app/package.json", "collab/package.json", "packages/primitives/package.json"];
for (const path of packages) edit(path, (d) => (d.version = next));
for (const path of ["plugin/.claude-plugin/plugin.json", "plugin/.codex-plugin/plugin.json"]) edit(path, (d) => (d.version = next));
edit("package-lock.json", (lock) => {
  lock.version = next;
  for (const dir of ["", "app", "collab", "packages/primitives"]) if (lock.packages[dir]) lock.packages[dir].version = next;
});
console.log(`Indy is now ${next}. Commit it, and main publishes :${next} and tags v${next}.`);
