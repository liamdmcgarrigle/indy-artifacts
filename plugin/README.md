# artifacts plugin

One directory that both Claude Code and Codex accept. It gives an agent the `artifacts`
skill and the `artifacts` MCP server at `http://127.0.0.1:5174/mcp`, which is how it
publishes pages, reads the operator's comments, and replies to them.

```
plugin/
  .claude-plugin/plugin.json   manifest for Claude Code
  .codex-plugin/plugin.json    manifest for Codex, same fields
  .mcp.json                    the streamable-http MCP endpoint
  skills/artifacts/SKILL.md    when to publish, the workflow, identity, feedback
  skills/artifacts/reference.md the block vocabulary, one example each, the limits
```

The marketplace manifests live at the repo root: `.claude-plugin/marketplace.json` for
Claude Code and `.agents/plugins/marketplace.json` for Codex. Both name the marketplace
`artifacts-local` and point at `./plugin`.

## Install into Claude Code

```sh
claude plugin marketplace add /home/liam/work/artifacts
claude plugin install artifacts@artifacts-local --scope user
```

Verified on agentbox, 2026-09-20:

```
✔ Successfully added marketplace: artifacts-local (declared in user settings)
✔ Successfully installed plugin: artifacts@artifacts-local (scope: user)
```

`claude plugin details artifacts@artifacts-local` then reports the inventory:

```
Component inventory
  Skills (1)  artifacts
  MCP servers (1)  artifacts  (tool schemas resolved at runtime; not counted)

Projected token cost
  Always-on:   ~113 tok   added to every session
```

Restart the session to pick it up. The MCP server shows as unreachable until the
artifacts container is running; the skill works regardless.

## Install into Codex

```sh
codex plugin marketplace add /home/liam/work/artifacts
codex plugin add artifacts@artifacts-local
```

Verified on agentbox, 2026-09-20:

```
Added marketplace `artifacts-local` from /home/liam/work/artifacts.
Installed marketplace root: /home/liam/work/artifacts

Added plugin `artifacts` from marketplace `artifacts-local`.
Installed plugin root: /home/liam/.codex/plugins/cache/artifacts-local/artifacts/0.1.0
```

`codex plugin list` then shows `artifacts@artifacts-local  installed, enabled  0.1.0`.
Codex copies the plugin into its cache at install time, so it does not read the working
tree afterwards.

## After you edit the plugin

Claude Code reads a directory marketplace live, but refresh it if a manifest changed:

```sh
claude plugin marketplace update artifacts-local
claude plugin update artifacts@artifacts-local
```

Codex installed a copy, so re-add it to pick up changes:

```sh
codex plugin add artifacts@artifacts-local
```

## Validate before committing a change

```sh
claude plugin validate /home/liam/work/artifacts/plugin   # the plugin manifest
claude plugin validate /home/liam/work/artifacts          # the marketplace manifest
```

Both print `✔ Validation passed`.
