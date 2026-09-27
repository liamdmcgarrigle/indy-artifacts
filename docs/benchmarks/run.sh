#!/bin/bash
# Token benchmark: the same pages made with Indy and with Claude's built-in artifacts.
#
#   docs/benchmarks/run.sh <native|indy> <rep>
#
# Needs a throwaway Indy with sign-in off, on 127.0.0.1:5197. Start a fresh one for
# each rep: a slug left over from an earlier run makes the agent publish again.
#   podman run -d --name indy-bench -p 127.0.0.1:5197:1936 \
#     -e INDY_URL=http://127.0.0.1:5197 -e INDY_AUTH=local ghcr.io/liamdmcgarrigle/indy-artifacts:0.7.0
#
# Each rep runs five headless Claude Code sessions per config: "report", then
# "revise" (resuming the report session), "checklist", "bigpage", and "bigform". The last
# two package prompts/<task>-content.md (written once, ahead of time) into one large page,
# the second with a form at the end. Results land in
# $OUT as the JSON `claude -p --output-format json` prints; analyze.py reads them.
# Native runs publish real, private artifacts to your claude.ai account.
set -u
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
OUT="${OUT:-$here/out}"; WD="${WD:-$here/wd}"
cfg=$1; rep=$2
mkdir -p "$OUT"
echo '{"mcpServers":{}}' > "$OUT/no-mcp.json"
echo '{"mcpServers":{"indybench":{"type":"http","url":"http://127.0.0.1:5197/mcp"}}}' > "$OUT/indy-mcp.json"

common=(--model claude-opus-5-5 --permission-mode bypassPermissions --output-format json --strict-mcp-config
        --settings '{"enabledPlugins":{"indy@indy":false}}')
if [ "$cfg" = native ]; then
  # The Artifact tool is off in headless sessions unless this is set.
  export CLAUDE_CODE_ARTIFACT=1
  extra=(--mcp-config "$OUT/no-mcp.json")
else
  unset CLAUDE_CODE_ARTIFACT
  # The plugin from this checkout, not whatever version is installed.
  extra=(--mcp-config "$OUT/indy-mcp.json" --plugin-dir "$repo/plugin")
fi

for task in report checklist bigpage bigform; do
  d="$WD/$cfg-$task-$rep"; mkdir -p "$d"; cd "$d"
  [ -f "$here/prompts/$task-content.md" ] && cp "$here/prompts/$task-content.md" content.md
  timeout 1500 claude -p "$(cat "$here/prompts/$task.txt")" "${common[@]}" "${extra[@]}" \
    > "$OUT/$cfg-$task-$rep.json" 2> "$OUT/$cfg-$task-$rep.err"
  if [ "$task" = report ]; then
    sid=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["session_id"])' "$OUT/$cfg-$task-$rep.json")
    timeout 900 claude -p "$(cat "$here/prompts/revise.txt")" --resume "$sid" "${common[@]}" "${extra[@]}" \
      > "$OUT/$cfg-revise-$rep.json" 2> "$OUT/$cfg-revise-$rep.err"
  fi
done
echo "done $cfg $rep"
