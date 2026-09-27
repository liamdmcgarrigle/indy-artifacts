#!/bin/sh
# One line of context at the start of a session, so the agent remembers Indy
# exists. It makes no network calls, so it costs nothing when Indy is down.
# Claude Code and Codex both read this JSON shape.
cat >/dev/null
printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"Indy is set up: when a result reads better as a page than as terminal text (a report, plan, comparison, table, chart or form), publish it with the indy MCP tools and give the operator the link. The publish skill has the details."}}'
