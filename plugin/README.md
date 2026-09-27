# Indy plugin

One folder that Claude Code and Codex both install. It teaches an agent when and how to publish
to Indy. The connection itself is added separately, with the agent's own `mcp add` command, so it
works the same with or without the plugin. Indy's Connect page (`/connect`) shows both steps with
your address filled in.

```
plugin/
  .claude-plugin/plugin.json    Claude Code manifest
  .codex-plugin/plugin.json     Codex manifest
  hooks/hooks.json              SessionStart, shared by both
  hooks/session-start.sh        a few lines of context: Indy is there, what it can do, when to use it
  skills/publish/               when to publish, how, and what to do with comments
  skills/publish/reference.md   every block, one example each; the server serves the same file
  skills/feedback/              pick up the operator's comments on this project's pages
```

The marketplace is `.claude-plugin/marketplace.json` at the repository root. Codex reads the same
file, so both agents install `indy@indy`:

```bash
claude plugin marketplace add liamdmcgarrigle/indy-artifacts && claude plugin install indy@indy
codex plugin marketplace add liamdmcgarrigle/indy-artifacts && codex plugin add indy@indy
```

## What each part is for

The session-start hook prints a short list: Indy is set up, publish results that read better as pages,
what it can do (pages, checklists, forms, comments, stories, share links, live typing), and where the
details are. It makes no network call and costs about 200 tokens. It runs
on startup, `/clear` and compaction, but not on resume, where the list is already in the
conversation. Codex asks once before it runs a plugin's hook; `/hooks` shows it.

Each skill costs one line of context until it is used. `publish` carries the workflow: publish, give
the link, handle comments, and merge the operator's edits instead of overwriting them. `feedback` is
for "I left some notes": it finds this project's pages with open comments and works through them.
The operator can also run it as `/indy:feedback`.

The plugin ships no MCP server. Codex reads a server's URL literally, and in Claude Code a
plugin's fixed `Authorization` header gets in the way of signing in through the browser. So each
agent adds the server itself, by OAuth or with a token, and the plugin only adds knowledge.

Comments don't arrive by themselves. The agent collects them with `artifact_wait` when you said
you would review now, or when you ask with the feedback skill.

## Changing the plugin

- `reference.md` is the one copy of the authoring reference. After editing it, run
  `npm run sync:reference` in `app/` so the server serves the same text; a test fails until you do.
- Bump the version with `npm run set-version` for any change you want users to receive. Claude
  Code only updates a plugin when its version changes.
- `claude plugin validate plugin` and `claude plugin validate .` check both manifests.
