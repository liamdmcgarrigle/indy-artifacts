// Generated from plugin/skills/publish/reference.md by scripts/sync-reference.mjs. Edit that file.
export const REFERENCE_MD = `# Indy authoring reference

Everything you can put in an artifact, with one example of each.

## The four kinds

| kind | you send | rendered as |
|---|---|---|
| \`markdown\` | \`source\`: one markdown document with YAML frontmatter | the vocabulary below; \`html\` and \`mermaid\` blocks go in sandboxed frames |
| \`react\` | \`files\`: a map of paths to contents, entry \`App.tsx\` with a default export | bundled at publish, runs in one sandboxed frame |
| \`svelte\` | \`files\`: same shape, entry \`App.svelte\` | bundled at publish, runs in one sandboxed frame |
| \`html\` | \`source\`: one complete HTML document | one sandboxed frame, served as-is under a strict CSP |

Markdown covers most reports. Use \`react\` or \`svelte\` when the page needs state or
interaction beyond tabs, and \`html\` when you already have a finished document.

## Frontmatter (markdown kind)

\`\`\`yaml
---
title: Backup run 2026-09-20      # required
project: nightly-backups          # the repository's folder name; also picks the page's theme
theme: graphite                   # optional; leave it out to follow the project's theme
description: Nightly run summary  # optional one-liner in the index
tags: [backup, nightly]           # optional
---
\`\`\`

For the other kinds the same fields are tool arguments instead.

## Themes

A page takes its theme from its project, unless it names one with \`theme\`, and the
project's comes from Indy's default unless one was set. So set a theme on the project once
rather than on each page. \`artifact_themes\` lists the themes and which project uses which.

\`artifact_theme_set\` creates or changes a theme and can make it a project's theme:

\`\`\`
artifact_theme_set
  name:     "acme-web"
  label:    "Acme"
  base:     "paper"                    # paper | graphite | indy, or one of yours; creating only
  tokens:   { accent: "#e4572e", background: "#fbfaf8", surface: "#ffffff",
              text: "#1d1b19", muted: "#6b665f", border: "#e8e3dc",
              fontSans: "manrope", fontBody: "source-serif", radius: 6 }
  projects: ["acme-web"]
\`\`\`

The settings are ten colours (\`background\`, \`surface\`, \`text\`, \`muted\`, \`border\`,
\`accent\`, \`info\`, \`good\`, \`warn\`, \`bad\`, all hex), four fonts (\`fontSans\`, \`fontDisplay\`,
\`fontBody\`, \`fontMono\`), \`fontSize\` (px), \`lineHeight\`, \`radius\` (px), \`shadow\` (\`none\`,
\`soft\`, \`lifted\`), \`density\` (\`compact\`, \`normal\`, \`airy\`) and \`measure\` (reading width in
ch). When creating, anything left out comes from \`base\`; when changing a theme, only what
you pass changes, and \`base\` is refused. Everything else, including hovers, washes, chart
colours and the whole dark scheme, is derived; \`dark: { background: "#101010" }\` sets a
dark colour where the derived one is wrong. Fonts are the ones Indy serves: \`inter\`,
\`geist\`, \`manrope\`, \`nunito-sans\`, \`bricolage\`, \`source-serif\`, \`jetbrains-mono\`,
\`geist-mono\` and the \`system-sans\`, \`system-serif\` and \`system-mono\` stacks. The built-in
themes cannot be changed; copy one by passing it as \`base\` under a new name.

## Container directives

Syntax is \`:::name{attr="value"}\` on its own line, content, then \`:::\` to close. Write
three colons at every level when you nest them: a card can hold columns that hold
charts, and each opener takes its own \`:::\` closer, innermost first. A directive body is
parsed as markdown. A container you never close comes back in \`warnings\` with its line
number.

### \`:::card{title, subtitle}\`

\`\`\`md
:::card{title="Restore check" subtitle="weekly, sampled"}
Three of 412 archives were sampled and restored. All three matched their manifest.
:::
\`\`\`

### \`:::callout{tone, title}\`

\`tone\` is \`info\` (the default), \`good\`, \`warn\` or \`bad\`.

\`\`\`md
:::callout{tone="warn" title="Retention drifting"}
The 90-day policy is holding 104 days of snapshots. Nothing is at risk yet.
:::
\`\`\`

### \`:::kpis\`

The body is a bullet list of \`Label: value\`. A bullet may carry a \`{tone=...}\` and end
with a delta in parentheses.

\`\`\`md
:::kpis
- Archives: 412
- Restored: 3 {tone=good} (+1)
- Failed: 0 {tone=good}
- Duration: 41m (-6m)
:::
\`\`\`

### \`:::columns{n}\` with \`:::col\`

\`n\` is 2 to 4, default 2. On a phone columns stack; \`compact\` keeps them side by side,
two across at most: \`:::columns{n=2 compact}\`.

\`\`\`md
:::columns{n="2"}
:::col
**Before**: 41 minutes, 12 GB transferred.
:::
:::col
**After**: 35 minutes, 9 GB transferred.
:::
:::
\`\`\`

### \`:::tabs\` with \`:::tab{label}\`

\`\`\`md
:::tabs
:::tab{label="Summary"}
All 412 archives verified.
:::
:::tab{label="Log"}
See \`assets/run.txt\` for the full output.
:::
:::
\`\`\`

### \`:::details{summary}\`

\`\`\`md
:::details{summary="Full command"}
\`restic -r /srv/backups check --read-data-subset=3%\`
:::
\`\`\`

## Fenced blocks

### \`\`\`\` \`\`\`chart \`\`\`\`

YAML. \`type\` is \`bar\`, \`line\`, \`area\`, \`pie\`, \`doughnut\` or \`scatter\`. \`x\` is one key,
\`y\` is a key or a list of keys, \`data\` is a list of objects. Optional: \`title\`,
\`stacked\` (bool), \`unit\` (a suffix on values), \`height\` (px, default 280). Colours come
from the theme.

\`\`\`\`md
\`\`\`chart
type: bar
title: Backup duration by night
x: night
y: [full, incremental]
stacked: true
unit: min
height: 320
data:
  - { night: Mon, full: 41, incremental: 6 }
  - { night: Tue, full: 0, incremental: 7 }
  - { night: Wed, full: 0, incremental: 5 }
\`\`\`
\`\`\`\`

### \`\`\`\` \`\`\`table \`\`\`\`

CSV with a header row. An optional first line \`# sortable\` makes the columns sortable.

\`\`\`\`md
\`\`\`table
# sortable
Repository,Archives,Last check,Status
srv-backups,412,2026-09-20,ok
photos,88,2026-09-19,ok
\`\`\`
\`\`\`\`

The YAML form does the same job when a value contains commas:

\`\`\`\`md
\`\`\`table
columns: [Repository, Archives, Status]
rows:
  - [srv-backups, 412, ok]
  - [photos, 88, ok]
\`\`\`
\`\`\`\`

### \`\`\`\` \`\`\`mermaid \`\`\`\`

Rendered in a sandboxed frame from the vendored mermaid build.

\`\`\`\`md
\`\`\`mermaid
flowchart LR
  snapshot --> verify --> prune
  verify -->|mismatch| alert
\`\`\`
\`\`\`\`

### \`\`\`\` \`\`\`html \`\`\`\`

The escape hatch. Raw HTML written inline in markdown is stripped by the sanitizer; this
fence is the only way to get your own markup onto the page.

\`\`\`\`md
\`\`\`html
<div style="display:flex;gap:8px">
  <span style="padding:2px 8px;border-radius:999px;background:#E3E8D6">verified</span>
  <span style="padding:2px 8px;border-radius:999px;background:#F0DDD9">stale</span>
</div>
\`\`\`
\`\`\`\`

### \`\`\`\` \`\`\`story \`\`\`\`

One story from the project's uploaded Storybook, drawn by the project's own compiled
components. Use it to show real UI instead of rebuilding it. The Storybook must have been
uploaded first (\`artifact_storybook_upload\`); \`artifact_stories\` lists the ids.

\`\`\`\`md
\`\`\`story
id: screens-friends--requests
width: 402
height: 874
\`\`\`
\`\`\`\`

| key | meaning |
|---|---|
| \`id\` | the story id, as in Storybook's address (\`button--primary\`). A pasted Storybook link works too |
| \`args\` | props for the story, e.g. \`{ label: Save, size: l, disabled: true }\` |
| \`globals\` | Storybook globals, e.g. \`{ locale: fr }\` |
| \`light\`, \`dark\` | globals for when the page is light or dark, over the Storybook's own settings |
| \`width\`, \`height\` | a fixed frame size in pixels, for screens drawn at a device size. The story is scaled down to fit the column and to leave part of the screen free, so the reader can see around it and scroll past it. Without either, the frame fits the story, and a very tall one is shown in part with a button to show all of it. Give a screen both |
| \`storybook\` | which Storybook, when it is not the page's \`project\` |
| \`title\` | what screen readers announce for the frame |

Storybook only takes args and globals in its address when the values are letters, digits,
spaces, \`_\` and \`-\`, numbers, colours, \`true\`/\`false\` and \`null\`. Anything else is left out
and the publish warns you. For a state that needs other values, write a story for it in the
repo, rebuild and upload again. The page never needs a copy of the component.

A version keeps the build that was current when it was published. Upload a new build and
update the page to show the new components; an edit by the operator keeps the old build.

## Sandboxing, and what it costs you

\`html\` and \`mermaid\` blocks, and the \`react\`, \`svelte\` and \`html\` kinds, render inside an
iframe with no same-origin access and no network. (\`story\` blocks are sandboxed the same
way; they may load files from their own build, and images from hosts the Storybook allows.) A CDN script, a web font or a \`fetch\`
call will not load; the frame gets the theme CSS and nothing else. Anything a page needs
has to be in the source you send or vendored in the server.

For \`react\` and \`svelte\` the importable packages are \`react\`, \`react-dom\`,
\`react-dom/client\`, \`svelte\`, \`svelte/store\`, \`chart.js\`, \`chart.js/auto\`, \`d3\`,
\`lucide-react\`, the shadcn set (\`radix-ui\` and \`@radix-ui/*\`, \`class-variance-authority\`,
\`clsx\`, \`tailwind-merge\`, \`cmdk\`, \`sonner\`, \`react-day-picker\`, \`date-fns\`) and relative
files inside your own \`files\` map. Any other import fails the build and the error names
it. The entry is \`App.tsx\` (default-exported component) or \`App.svelte\`; the server
mounts it for you, so do not write your own \`createRoot\` or \`mount\` call.

\`\`\`
files: {
  "App.tsx": "import Report from './Report'\\nexport default function App() { return <Report /> }",
  "Report.tsx": "export default function Report() { return <h1>Backup run</h1> }"
}
\`\`\`

### Tailwind and shadcn/ui

Tailwind v4 works the usual way: a CSS file that starts with \`@import "tailwindcss";\`,
imported from your code. Only the classes your files use end up in the page. Imports of
your own CSS files work too; \`@plugin\`, \`@config\` and other packages' stylesheets do not.
tw-animate-css comes with it, for the \`animate-in\` and \`fade-in\` classes.

The shadcn components are already there. Import them the way a shadcn project would, from
\`@/components/ui/<name>\`, with \`cn\` from \`@/lib/utils\`: accordion, alert, alert-dialog,
avatar, badge, button, calendar, card, checkbox, collapsible, command, dialog,
dropdown-menu, hover-card, input, label, popover, progress, radio-group, scroll-area,
select, separator, sheet, skeleton, slider, sonner, switch, table, tabs, textarea, toggle,
toggle-group and tooltip. A file of that name in your \`files\` map is used instead of
Indy's, so you can bring your own. The shadcn colour names (\`bg-background\`,
\`text-muted-foreground\`, \`bg-primary\`, \`border-border\` and the rest) follow the page's
theme, and \`dark:\` follows the reader's light or dark setting, so you don't define them.

\`\`\`
files: {
  "App.tsx": "import './app.css'\\nimport { Button } from '@/components/ui/button'\\nexport default function App() { return <div className=\\"p-6\\"><Button>Run again</Button></div> }",
  "app.css": "@import \\"tailwindcss\\";"
}
\`\`\`

A build failure still creates the version, with \`build_status: "error"\` and the compiler
log in \`build_log\`, so the operator can see what happened and you can read it back.

## Assets

Attach a file by its absolute path on the machine Indy runs on, not by pasting bytes:

\`\`\`
assets: [{ name: "run-chart.png", path: "/srv/work/nightly-backups/out/chart.png" }]
\`\`\`

The path must be under one of the folders Indy was told to read (\`INDY_ASSET_ROOTS\`), so this
works only when the agent and Indy share a machine. Reference the file from markdown as
\`assets/run-chart.png\`. Assets carry forward: an update that omits \`assets\` keeps the
previous version's set. Names match \`[A-Za-z0-9._-]{1,80}\`, and the allowed extensions are
\`png jpg jpeg gif webp svg mp4 webm json csv txt\`. Indy may scale down and recompress
images as it stores them.

## Limits

| limit | value |
|---|---|
| \`source\` | 1 MB |
| \`files\` map | 40 files, 2 MB total |
| asset | 20 MB each, 30 per version |
| build | 20 s, output 5 MB |
| comment body | 20 KB |
| \`artifact_wait\` | 55 s |

A block that fails to parse does not fail the publish: it renders an error box on the
page and comes back in \`warnings\` with a line number.

## Typing live

\`artifact_type\` writes into a markdown artifact through the shared document, a few
characters at a time, so an operator with the page open watches the edit arrive
instead of seeing a finished version appear. The editor shows who is typing. A new
version is written automatically once the typing settles.

    artifact_type slug=<slug> text="..." mode=append|replace speed=fast|natural|slow

Use it when the operator is watching and asked for a change. For ordinary publishing
use \`artifact_update\`: it is one atomic version and does not need anyone to be there.


## Forms

A page becomes a form when it has questions in it. Everything else on the page
stays ordinary content, so explain, show and ask in one document.

\`\`\`markdown
---
title: Pick a checkout direction
form:
  submit: Send my pick                 # the button's words; default "Submit"
  confirm: Got it, your pick is in.    # shown after sending
---

:::choice{name=direction label="Which one would you ship?" required}
:::option{value=stepped label="Stepped"}
Any content: a picture, a chart, or an html fence as a live preview.
:::
:::option{value=single label="Single page"}
Everything on one screen.
:::
:::

::field{name=why type=textarea label="Why this one?" required placeholder="A line or two"}
::field{name=sure type=scale label="How sure are you?" min=1 max=5 low="a coin flip" high="certain"}
::field{name=worries type=checkboxes label="Anything worrying?" options="Too many steps|Total shows late"}
\`\`\`

\`::field\` types: text, textarea, email, number, url, tel, date, time, select, radio,
checkboxes (these three take \`options="A|B|C"\`), checkbox, switch, rating (\`max\`),
scale (\`min\`, \`max\`, \`low\`, \`high\`) and slider (\`min\`, \`max\`, \`step\`). Every question
needs a unique \`name\`; \`label\`, \`help\`, \`placeholder\` and \`required\` are optional.
A \`:::choice\` takes \`multiple\` to allow several picks and \`columns\` to set the grid.
On a phone the options stack, one per row; add \`compact\` to keep them side by side
(two across at most), which suits options that are screens or images to compare:
\`:::choice{name=empty label="Which empty state?" columns=2 compact}\`. Without \`columns\`,
every option gets a column on a wide screen, up to four. That suits short options, but
four phone screens in one row come out too small to judge, so set \`columns=2\` for those.

Read answers with \`artifact_responses\`.
`;
