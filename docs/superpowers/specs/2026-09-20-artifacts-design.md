# Artifacts: design spec

Date: 2026-09-20. Status: draft for operator review.

## 1. Purpose

A self-hosted artifact system for the coding agents on agentbox. An agent publishes a visual
report (a status page, a benchmark write-up, a UI mock, a data summary) with one tool call. The
operator opens it in a browser on the tailnet, reads it, leaves comments, optionally edits it, and
sends the feedback back to the agent that made it. Every publish and every human edit is a
version. Agent-written content renders inside a sandbox so a page can never touch the shell, the
operator's cookies, or another artifact.

It replaces the claude.ai artifact feature for this box, with no account or ecosystem dependency,
and it works for Claude Code and Codex alike because the agent-facing surface is one MCP endpoint
plus one skill, packaged as a plugin for both.

## 2. Goals and non-goals

Goals for version 1:

1. Publish from an agent with a single MCP tool call; get a URL back.
2. Markdown as the primary authoring format, with a small vocabulary of directives and fenced
   blocks for cards, KPIs, callouts, tabs, tables, charts and diagrams, so agents write short
   sources instead of HTML.
3. Two further authoring modes for when markdown is not enough: a React or Svelte component
   compiled at publish time, and a raw HTML document. All three run sandboxed.
4. Themes as swappable token files: `default`, `picaflick`, `backup-studio`. A theme applies to
   every mode, including compiled components and raw HTML.
5. Immutable versions with diff and optimistic locking.
6. Comments anchored to a block or a text selection, threaded, resolvable, with a "Notify agent"
   checkbox (off by default) and a "send all to agent" action, delivered into the agent's live
   terminal through Orca.
7. In-browser source editing by the operator; each save is a new version the agent can read back.
8. Screenshots and other files attached by host path, not by pasting bytes through the model.
9. One plugin directory installable into Claude Code and Codex from this repo.

Non-goals for version 1: user accounts and authentication, more than one human identity,
full-text search, PDF or Office rendering, real-time collaborative editing, WYSIWYG editing,
public exposure beyond the tailnet, Gemini plugin packaging.

## 3. Constraints from the box

- No language toolchains on the host. The app builds and runs in containers; tests run through
  `spawn-worker` with an explicit `node:24` image. The only host-side code is one Python 3 script
  (the hook poller), because `python3` is on the host and the Orca CLI is host-only.
- No stdio MCP servers: a stdio server would need Node on the host. The MCP endpoint is HTTP,
  served by the app itself.
- The viewer is reached at `http://agentbox:<port>` from the operator's Mac over the tailnet. The
  port must be in the firewall's tailnet range 5170 to 5199. Port `5174` is free today and is the
  default; `5170` to `5173` are taken.
- The Orca CLI works from a clean environment (verified with `env -i`), so a systemd user unit
  can call `orca terminal send`.
- aarch64 and 16 KB pages: every npm dependency with a native binary (esbuild) ships a
  `linux-arm64` build. No dependency may need a 4 KB-page native library.

## 4. Architecture

```
                 tailnet (operator's Mac)                       agentbox host
   ┌──────────────────────────────┐        ┌──────────────────────────────────────────┐
   │ browser: /a/<slug>            │        │ agents (Claude Code, Codex) in Orca       │
   │  shell (Next.js, trusted)     │        │   └─ plugin: skill + .mcp.json ─────┐    │
   │   ├─ rendered markdown        │        │                                     │    │
   │   ├─ <iframe sandbox> blocks  │        │ hook/artifacts-hook.py (systemd user)│    │
   │   └─ comments sidebar         │        │   polls /api/events, runs            │    │
   └───────────────┬───────────────┘        │   `orca terminal send`               │    │
                   │ http://agentbox:5174   └────────┬─────────────────────────────┼────┘
   ┌───────────────▼─────────────────────────────────▼─────────────────────────────▼────┐
   │ container "artifacts" (node:24, Next.js 16 standalone)                             │
   │   /a/*, /embed/*        viewer pages and sandboxed content documents               │
   │   /api/*                JSON API used by the shell and the hook poller             │
   │   /mcp                  MCP streamable HTTP endpoint (mcp-handler)                 │
   │   lib/pipeline          markdown -> sanitized HTML + block map                     │
   │   lib/build             esbuild child process for react/svelte artifacts           │
   │   lib/db                node:sqlite, file at /data/artifacts.db                    │
   │   /data/builds, /data/assets   per-version build output and copied assets         │
   │   /themes (ro mount)    default.css, picaflick.css, backup-studio.css + fonts      │
   │   /home/liam/work, /home/liam/orca (ro mounts)   asset source roots                │
   └────────────────────────────────────────────────────────────────────────────────────┘
```

One container, one process, one SQLite file. The Next.js app is the shell, the API, and the MCP
server. The markdown pipeline and the build service are plain TypeScript modules with no Next.js
dependency so they can be unit tested without a browser or a server.

### 4.1 Repository layout

```
artifacts/
  package.json                 npm workspaces: app, packages/*
  app/                         Next.js 16 application (server, viewer, API, MCP)
    src/app/                   routes (see section 8)
    src/lib/pipeline/          markdown -> html + blocks
    src/lib/build/             esbuild service for react/svelte kinds
    src/lib/db/                schema, migrations, queries
    src/lib/service/           artifact, version, comment, event operations (used by API and MCP)
    src/components/            shell UI (React)
    test/                      vitest tests and fixtures
  packages/primitives/         Lit custom elements <art-*> + primitives.css, built to one bundle
  themes/                      default.css, picaflick.css, backup-studio.css, fonts/
  plugin/                      the agent plugin (both manifests, .mcp.json, skills/)
  .claude-plugin/marketplace.json   local marketplace for Claude Code -> ./plugin
  .agents/plugins/marketplace.json  local marketplace for Codex -> ./plugin
  hook/                        artifacts-hook.py, artifacts-hook.service, README
  Dockerfile, compose.yaml, compose.dev.yaml, .env.example
  docs/superpowers/specs, docs/superpowers/plans
```

## 5. Artifact model

An artifact has a stable `slug` and an ordered list of immutable versions. The latest version is
what `/a/<slug>` shows.

Kinds:

| kind | source | rendered how |
|---|---|---|
| `markdown` | one markdown document with YAML frontmatter | trusted pipeline; `html` and `mermaid` blocks in sandbox frames |
| `react` | files map, entry `App.tsx` with a default export component | esbuild at publish, bundle runs in one sandbox frame |
| `svelte` | files map, entry `App.svelte` | esbuild + esbuild-svelte at publish, bundle runs in one sandbox frame |
| `html` | one complete HTML document | one sandbox frame, served as-is with an injected CSP |

Frontmatter (markdown kind) or the equivalent tool arguments (other kinds):

```yaml
title: Backup run 2026-09-20      # required
theme: backup-studio              # default | picaflick | backup-studio; default "default"
project: backup-studio            # optional grouping label shown in the index
description: Nightly run summary  # optional one line for the index
tags: [backup, nightly]           # optional
```

Agent identity is not in the frontmatter. The publish tool takes an `agent` object
(`name`, `terminal`, `session`) and the server stores it on the artifact; the skill tells the
agent to read `ORCA_TERMINAL_HANDLE` and `CLAUDE_CODE_SESSION_ID` from its shell before the first
publish. An update may replace the agent identity, so a different session can take an artifact
over.

Slugs are lower-case `[a-z0-9-]{3,64}`. If the agent omits one, the server derives it from the
title and appends a four-character random suffix. Slugs never change.

Assets: a publish or update may list `assets: [{ name, path }]`. `path` is an absolute host path
under one of `ARTIFACTS_ASSET_ROOTS` (default `/home/liam/work:/home/liam/orca:/tmp`), which the
container mounts read-only. The server copies the file to `/data/assets/<artifact>/<version>/<name>`
and serves it at `/a/<slug>/v/<n>/assets/<name>`. Markdown references it as `assets/<name>`. Assets
carry forward: an update that does not list `assets` keeps the previous version's set. Limits:
20 MB per file, `name` matches `[A-Za-z0-9._-]{1,80}`, content type from the extension, only
`png jpg jpeg gif webp svg mp4 webm json csv txt` allowed.

## 6. Markdown vocabulary

Standard GFM (headings, lists, tables, code, links, images, task lists, footnotes off) plus the
blocks below. Everything else in the pipeline is data; no agent-written script runs in the
trusted shell.

### 6.1 Container directives

Syntax is remark-directive's `:::name{attrs}` ... `:::`. Nesting is allowed.

| directive | attributes | renders |
|---|---|---|
| `:::card` | `title`, `subtitle` | `<art-card>` with a header and the inner content |
| `:::callout` | `tone` = `info` (default), `good`, `warn`, `bad`; `title` | `<art-callout>` |
| `:::kpis` | none; body is a bullet list of `Label: value`, optional `{tone=good}` per item, optional trailing `(delta)` | `<art-kpis>` of `<art-kpi>` tiles |
| `:::columns` with `:::col` children | `columns` takes `n` (2 to 4, default 2) | CSS grid |
| `:::tabs` with `:::tab{label="..."}` children | | `<art-tabs>` |
| `:::details` | `summary` | native `<details>` styled |
| `:::html` | none; body is raw HTML | sandbox frame (same as the `html` fence) |

### 6.2 Fenced blocks

| fence | body | renders |
|---|---|---|
| ```` ```chart ```` | YAML: `type` (bar, line, area, pie, doughnut, scatter), `title`, `x`, `y` (a key or a list of keys), `data` (list of objects), `stacked` (bool), `unit` (string suffix), `height` (px, default 280) | `<art-chart>` driven by Chart.js in the trusted shell; palette from theme tokens |
| ```` ```table ```` | CSV with a header row, or YAML `columns` + `rows`; first line may be `# sortable` | `<art-table>` (sortable, sticky header) |
| ```` ```mermaid ```` | mermaid source | sandbox frame that loads the vendored mermaid build |
| ```` ```html ```` | raw HTML fragment or document | sandbox frame |

A block that fails validation (unknown chart type, malformed YAML, CSV with ragged rows) renders
an inline error box in the page and is reported back to the agent in the publish result as
`warnings: [{ line, message }]`. Publishing still succeeds; the agent decides whether to fix it.

### 6.3 Block identity and anchors

The pipeline assigns every top-level block (paragraph, heading, list, directive, fence) an id
`b<index>` and records its source line range. Both are emitted as `data-block` and `data-lines`
attributes on the rendered element. Comments anchor to `{ block, quote?, lines }`. A `quote` is
the selected text; when the anchor's block no longer contains the quote on a later version the
sidebar shows the comment as "anchor moved" and still lists it.

## 7. Rendering and sandboxing

### 7.1 Trusted tier

unified pipeline: `remark-parse` → `remark-frontmatter` (yaml) → `remark-gfm` → `remark-directive`
→ `artifactsDirectives` (maps directives and fences to hast nodes for `<art-*>` elements and
sandbox placeholders) → `remark-rehype` (`allowDangerousHtml: false`) → `rehype-sanitize` with the
GitHub schema extended to allow the `art-*` tag names, their declared attributes, `data-block`,
`data-lines`, `data-chart` (JSON) and `data-table` (JSON) → `rehype-stringify`.

Raw HTML written inline in markdown (outside an `html` block) is stripped by the sanitizer; that
is the documented behaviour, and the `html` fence is the documented escape hatch.

The shell page inserts the HTML with React's `dangerouslySetInnerHTML` (safe because the string is
sanitized output of our own pipeline) and mounts the primitives bundle, which upgrades the
`<art-*>` elements. Charts read their spec from `data-chart` and render with Chart.js on the
client. Nothing in the artifact source can inject a script, an event handler attribute, a
`javascript:` URL or a style tag into the shell.

### 7.2 Sandbox tier

Sandbox frames are `<iframe sandbox="allow-scripts" src="/embed/<slug>/<n>/<block>">`. Without
`allow-same-origin` the frame has an opaque origin: no cookies, no storage, no access to the
parent document, and requests from it carry no credentials. The embed route sets:

```
Content-Security-Policy: default-src 'none'; script-src 'self' 'unsafe-inline';
  style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';
  media-src 'self' blob:; connect-src 'none'; form-action 'none'; base-uri 'none';
  frame-ancestors 'self'; sandbox allow-scripts
```

The same policy is injected as a `<meta http-equiv>` at the top of the document so a
`srcdoc`-style navigation cannot shed it. `'self'` is the app origin, which serves the vendored
mermaid build, the primitives bundle, theme CSS, fonts, per-version build output and assets.
External CDNs are blocked by design; an artifact that needs a library that is not vendored fails
visibly, and the fix is to vendor it.

Frame height: the embed document posts `{ type: "art:height", px }` to the parent on load and on
resize; the shell sizes the iframe. Compiled kinds may also post `{ type: "art:title", text }`.

The embed document for `mermaid` and `html` blocks, and for `react`, `svelte` and `html` kinds,
includes `<link rel="stylesheet" href="/themes/<theme>.css">` and `/primitives/primitives.css`,
sets `data-scheme` from the shell's current scheme (passed as a query parameter), and for the
compiled kinds loads `/primitives/primitives.js` before the artifact bundle so `<art-*>` elements
work inside agent components.

### 7.3 Compiled kinds

At publish time the build service writes the files map to a temp dir and runs esbuild in a child
process (`node app/build-worker.mjs`, timeout 20 s, killed on overrun) with:

- `bundle: true`, `format: "esm"`, `target: "es2022"`, `minify: true`, `sourcemap: "inline"` for
  dev builds only, `jsx: "automatic"` for react, `esbuild-svelte` with
  `compilerOptions: { css: "injected" }` for svelte, `mainFields`/`conditions` per the plugin docs.
- A resolve plugin that allows only the curated import list and rejects everything else with a
  message naming the offending import and the allowed set. Curated list, version-pinned in
  `app/package.json`: `react`, `react-dom`, `react-dom/client`, `svelte`, `svelte/store`,
  `chart.js`, `chart.js/auto`, `d3`, `lucide-react`, `@artifacts/primitives`, and relative
  imports within the files map. No `node:` modules, no `fs`, no `fetch` to anywhere (blocked by
  CSP at run time anyway).
- The entry is wrapped: for react, `createRoot(document.getElementById("root")).render(<App/>)`;
  for svelte, `mount(App, { target: document.getElementById("root") })` (Svelte 5 API).
- Output limit 5 MB. Output goes to `/data/builds/<artifact>/<n>/bundle.js` and `bundle.css`.

Build failure: the version is still stored with `build_status = "error"` and the esbuild log in
`build_log`, so the human can see the source and the error in the viewer; the tool result returns
the log with file and line. The artifact's `current_version` still advances (the previous version
remains viewable from the version list).

### 7.4 Themes

A theme is one CSS file in `themes/` defining the token contract twice: on `:root` for light and
on `[data-scheme="dark"]` for dark, each with `color-scheme`. The shell chooses the scheme from
the operator's OS preference with a manual toggle stored in localStorage; the choice is passed to
sandbox frames as `?scheme=`.

Token contract (every theme defines all of these):

```
--art-bg  --art-surface  --art-surface-2  --art-border  --art-border-strong
--art-text  --art-text-muted  --art-text-faint
--art-accent  --art-accent-hover  --art-accent-wash  --art-on-accent  --art-link
--art-good  --art-good-wash  --art-warn  --art-warn-wash  --art-bad  --art-bad-wash  --art-info  --art-info-wash
--art-font-sans  --art-font-mono  --art-font-size  --art-radius  --art-radius-lg  --art-shadow
--art-chart-1 .. --art-chart-6
```

Theme values:

- `default`: neutral. Light: bg `#F7F7F5`, surface `#FFFFFF`, surface-2 `#F0F0EE`, border
  `#E3E3E0`, text `#1B1B1A`, muted `#5F5F5B`, accent `#2563EB`, good `#15803D`, warn `#B45309`,
  bad `#B91C1C`, info `#1D4ED8`, sans `system-ui, -apple-system, "Segoe UI", sans-serif`, mono
  `ui-monospace, Menlo, monospace`, radius 8px / 12px, chart palette
  `#2563EB #0D9488 #D97706 #7C3AED #DB2777 #64748B`. Dark: bg `#111113`, surface `#1A1A1E`,
  surface-2 `#232329`, border `#2E2E36`, text `#EDEDEF`, muted `#A0A0A8`, accent `#5B8DEF`.
- `picaflick`: dark-first, from `frontend/lib/theme/app_colors.dart`. Dark (its native scheme):
  bg `#000000`, surface `#0D1117`, surface-2 `#151B23`, border `rgba(255,255,255,0.08)`, text
  `#FFFFFF`, muted `rgba(255,255,255,0.70)`, faint `rgba(255,255,255,0.45)`, accent `#2A71CE`,
  accent-hover `#5A9AE6`, accent-wash `rgba(42,113,206,0.15)`, good `#4CAF7D`, warn `#E5A84C`,
  bad `#E55050`, info `#5A9AE6`, sans `"Nunito Sans", system-ui, sans-serif`, radius 12px / 16px.
  Light: bg `#F4F7FB`, surface `#FFFFFF`, surface-2 `#E9EEF5`, border `rgba(13,17,23,0.10)`, text
  `#0D1117`, muted `rgba(13,17,23,0.70)`, same accent and semantic colours. Nunito Sans is loaded
  from Google Fonts in the shell only; the sandbox falls back to the system stack.
- `backup-studio`: from `packages/ui/src/tokens.css`, mapped one to one: bg=paper `#F3EEE4`,
  surface=card `#FAF7F1`, surface-2=fill `#EDE6D9`, border=rule `#DDD5C6`, border-strong=hair
  `#E8E1D4`, text=ink `#22201C`, muted `#6F685A`, accent=primary `#5D0B0B`, accent-hover
  `#4A0909`, accent-wash `#F0DDD9`, on-accent `#F3EEE4`, link `#5D0B0B`, good=success `#395D0B`,
  good-wash `#E3E8D6`, warn=attention `#5D0B0B`, warn-wash `#F0DDD9`, bad `#5D0B0B`, radius 8px /
  10px, shadow as in the source, sans `"Manrope", "Helvetica Neue", Arial, sans-serif`, mono
  `"DM Mono", Menlo, Consolas, monospace`. Dark values are the `.dark` block of the same file
  (paper `#1C1916`, card `#262220`, fill `#302A26`, ink `#F1EBE0`, muted `#A79E90`, rule
  `#3D3631`, primary `#7A1C1C`, success `#4A7413`, attention `#E39C96`). The Manrope and DM Mono
  woff2 files are copied into `themes/fonts/` (both are OFL licensed) and referenced with
  `@font-face`.

The primitives stylesheet uses only tokens, so a fourth theme is a new file and nothing else.

## 8. Routes

Pages (React, app router):

| route | purpose |
|---|---|
| `/` | index: artifacts grouped by project, latest version, open comment count |
| `/a/<slug>` | latest version |
| `/a/<slug>/v/<n>` | pinned version; `?diff=<m>` shows a side-by-side source diff against version m |
| `/a/<slug>/edit` | CodeMirror 6 source editor for the latest version; Save creates a version with `author_kind = "human"` |
| `/embed/<slug>/<n>/<block>` | sandbox document for one block, or `<block> = page` for compiled and html kinds |

API (JSON, no auth in version 1):

| method and path | body / query | result |
|---|---|---|
| `GET /api/artifacts` | `?project=` | list |
| `POST /api/artifacts` | publish payload (section 9) | `{ slug, version, url, warnings }` |
| `GET /api/artifacts/<slug>` | | artifact + latest version metadata |
| `PUT /api/artifacts/<slug>` | update payload with `expected_version` | `{ version, url, warnings }` or 409 `{ current_version }` |
| `GET /api/artifacts/<slug>/versions` | | version list |
| `GET /api/artifacts/<slug>/versions/<n>` | | source, files, frontmatter, build status and log |
| `GET /api/artifacts/<slug>/diff` | `?from=&to=` | unified diff text |
| `GET /api/artifacts/<slug>/comments` | `?status=open|resolved|all` | threads |
| `POST /api/artifacts/<slug>/comments` | `{ body, parent_id?, anchor?, author_name, notify: bool }` | comment |
| `PATCH /api/comments/<id>` | `{ status }` or `{ body }` (own comments only) | comment |
| `POST /api/artifacts/<slug>/send` | `{ message? }` | creates one `feedback.sent` event with every unsent open comment |
| `GET /api/events` | `?after=<id>&wait=<s>` (long-poll up to 25 s) | events |
| `POST /api/events/<id>/ack` | | marks delivered |
| `GET /api/themes` | | theme names |

`ARTIFACTS_PUBLIC_URL` (default `http://agentbox:5174`) is the base for every `url` the server
returns.

## 9. MCP endpoint

`app/src/app/mcp/route.ts` mounts `createMcpHandler` from mcp-handler 2.x (MCP SDK v2, zod 4)
and exports it as `GET` and `POST`. Tools call the same service layer as the API.

| tool | input | output |
|---|---|---|
| `artifacts_publish` | `title`, `kind` (default markdown), `slug?`, `theme?`, `project?`, `description?`, `tags?`, `source?` (markdown or html document), `files?` (map for react/svelte), `assets?`, `message?`, `agent?: { name, terminal, session }` | `{ slug, version, url, warnings, build_status, build_log? }` |
| `artifacts_update` | `slug`, `expected_version`, plus any of `source`, `files`, `assets`, `title`, `theme`, `message`, `agent` | same as publish, or an error naming the current version |
| `artifacts_get` | `slug`, `version?` | frontmatter, source or files, `author_kind`, `author_name`, `message`, `build_status`, `build_log`, `url` |
| `artifacts_list` | `project?`, `limit?` | `[ { slug, title, kind, theme, project, current_version, open_comments, url } ]` |
| `artifacts_diff` | `slug`, `from`, `to` | unified diff |
| `artifacts_comments` | `slug`, `status?` (default open) | threads with `anchor.lines`, `anchor.quote`, `sent` flag |
| `artifacts_reply` | `comment_id`, `body`, `agent?` | comment; the reply is marked `author_kind = "agent"` |
| `artifacts_resolve` | `comment_id` | comment |
| `artifacts_wait` | `slug`, `after?` (event id from a previous result), `timeout_s` (max 55) | `{ events, last_id }` for that artifact with id greater than `after`, or `{ events: [], last_id }` on timeout |

Validation errors come back as MCP tool errors with a one-line reason. Markdown block warnings
are returned in `warnings` and do not fail the call. The `blocks` reference (section 6) is also
exposed as an MCP resource `artifacts://reference` so a client that supports resources can read
it without the skill.

## 10. Comments, notification and hooks

### 10.1 Comment UI

Right sidebar on every artifact page. A comment is created either from a text selection (the
shell shows a "Comment" bubble on mouse-up inside the rendered content; anchor gets `block`,
`quote`, `lines`) or from a block's hover toolbar (anchor gets `block` and `lines`), or unanchored
from the sidebar's composer. Threads show author, time, version, anchor excerpt, replies, and a
Resolve toggle. Clicking an anchored thread scrolls to and highlights the block.

The composer has a "Notify agent" checkbox, off by default. Off means the comment is saved and
listed with an "unsent" badge. On means a `comment.created` event is written immediately for that
one comment. The sidebar header shows "Send N comments to agent" whenever unsent open comments
exist; clicking it opens a one-line optional message ("done reviewing, please address all of
these") and writes one `feedback.sent` event carrying every unsent comment, then marks them sent.

The commenter's display name is asked for once and kept in localStorage.

### 10.2 Events

`events` rows are the outbox. Kinds: `comment.created` (single comment, notify checked),
`feedback.sent` (batch with optional message), `version.created` with `author_kind = "human"`
(an edit from the browser). Agent-authored comments and versions never produce events.

### 10.3 Delivery

`hook/artifacts-hook.py` runs as a systemd user unit on the host. It long-polls
`GET /api/events?after=<last>&wait=25`, and for each event:

1. Loads the artifact's `terminal_handle`. If none, acks the event with `delivered_at` set and a
   note `no-terminal` and moves on.
2. Formats a message. For a comment: `[artifacts] Comment on "<title>" v<n> (<url>) lines
   <a>-<b>: "<quote>" — <author>: <body>. Use artifacts_comments to see all open comments.` For a
   batch: one line per comment under a header line with the operator's message. For an edit:
   `[artifacts] <author> edited "<title>", now v<n> (<url>). Use artifacts_get or artifacts_diff
   from=<n-1> to=<n>.`
3. Runs `orca terminal send --terminal <handle> --text "<message>" --enter --json`. On success
   acks the event. On failure (terminal gone) it retries on the next poll up to three times, then
   acks with note `undeliverable`; the comment stays visible in the UI and the agent can still
   pull it with `artifacts_comments`.

State (`last event id`) is kept in `~/.local/state/artifacts/hook.json`. The unit restarts on
failure and starts after `orca.service`.

Claude Code channels and `claude -p --resume` are not used in version 1. The `session_id` is
stored so a later version can add "resume the session if the terminal is gone".

## 11. Data model

SQLite via `node:sqlite` (Node 24, release candidate stability, no flag). `STRICT` tables, WAL
mode, foreign keys on. Migrations are numbered SQL files applied at startup.

```sql
CREATE TABLE artifacts (
  id TEXT PRIMARY KEY,               -- nanoid(12)
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('markdown','react','svelte','html')),
  theme TEXT NOT NULL DEFAULT 'default',
  project TEXT,
  description TEXT,
  tags_json TEXT NOT NULL DEFAULT '[]',
  agent_name TEXT, terminal_handle TEXT, session_id TEXT,
  current_version INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  number INTEGER NOT NULL,
  author_kind TEXT NOT NULL CHECK (author_kind IN ('agent','human')),
  author_name TEXT NOT NULL,
  message TEXT,
  frontmatter_json TEXT NOT NULL,
  source TEXT,                       -- markdown or html document
  files_json TEXT,                   -- react/svelte files map
  assets_json TEXT NOT NULL DEFAULT '[]',   -- [{name, size, type}]
  build_status TEXT NOT NULL DEFAULT 'none' CHECK (build_status IN ('none','ok','error')),
  build_log TEXT,
  warnings_json TEXT NOT NULL DEFAULT '[]',
  content_hash TEXT NOT NULL,        -- sha256 of source or files_json
  created_at TEXT NOT NULL,
  UNIQUE (artifact_id, number)
) STRICT;

CREATE TABLE comments (
  id TEXT PRIMARY KEY,               -- nanoid(12)
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  version_number INTEGER NOT NULL,
  parent_id TEXT REFERENCES comments(id),
  author_kind TEXT NOT NULL CHECK (author_kind IN ('agent','human')),
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  anchor_json TEXT,                  -- {block, quote?, lines:[start,end]}
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  sent_at TEXT,                      -- null until notified or batched
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artifact_id TEXT NOT NULL REFERENCES artifacts(id),
  kind TEXT NOT NULL CHECK (kind IN ('comment.created','feedback.sent','version.created')),
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT, delivery_note TEXT
) STRICT;
```

`artifacts_wait` and the hook poller both read `events`; `delivered_at` is only set by the hook
poller, and `artifacts_wait` uses the `after` cursor the agent passes back.

## 12. Plugin

`plugin/` is one directory that both plugin systems accept:

```
plugin/
  .claude-plugin/plugin.json    { "name": "artifacts", "version": "0.1.0", "description": "Publish and review visual artifacts on agentbox" }
  .codex-plugin/plugin.json     same fields
  .mcp.json                     { "mcpServers": { "artifacts": { "type": "streamable-http", "url": "http://127.0.0.1:5174/mcp" } } }
  skills/artifacts/SKILL.md     when to publish an artifact, the workflow, identity, waiting for feedback
  skills/artifacts/reference.md the block vocabulary with one example per block, the three kinds, themes, limits
  README.md                     install steps for Claude Code and Codex
```

`streamable-http` is accepted by Claude Code as an alias of `http` and is the required value in
the Codex plugin MCP schema, so one file serves both. Skills are discovered from `skills/` by both
systems without a manifest field.

Local marketplaces: `.claude-plugin/marketplace.json` at the repo root lists `./plugin` for
`claude plugin marketplace add ~/work/artifacts` then `claude plugin install artifacts@artifacts-local
--scope user`. `.agents/plugins/marketplace.json` lists the same for `codex plugin marketplace add
~/work/artifacts` then `codex plugin add artifacts@artifacts-local`. Exact marketplace names and
install commands are verified on the box during implementation and recorded in
`plugin/README.md`.

The skill tells the agent to: read its terminal handle and session id once; publish with
`artifacts_publish`; put the returned URL in its reply and, when running under Orca, call
`orca open-url --url <url>` so the artifact opens on the operator's client; check
`artifacts_comments` when the operator says they have reviewed, or use `artifacts_wait` when told
to wait; reply and resolve threads it has addressed; use `artifacts_update` with the
`expected_version` from its last call and re-read with `artifacts_get` if it gets a version
conflict, because the operator may have edited.

## 13. Deployment

- `Dockerfile`: multi-stage on `node:24-bookworm-slim`. Stage 1 installs workspaces with
  `npm ci`, builds `packages/primitives`, runs `next build` with `output: "standalone"`. Stage 2
  copies `.next/standalone`, `.next/static`, `public`, the primitives bundle, and the build
  worker, and keeps `node_modules` for the curated runtime packages the build service resolves
  (`react`, `react-dom`, `svelte`, `chart.js`, `d3`, `lucide-react`, `esbuild`, `esbuild-svelte`).
  Runs as uid 1000.
- `compose.yaml`: service `artifacts`, `ports: ["5174:5174"]`, `environment: HOSTNAME=0.0.0.0
  PORT=5174 ARTIFACTS_PUBLIC_URL ARTIFACTS_DATA=/data ARTIFACTS_THEMES=/themes
  ARTIFACTS_ASSET_ROOTS`, volumes `./data:/data:Z`, `./themes:/themes:ro,Z`,
  `/home/liam/work:/home/liam/work:ro`, `/home/liam/orca:/home/liam/orca:ro`, `/tmp:/tmp:ro`,
  `mem_limit: 1g`, `restart: unless-stopped`.
- `compose.dev.yaml`: same mounts, runs `next dev --hostname 0.0.0.0 --port 5174` with
  `allowedDevOrigins: ["agentbox", "agentbox.taila42e4e.ts.net", "100.100.43.42"]` in
  `next.config.ts`, bind-mounts the source.
- Hook: `hook/artifacts-hook.service` installed to `~/.config/systemd/user/`, `After=orca.service`,
  `Restart=on-failure`, `ExecStart=/usr/bin/python3 %h/work/artifacts/hook/artifacts-hook.py`.
- Tests and builds on the box run through the worker: `W_CACHE=artifacts W_NET=bridge
  spawn-worker docker.io/library/node:24-bookworm-slim "npm ci && npm test"`.

## 14. Testing

- Pipeline unit tests (vitest): every directive and fence has a fixture markdown file and an
  expected HTML snapshot; a fixture with inline `<script>`, `onclick`, `javascript:` links and a
  `<style>` tag proves the sanitizer strips them; block ids and line ranges are asserted; invalid
  chart and table bodies produce warnings with the right line numbers.
- Build service tests: a React fixture and a Svelte fixture compile to a bundle under the size
  limit; a fixture importing `fs` and one importing `lodash` fail with the allowlist message; a
  fixture with an infinite loop in a build-time expression is not possible in esbuild, so the
  timeout is tested by pointing the worker at a script that sleeps.
- Service and API tests: publish, update with correct and stale `expected_version`, human edit,
  comment with and without notify, send batch, events feed and ack, diff. Run against a temp
  SQLite file.
- MCP tests: call the route handler with `Request` objects for `initialize`, `tools/list`, and
  each tool once.
- Hook poller: a Python unit test with a fake HTTP server and a fake `orca` on `PATH` that records
  its arguments.
- Manual acceptance on the box, recorded in the plan: publish the three kinds from a Claude Code
  session via the installed plugin, view them from the Mac at `http://agentbox:5174`, comment,
  send, and see the message arrive in the agent's terminal; repeat the publish step from Codex.

## 15. Limits and errors

| limit | value |
|---|---|
| source size | 1 MB |
| files map | 40 files, 2 MB total |
| asset | 20 MB each, 30 per version |
| build time | 20 s, then killed |
| build output | 5 MB |
| comment body | 20 KB |
| `artifacts_wait` timeout | 55 s |

Every API error is `{ error: { code, message } }` with a 4xx status; MCP tool errors carry the
same message. Version conflicts are 409 with `current_version`.

## 16. Open items deferred past version 1

- Authentication and per-viewer identity (needed before anything beyond the tailnet).
- Delivery to a session whose terminal is gone (`claude -p --resume`, Orca dispatch).
- Claude Code channels as a push path once the preview allows non-Anthropic channels.
- A fourth theme for slopshop; WYSIWYG editing; search; PDF export.
- Vega-Lite as a richer chart escape hatch.
