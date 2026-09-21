export const REFERENCE_MD = `# Artifact authoring reference

## Kinds
- \`markdown\` (default): markdown plus the blocks below. Frontmatter sets title, theme, project, description, tags.
- \`react\`: files map with \`App.tsx\` default-exporting a component.
- \`svelte\`: files map with \`App.svelte\`.
- \`html\`: one complete HTML document, rendered in a sandboxed frame.

## Frontmatter (markdown)
\`\`\`yaml
---
title: Backup run 2026-09-20
theme: default | picaflick | backup-studio
project: backup-studio
description: one line for the index
tags: [backup, nightly]
---
\`\`\`

## Container directives
\`:::card{title="T" subtitle="S"}\` ... \`:::\`
\`:::callout{tone=info|good|warn|bad title="T"}\` ... \`:::\`
\`:::kpis\` with a bullet list of \`Label: value\`, optional \`{tone=good}\` and trailing \`(delta)\`
\`:::columns{n=2}\` containing \`:::col\` blocks
\`:::tabs\` containing \`:::tab{label="First"}\` blocks
\`:::details{summary="More"}\` ... \`:::\`

Containers nest with three colons at every level: a \`:::card\` can hold \`:::columns\`, which hold
\`:::col\` blocks. Each opener takes its own \`:::\` closer, innermost first. A container you never
close comes back in \`warnings\` with its line number.

## Fenced blocks
\`\`\`chart\` YAML: type (bar|line|area|pie|doughnut|scatter), title, x, y (key or list), data (list of objects), stacked, unit, height
\`\`\`table\` CSV with a header row (optional first line \`# sortable\`), or YAML with columns and rows
\`\`\`mermaid\` mermaid source, rendered in a sandboxed frame
\`\`\`html\` raw HTML, rendered in a sandboxed frame

Inline raw HTML in markdown is stripped; the html fence is the escape hatch. Sandboxed frames have
no network access and cannot reach the page around them.

## Compiled artifacts
Importable packages: react, react-dom, svelte, chart.js, d3, lucide-react, plus relative imports of
your own files. Anything else fails the build with a message naming the import. The \`<art-*>\`
elements and the theme's CSS custom properties (\`--art-accent\`, \`--art-text\`, ...) are available
inside the frame.

## Limits
source 1 MB; 40 files / 2 MB total; 30 assets of 20 MB each, given as absolute host paths under
/home/liam/work, /home/liam/orca or /tmp; comment 20 KB.

## Feedback loop
Comments carry the source lines they point at. Read them with artifacts_comments, answer with
artifacts_reply, close with artifacts_resolve, and publish fixes with artifacts_update passing the
expected_version you last saw. A 409 conflict means the operator edited the artifact: re-read it
with artifacts_get first.
`;
