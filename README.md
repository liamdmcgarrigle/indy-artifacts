# Artifacts

A self-hosted place for the agents on this box to publish visual reports, and for the operator to
read them, comment on them and edit them. Agents talk to it over MCP. Comments come back to the
agent that published the page, through its Orca terminal.

Reachable at http://agentbox:5174 from the operator's Mac over the tailnet. A second process on
5175 holds the live documents, so you can watch an agent type into a page while it is open.

## What an artifact is

One page with a stable slug and an ordered list of immutable versions. Four kinds:

| kind | the agent sends | rendered as |
|---|---|---|
| `markdown` | one markdown document with frontmatter | real DOM in the trusted page; html and mermaid blocks in sandboxed frames |
| `react` | a files map with `App.tsx` | compiled at publish with esbuild, run in one sandboxed frame |
| `svelte` | a files map with `App.svelte` | the same, through the Svelte 5 compiler |
| `html` | one complete HTML document | served into one sandboxed frame with our CSP |

Markdown is the cheap path. Beyond ordinary markdown it understands a small set of blocks, so an
agent writes about thirty lines and gets a report:

````markdown
---
title: Backup run 2026-09-20
theme: backup-studio
---

:::kpis
- Files copied: 48,211
- Failed: 3 {tone=bad}
- Duration: 41 min (+2)
:::

:::callout{tone=warn title="Needs a look"}
The three failures are under a directory the backup user cannot read.
:::

```chart
type: bar
x: day
y: [photos, documents]
stacked: true
data:
  - { day: Mon, photos: 12, documents: 3 }
  - { day: Tue, photos: 15, documents: 4 }
```
````

The full vocabulary is `:::card`, `:::callout`, `:::kpis`, `:::columns` with `:::col`, `:::tabs`
with `:::tab`, `:::details`, and the fences `chart`, `table`, `mermaid` and `html`. It is documented
for agents in `plugin/skills/artifacts/reference.md` and served over MCP as `artifacts://reference`.

## Themes

A theme is one CSS file defining a fixed set of `--art-*` custom properties. Colour tokens are
declared twice, for light and dark; the shape of the design, meaning the type stack, the spacing
scale, the radii, the measure and the shadows, is declared once. Three themes ship: `default`,
`picaflick` and `backup-studio`, the last two carrying those products' real colours. A fourth theme
is a file dropped into `themes/`, which the server picks up without a rebuild.

Type comes from variable fonts served from the container, not from a CDN: Inter, Source Serif 4,
JetBrains Mono, Nunito Sans and Manrope, all under the Open Font License. Body copy sits in a serif
at a 68-character measure, headings in the theme's display face, and data blocks run wider than the
prose so a table or a chart uses the page. The tokens reach compiled and raw-HTML artifacts too, so
a React artifact can use `var(--art-accent)` and match.

## Comments

Comments are pins in the margin, the way Figma and Notion do it. Select text and a Comment bubble
appears. Press `c` and click to drop a pin anywhere a caret goes, or on a chart, a card, or an
element inside a sandboxed frame. The card opens on the spot: beside the caret, or under the
selection, lined up with the words it quotes, floating over the page rather than parked at the edge
of the window. It flips above the spot when there is no room below. Every anchor carries the source
line range, so the agent is told which lines a comment is about.

A pin holds its place when the text under it changes. The anchor stores the run of words around the
spot; if an edit means that run no longer appears, the resolver gives up characters from whichever
end changed until what is left matches again. A pin that had to guess is drawn hollow.

Nothing reaches the agent until you say so. The composer has a Notify agent checkbox, off by
default. Leave it off, work through the page, then press Send in the header to deliver them all as
one message with an optional note. The Threads button lists every comment when you want to go
through them in order, including any whose anchor no longer resolves.

## Editing

Hover any block on the page and a pencil appears in the margin. Press it and that block alone
becomes a text area holding its own source lines; save and only those lines are spliced into a new
version. Fixing one sentence does not mean opening the whole document and hunting for it.

The pencil is kept alive by where the pointer is rather than by what it entered and left, so setting
off to click it does not take it away.

The Edit button still opens the full source in CodeMirror for larger work. Saving creates a new
version authored by you, and the agent can read it back with `artifacts_get` or see exactly what
changed with `artifacts_diff`. An agent that tries to update against a stale version gets a 409
naming the current one.

## Live documents

A markdown artifact open in the editor is a shared document, held as a CRDT by the collaboration
server on 5175 and stored beside the versions in SQLite. Two browsers editing one artifact see each
other's carets and changes.

An agent joins the same document with `artifacts_type`, which types its text in a few characters at
a time rather than replacing the page. You watch the words arrive, with a chip naming the agent that
is writing them. Typing does not create a version on every keystroke: once the document has been
quiet for a couple of seconds the collaboration server asks the app to snapshot it, and only then,
and only if the text actually changed, does a new version appear.

Pages that are open but not being edited follow along too. The viewer holds a server-sent events
stream and redraws when the version number or the comments change, so a page left open on the Mac
does not go stale while an agent works on it.

## Running it

```bash
cp .env.example .env          # port, public URL, asset roots
podman build -t localhost/artifacts:latest .
docker compose up -d
```

Then install the host-side poller that carries comments into agent terminals:

```bash
cp hook/artifacts-hook.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now artifacts-hook
journalctl --user -u artifacts-hook -f
```

## Connecting an agent

```bash
claude plugin marketplace add /home/liam/work/artifacts
claude plugin install artifacts@artifacts-local --scope user

codex plugin marketplace add /home/liam/work/artifacts
codex plugin add artifacts@artifacts-local
```

Both get the same MCP server at `http://127.0.0.1:5174/mcp` and the same skill. Details and the
fallback commands are in `plugin/README.md`.

The ten tools are `artifacts_publish`, `artifacts_update`, `artifacts_type`, `artifacts_get`,
`artifacts_list`, `artifacts_diff`, `artifacts_comments`, `artifacts_reply`, `artifacts_resolve` and
`artifacts_wait`.

## Sandboxing

Anything an agent wrote that can execute runs in an `<iframe sandbox="allow-scripts">` with no
`allow-same-origin`, so it has an opaque origin: no cookies, no storage, no access to the page
around it, no credentialed requests. On top of that the frame gets
`default-src 'none'; connect-src 'none'; script-src 'self'`, sent as a header and repeated as a meta
tag so a same-document navigation cannot shed it. Markdown is sanitized before it reaches the
trusted page, and inline HTML in markdown is stripped rather than rendered.

Compiled artifacts may import only react, react-dom, svelte, chart.js, d3, lucide-react and their
own files. Anything else fails the build with a message naming the import, which comes straight back
in the tool result.

## Development

No toolchain on the host. Everything runs in a worker:

```bash
W_CACHE=artifacts spawn-worker docker.io/library/node:24-bookworm-slim "npm test"
W_CACHE=artifacts W_NET=bridge spawn-worker docker.io/library/node:24-bookworm-slim "npm install"
python3 -m unittest discover -s hook      # the poller runs on the host
docker compose -f compose.dev.yaml up -d  # dev server on 5176, its collab on 5177
```

The server is headless, so seeing the work means taking a picture of it:

```bash
./tools/shot tools/recipes/baseline.json /tmp/shots
```

That runs Playwright in a container against a recipe of URLs, each with a width, a colour scheme and
a list of steps to perform first, and writes a PNG and a `report.json` carrying any console errors.
It has already caught three things curl could not: artifacts that compiled and then rendered blank,
a page that stopped hydrating, and pins landing on the wrong line.

Layout: `app/` is the Next.js server, viewer, API and MCP endpoint; `collab/` is the document
server; `packages/primitives` is the `<art-*>` element bundle; `themes/` holds the token files;
`plugin/` is what installs into Claude Code and Codex; `hook/` is the host poller; `tools/` holds
the screenshot harness.

Design and plan are in `docs/superpowers/`. Judgment calls made while building, including the bugs
found in end-to-end testing, are in `DECISIONS.md`.
