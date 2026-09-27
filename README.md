# Indy

A self-hosted home for the pages your coding agents make. An agent publishes a report, a plan or a
form over MCP; you read it in the browser, edit it in place, pin comments on the exact spot, and
send your notes back to the agent. When a page is ready for someone else, you share a link.

It runs as one container with one port and one volume, for one owner.

A page is markdown with cards, callouts, number tiles, charts, tables, tabs and columns, or a
compiled React, Svelte or HTML app in a sandbox. Comment pins sit on the words or the element they
are about, and nothing reaches the agent until you press Send. Editing happens on the page itself:
text, titles, number tiles, chart data and form questions are typed into in place. Saving writes a
new version, and blocks you did not touch keep their markdown byte for byte. Every version stays,
so you can step back through them and compare any two.

Pages can also ask questions. An agent puts a form on a page, you or whoever you share it with
answer, and the agent reads the responses. Pages are private until you share them, either with
anyone who has the link or only with people who confirm their email with a code. A visitor's
comments and answers wait for you before any agent sees them.

## Running Indy

You need Docker (or Podman) with Compose, and a machine that stays on.

### 1. Start it

```bash
mkdir indy && cd indy
curl -fsSLO https://raw.githubusercontent.com/liamdmcgarrigle/indy-artifacts/main/compose.yaml
curl -fsSL https://raw.githubusercontent.com/liamdmcgarrigle/indy-artifacts/main/.env.example -o .env
```

Open `.env` and set `INDY_URL` to the address you will open Indy at, for example
`http://192.168.1.20:1936` on a home network or `https://indy.example.com` on a server. Then:

```bash
docker compose up -d
```

### 2. Create your account

Open `INDY_URL` in a browser. A fresh install goes straight to setup, where you create the one
account. Until you do, anyone who can reach the address can create it, so do this right after the
first start. If someone else gets there first, remove the data and start again:

```bash
docker compose down -v
docker compose up -d
```

The last setup step makes a token for your first agent and shows the command to connect it.

### 3. Connect an agent

Indy's Connect page (`<INDY_URL>/connect`, and the last step of setup) walks through this with your
address filled in, and shows when the agent reaches Indy.

Agents connect over MCP at `<INDY_URL>/mcp` and sign in through the browser with OAuth: the agent
opens Indy, you approve it, and nothing needs copying. For Claude Code:

```bash
claude mcp add --transport http --scope user indy https://indy.example.com/mcp
# then in Claude Code: /mcp, pick indy, Authenticate
```

For Codex, which starts the sign-in by itself:

```bash
codex mcp add indy --url https://indy.example.com/mcp
```

Claude Code only signs in this way when Indy is on HTTPS. On plain HTTP, or on a machine with no
browser, make a token on the Connect page and pass it as a header instead. Settings › Agents lists
every connected agent and disconnects any one of them.

The optional Indy plugin adds two skills, `publish` for making pages and `feedback` for picking up
your comments, and tells the agent at the start of each session that Indy is there:

```bash
claude plugin marketplace add liamdmcgarrigle/indy-artifacts && claude plugin install indy@indy
codex plugin marketplace add liamdmcgarrigle/indy-artifacts && codex plugin add indy@indy
```

Any other MCP client takes `<INDY_URL>/mcp` over streamable HTTP, and either discovers the OAuth
sign-in from it or sends a token in an `Authorization: Bearer` header. claude.ai and Claude Desktop
can add it as a custom connector when Indy is on a public HTTPS address. The server describes its own tools and serves the full block
reference as `indy://reference`, so an agent can learn the format without the plugin. The tools are
`artifact_publish`, `artifact_update`, `artifact_type`, `artifact_get`, `artifact_list`,
`artifact_diff`, `artifact_comments`, `artifact_reply`, `artifact_resolve`, `artifact_wait` and
`artifact_responses`.

### HTTPS

Anything reachable from the internet should be on HTTPS: sign-in cookies are only marked Secure
when `INDY_URL` starts with `https://`.

To use the bundled Caddy, point a domain's DNS at the server, open ports 80 and 443, and add to
`.env`:

```bash
INDY_URL=https://indy.example.com
INDY_DOMAIN=indy.example.com
INDY_BIND=127.0.0.1
```

Then start with the `https` profile. Caddy gets the certificate and renews it on its own.

```bash
docker compose --profile https up -d
```

If you already run a proxy, forward everything to port 1936. It has to pass websockets on `/collab`
(live editing) and must not buffer responses on `/api/live`, which keeps open pages up to date.
For nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:1936;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
    proxy_buffering off;
    proxy_read_timeout 1h;
}
```

On a tailnet or a home network, plain HTTP is fine and nothing else is needed.

### Settings

Everything is an environment variable in `.env`. Only `INDY_URL` is required.

| Variable | Default | What it does |
|---|---|---|
| `INDY_URL` | `http://localhost:1936` | The address people open Indy at. Share links, agent snippets and cookies are built from it. |
| `INDY_PORT` | `1936` | The host port. |
| `INDY_BIND` | `0.0.0.0` | The host address the port is published on. Use `127.0.0.1` behind a proxy. |
| `INDY_DOMAIN` | | The domain Caddy gets a certificate for, with `--profile https`. |
| `RESEND_API_KEY` | | Turns on email, through [Resend](https://resend.com). See below. |
| `INDY_EMAIL_FROM` | `Indy <onboarding@resend.dev>` | The sender for emails. |
| `INDY_AUTH` | `password` | `local` skips sign-in and treats every request as you. Only for an install nobody else can reach. |
| `INDY_ASSET_ROOTS` | | Colon-separated folders a page may load images from by absolute path. Each must also be mounted into the container. |
| `INDY_IMAGE` | `ghcr.io/liamdmcgarrigle/indy-artifacts:latest` | The image to run. Pin a release such as `:1.2` to update on your own schedule. |

Older installs that still set `ARTIFACTS_PUBLIC_URL`, `ARTIFACTS_DATA` and the other `ARTIFACTS_*`
names keep working; each is read when its `INDY_*` name is not set.

For anything compose itself does not expose, such as mounting a folder of screenshots for
`INDY_ASSET_ROOTS`, put it in a `compose.override.yaml` next to `compose.yaml`. Compose merges it in
on every command. `compose.override.example.yaml` in this repo shows the shape.

### Email

Email is optional. Without it Indy works fully, apart from two things that need it:

- a sign-in code as a second step after your password, and
- share links that ask visitors to confirm their email before opening a page.

Set `RESEND_API_KEY` to turn both on. Resend's shared test sender only delivers to the address on
your own Resend account, which is enough for sign-in codes. To email visitors, verify a domain with
Resend and set `INDY_EMAIL_FROM` to an address on it.

### Storage and images

Indy limits its own disk use to 5 GB by default. Once the data folder reaches the limit, agents
can't publish or update pages and get a message explaining why. Reading, comments and sharing
still work. You can raise the limit or remove it under Settings › Data, which also shows what is
using the space.

Images an agent attaches are compressed as they are stored. They are scaled to fit 2560 px on the
longest side, re-encoded at quality 80 in their own format (a PNG stays a PNG), and stripped of
EXIF data. GIFs and SVGs are stored as they are. You can change all of this under Settings › Data
or turn compression off. Changes apply only to images attached afterwards.

### Updating

```bash
docker compose pull
docker compose up -d
```

Your data lives in the `indy-data` volume and is untouched by updates. Database changes are applied
automatically on start.

### Backups

Everything is in the `indy-data` volume: one SQLite database plus uploaded assets. Stop Indy for a
moment so the database is consistent, archive the volume, and start it again:

```bash
docker compose stop indy
docker run --rm -v indy_indy-data:/data:ro -v "$PWD":/backup alpine \
  tar czf /backup/indy-$(date +%F).tgz -C /data .
docker compose start indy
```

To restore, into a fresh install before its first start:

```bash
docker volume create indy_indy-data
docker run --rm -v indy_indy-data:/data -v "$PWD":/backup alpine \
  sh -c "tar xzf /backup/indy-2026-09-26.tgz -C /data && chown -R 1000:1000 /data"
docker compose up -d
```

The volume name is the project folder's name followed by `_indy-data`; `docker volume ls` shows it.

### Building the image yourself

```bash
git clone https://github.com/liamdmcgarrigle/indy-artifacts
cd indy-artifacts
docker build -t indy:local .
```

Then set `INDY_IMAGE=indy:local` in `.env`. Published images are built for `linux/amd64` and
`linux/arm64` by `.github/workflows/image.yml`: `:latest` follows `main`, and a `v1.2.3` tag
publishes `:1.2.3`, `:1.2` and `:1`.

## What a page is

A page has a stable address and an ordered list of versions that never change once written. There
are four kinds:

| kind | the agent sends | shown as |
|---|---|---|
| `markdown` | one markdown document with frontmatter | the page itself, with HTML and Mermaid blocks in sandboxed frames |
| `react` | a map of files with `App.tsx` | compiled on publish with esbuild, run in one sandboxed frame |
| `svelte` | a map of files with `App.svelte` | the same, through the Svelte 5 compiler |
| `html` | one complete HTML document | one sandboxed frame |

Markdown is the cheap path. Beyond ordinary markdown it understands a small set of blocks, so an
agent writes thirty lines and gets a report:

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

The full set is `:::card`, `:::callout`, `:::kpis`, `:::columns` with `:::col`, `:::tabs` with
`:::tab`, `:::details`, the form blocks `::field` and `:::choice` with `:::option`, and the fences
`chart`, `table`, `mermaid` and `html`. The reference agents learn from is
`plugin/skills/publish/reference.md`, the same text MCP serves as `indy://reference`.

### Themes

A theme is one CSS file that sets a fixed list of `--art-*` custom properties, with colours for
light and dark. `default`, `picaflick` and `backup-studio` ship in the image. Indy serves its own
fonts, all under the Open Font License, so pages make no requests to a font CDN.

## Security

There is one account. Each agent gets its own token, and you can revoke one without touching the
others.

Anything an agent wrote that can run goes in an `<iframe sandbox="allow-scripts">` without
`allow-same-origin`, so it has no cookies, no storage and no access to the page around it. The frame
also gets a Content Security Policy that blocks network access. Markdown is sanitized before it
reaches the page. Compiled apps may import react, react-dom, svelte, chart.js, d3, lucide-react and
their own files; any other import fails the build, and the error goes back to the agent.

A visitor on a share link sees only that page and the comments made through that link. Their
comments and answers reach an agent only after you forward them, and they arrive marked untrusted so
the agent treats them as data.

## Working on Indy

```bash
docker compose -f compose.dev.yaml up
```

That runs Indy from the source tree with hot reload on port 5178, against `./data`. Tests and the
typecheck:

```bash
npm ci
npm test
npm run typecheck
```

Layout: `app/` is the Next.js server, viewer, API and MCP endpoint. `collab/` is the document
server behind live editing. `packages/primitives` holds the `<art-*>` elements pages are built from.
`themes/` has the theme files, `plugin/` the Claude Code and Codex plugin, and `tools/` a
Playwright screenshot harness.

### Versions

`VERSION` holds the version. To release, run `npm run set-version 0.3.0`, which also writes it into
the package manifests and both plugin manifests, then merge to `main`. The first build of a new
version publishes `:0.3.0`, `:0.3` and `:0`, tags `v0.3.0` and writes a GitHub release. A test
fails if any copy of the version disagrees with `VERSION`. Bump it for every plugin change too:
Claude Code only offers a plugin update when its version changes.

## Licence

Indy is free software under the [GNU Affero General Public License v3.0](LICENSE) or any later
version. You can run it, change it and share it. If you run a modified Indy that other people use
over a network, you have to offer them the source of your version too.
