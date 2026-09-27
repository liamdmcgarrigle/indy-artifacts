# Benchmarks: Indy and Claude's built-in artifacts

Claude Code made the same five pages with Indy and with its own Artifact tool, three times each,
on 2026-09-27 with Claude Code 2.1.282 and Claude Opus 5.5. The three small pages ran against
Indy 0.6.0 and the two large ones against 0.7.0.

## Results

Medians of three runs, Indy first. Output tokens include thinking. Total input is new input plus
cache reads, so it doesn't depend on how warm the prompt cache was. Cost is what Claude Code
reports at list price.

| page | output tokens | total input tokens | cost | time |
|---|---:|---:|---:|---:|
| Report: number tiles, a stacked bar chart, a table, and a callout | 2,175 vs 7,595 | 139,815 vs 303,843 | $0.30 vs $0.51 | 20 s vs 66 s |
| Revise that report: change a number, drop two rows, and rewrite the callout | 3,921 vs 9,285 | 315,345 vs 486,993 | $0.41 vs $0.60 | 15 s vs 18 s |
| Checklist and form, saved and read back | 1,483 vs 6,243 | 158,673 vs 443,126 | $0.11 vs $0.62 | 16 s vs 59 s |
| Large page: nine charts, three tables, four callouts, a timeline, a decision, and a diagram | 13,361 vs 36,528 | 224,509 vs 493,511 | $0.72 vs $1.42 | 94 s vs 292 s |
| The same large page with a form at the end | 13,847 vs 38,324 | 239,295 vs 712,250 | $0.74 vs $1.78 | 97 s vs 322 s |

Across all five, Indy took 242 s against 757 s, cost $2.28 against $4.93, and used 34,787 output
tokens against 97,975.

Characters of page source the agent wrote:

| | Indy (markdown) | Claude artifacts (HTML) |
|---|---:|---:|
| Report | 2,165 | 11,660 |
| Checklist and form | 701 | 10,151 |
| Large page | 23,012 | 54,560 |
| Large page with a form | 24,496 | 61,289 |

## Why

A chart in Indy is a ten-line `chart` fence. With the Artifact tool the agent writes the HTML,
the CSS for both color schemes, and the chart code itself. Checklists and forms are built into
Indy, so that page is a task list and a few `::field` lines, and the agent reads the answers
back with `artifact_responses`. With the Artifact tool the agent builds both in JavaScript on
top of the page's `db` capability.

Native runs also load more guidance first: every one called the Artifact quickstart and loaded
the `dataviz` or `artifact-capabilities` skill. Indy runs load the `publish` skill and read
parts of `reference.md`.

Indy's revision costs more than its first publish, because `artifact_update` takes the whole
source. Native revisions patch the HTML file with a short script, but think longer about it.

## Setup

Both configs ran as headless Claude Code sessions (`claude -p`) in empty directories, with the
same model, user settings, and `CLAUDE.md`, and `--strict-mcp-config` so no other MCP servers
loaded.

- Claude artifacts: the `Artifact` tool (on in headless sessions with `CLAUDE_CODE_ARTIFACT=1`),
  no Indy server, and the Indy plugin disabled.
- Indy: a fresh Indy container with sign-in off (`INDY_AUTH=local`), its MCP server, and the
  plugin from this checkout (`--plugin-dir plugin`). No `Artifact` tool.

Every prompt ends by telling the agent to publish, give the link, and stop. The revision resumed
the report's session. For the large pages, a separate agent wrote the content and all its data
once as tool-neutral markdown, and both configs got the same file, so the task was only to
package it. The prompts are in [`benchmarks/prompts/`](benchmarks/prompts/) and every run's
numbers are in [`benchmarks/results.json`](benchmarks/results.json).

To run it again:

```bash
podman run -d --name indy-bench -p 127.0.0.1:5197:1936 \
  -e INDY_URL=http://127.0.0.1:5197 -e INDY_AUTH=local ghcr.io/liamdmcgarrigle/indy-artifacts:0.7.0
docs/benchmarks/run.sh native 1 & docs/benchmarks/run.sh indy 1 & wait
python3 docs/benchmarks/analyze.py
```

Start a fresh Indy container for each Indy rep. Native runs publish real, private artifacts to
your claude.ai account.

## Caveats

- Three runs per cell shows the gaps but doesn't measure them to the percent. Output tokens
  within a cell varied by up to 25%.
- The pages aren't identical. Each agent made its own layout choices. All 30 published and
  included everything the prompt asked for, by the agents' own accounts. None of them looked
  at its page in a browser.
- The checklist runs were redone for both configs after early Indy attempts collided with slugs
  left from earlier runs. The redo had a warmer prompt cache, which lowers cost for both and
  doesn't change output tokens.
- Everything ran on Claude Code. Codex and other agents can't use Claude's Artifact tool, so
  there is nothing to compare against there.
