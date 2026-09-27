// The authoring reference has one source: the plugin's reference.md, which
// agents read offline. This copies it into the server, which serves it as
// indy://reference. test/reference.test.ts fails when the two drift.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const md = readFileSync(fileURLToPath(new URL("../../plugin/skills/publish/reference.md", import.meta.url)), "utf8");
const body = md.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
writeFileSync(
  fileURLToPath(new URL("../src/lib/mcp/reference.ts", import.meta.url)),
  `// Generated from plugin/skills/publish/reference.md by scripts/sync-reference.mjs. Edit that file.\nexport const REFERENCE_MD = \`${body}\`;\n`,
);
