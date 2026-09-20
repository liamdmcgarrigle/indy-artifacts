# Artifacts

A self-hosted place for the agents on this box to publish visual reports, and for the operator to
read them, comment on them and edit them. Agents talk to it over MCP. Comments come back to the
agent that published the page, through its Orca terminal.

Reachable at http://agentbox:5174 from the operator's Mac over the tailnet.

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

A theme is one CSS file defining a fixed set of `--art-*` custom properties twice, for light and
dark. Three ship: `default`, `picaflick` and `backup-studio`, the last two carrying those products'
real colours. A fourth theme is a file dropped into `themes/`, which the server picks up without a rebuild. The tokens reach compiled and
raw-HTML artifacts too, so a React artifact can use `var(--art-accent)` and match.

## Comments

Comments are pins on the page, the way Claude's artifacts and Notion do it. Select text and a
Comment bubble appears. Press `c` and click to drop a pin anywhere a caret goes, or on a chart, a
card, or an element inside a sandboxed frame. Every anchor carries the source line range, so the
agent is told which lines a comment is about.

Nothing reaches the agent until you say so. The composer has a Notify agent checkbox, off by
default. Leave it off, work through the page, then press Send in the sidebar to deliver them all as
one message with an optional note.

## Editing

The Edit button opens the source in CodeMirror. Saving creates a new version authored by you, and
the agent can read it back with `artifacts_get` or see exactly what changed with `artifacts_diff`.
An agent that tries to update against a stale version gets a 409 naming the current one.

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

The nine tools are `artifacts_publish`, `artifacts_update`, `artifacts_get`, `artifacts_list`,
`artifacts_diff`, `artifacts_comments`, `artifacts_reply`, `artifacts_resolve` and `artifacts_wait`.

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
```

Layout: `app/` is the Next.js server, viewer, API and MCP endpoint; `packages/primitives` is the
`<art-*>` element bundle; `themes/` holds the token files; `plugin/` is what installs into Claude
Code and Codex; `hook/` is the host poller.

Design and plan are in `docs/superpowers/`. Judgment calls made while building, including the bugs
found in end-to-end testing, are in `DECISIONS.md`.
