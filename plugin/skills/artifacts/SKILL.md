---
name: artifacts
description: Use when a result would land better as a page than as terminal text, such as a status or benchmark report, test results, tables and charts, a UI mock, an architecture write-up, or a comparison the operator will want to sit with. Also when they ask for an artifact, a page, a dashboard or a link, or to revise one they left comments on.
---

# Artifacts

Publish a page the operator can open in a browser at `http://agentbox:5174`, comment on,
and edit. Every publish is a version; their comments come back into this terminal.

## When to publish instead of printing

Reach for an artifact when the output is something the operator will read rather than
scan past: a run or migration report, benchmark numbers, a table of more than a handful
of rows, anything with a chart or a diagram, a UI mock, a design you want feedback on.

Keep printing to the terminal for short answers, single commands, file diffs and
anything they asked for inline. An artifact for a two-line answer wastes a click.

## Identity: do this once per session

Comments only reach you if the artifact knows which terminal you are in. Read the two
values from your shell before the first publish:

```sh
echo "$ORCA_TERMINAL_HANDLE"
echo "$CLAUDE_CODE_SESSION_ID"
```

Pass them on the publish, and keep them for later calls in this session:

```
agent: { name: "claude", terminal: "<ORCA_TERMINAL_HANDLE>", session: "<CLAUDE_CODE_SESSION_ID>" }
```

If `ORCA_TERMINAL_HANDLE` is empty you are not running under an Orca terminal. Publish
anyway and say in your reply that comments will not reach you automatically, so you will
need to check `artifact_comments` when they say they have reviewed it.

## Publishing

```
artifact_publish
  title:  "Backup run 2026-09-20"
  kind:   "markdown"          # markdown | react | svelte | html; markdown is the default
  source: "<the document>"
  theme:  "default"           # default | picaflick | backup-studio
  project: "backup-studio"    # optional grouping for the index
  agent:  { name, terminal, session }
```

Markdown is the right answer almost every time: cards, KPIs, callouts, tabs, charts,
tables and mermaid diagrams are all directives and fences, so you write a short document
instead of HTML. Reach for `react` or `svelte` only when the page needs real interaction,
and `html` when you already have a complete document. See `reference.md` for the block
vocabulary, the file layout for compiled kinds, and the size limits.

The result carries `url`, `version`, and `warnings`. Warnings are per-block problems (a
malformed chart body, a ragged CSV) that rendered an error box on the page; the publish
still succeeded, and it is your call whether to fix them with an update.

Then, in your reply to the operator:

- give them the URL, in full, on its own line;
- open it on their machine if you are under Orca: `orca open-url --url <url>`;
- say in one line what is on the page, so they know whether to look now.

## When they comment

Feedback arrives in this terminal as a `[artifacts]` message naming the artifact, the
line range and the comment. You can also pull it yourself at any time. Do that when they
say "I've left some notes" and nothing has arrived.

1. `artifact_comments slug:<slug>` lists the open threads, each with `anchor.lines`, the
   quoted text, and `source_hint` for compiled kinds. That is where to look in your source.
2. `artifact_reply comment_id:<id> body:"..."` answers a question or says what you
   changed. `artifact_resolve comment_id:<id>` closes a thread you have addressed.
   Resolve only what you actually fixed.
3. `artifact_update slug:<slug> expected_version:<n> source:"..."` publishes the revision.
   `expected_version` is the version you last read, and it is what makes the update safe.

`artifact_wait slug:<slug> after:<event_id>` blocks for up to 55 seconds if you have
been told to wait for their review rather than move on.

## The operator edits too

They can rewrite the source in the browser, and their save is a new version by a human
author. So an `artifact_update` can come back as a 409 conflict naming the current
version. A 409 is not worth retrying as-is: the page in front of them is no longer the
page you wrote.

Read it back with `artifact_get slug:<slug>`, or `artifact_diff slug:<slug> from:<yours>
to:<theirs>` to see what they changed, fold your change into their version, and update
with the version number you just read. Never overwrite their edit with your copy.

## The rest of the tools

`artifact_list` finds what you published earlier in the project. `artifact_get` with a
`version` reads any older version back, including its build log if a compiled kind failed.

## Authoring reference

`reference.md`, next to this file, has the four kinds, the frontmatter fields, one worked
example of every directive and fence, and the limits. Read it before writing anything
beyond plain markdown.
