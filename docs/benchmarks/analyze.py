"""Summarise benchmark runs: docs/benchmarks/run.sh writes out/*.json, this reads them.

    python3 docs/benchmarks/analyze.py

Tokens and cost come from the JSON `claude -p --output-format json` prints. How much page
source the agent wrote comes from the session transcript under ~/.claude/projects.
"""
import glob, json, os, re, statistics as st

HERE = os.environ.get("OUT_BASE", os.path.dirname(os.path.abspath(__file__)))
PROJECTS = os.path.expanduser("~/.claude/projects")
TASKS = ("report", "revise", "checklist", "bigpage", "bigform")
REVISE_MARK = "Update that same page"


def transcript(cwd, sid):
    return os.path.join(PROJECTS, re.sub(r"[^A-Za-z0-9]", "-", cwd), sid + ".jsonl")


def page_chars(name, inp):
    """Characters of page source in one tool call: a file written, or an Indy publish."""
    if name == "Write":
        return len(inp.get("content", ""))
    if name == "Edit":
        return len(inp.get("new_string", ""))
    if name.endswith(("artifact_publish", "artifact_update")):
        files = inp.get("files") or {}
        return len(inp.get("source") or "") + sum(len(v) for v in files.values())
    return 0


def tool_calls(path, task):
    """Tool calls in a transcript. The report and its revision share one session, so
    the report keeps the calls before the revision prompt and the revision the rest."""
    calls, phase = [], "report"
    for line in open(path):
        e = json.loads(line)
        content = e.get("message", {}).get("content")
        if e.get("type") == "user" and isinstance(content, str) and REVISE_MARK in content:
            phase = "revise"
        if e.get("type") != "assistant" or not isinstance(content, list):
            continue
        for c in content:
            if c.get("type") == "tool_use":
                calls.append((phase, c["name"], c["input"]))
    if task == "report":
        return [c for c in calls if c[0] == "report"]
    if task == "revise":
        return [c for c in calls if c[0] == "revise"]
    return calls


rows = []
for f in sorted(glob.glob(os.path.join(HERE, "out", "*.json"))):
    name = os.path.basename(f)[:-5]
    if name.count("-") != 2:
        continue
    cfg, task, rep = name.split("-")
    try:
        d = json.load(open(f))
    except ValueError:
        continue
    usage = list(d["modelUsage"].values())
    total = lambda k: sum(u[k] for u in usage)
    wd_task = "report" if task == "revise" else task
    t = transcript(os.path.join(HERE, "wd", f"{cfg}-{wd_task}-{rep}"), d["session_id"])
    calls = tool_calls(t, task) if os.path.exists(t) else []
    rows.append(dict(
        cfg=cfg, task=task, rep=rep, turns=d["num_turns"],
        new_input=total("inputTokens") + total("cacheCreationInputTokens"),
        cache_read=total("cacheReadInputTokens"), output=total("outputTokens"),
        cost=d["total_cost_usd"], secs=d["duration_ms"] / 1000, error=d["is_error"],
        page_chars=sum(page_chars(n, i) for _, n, i in calls),
        tools=[n.replace("mcp__indybench__", "") for _, n, _ in calls],
    ))

json.dump(rows, open(os.path.join(HERE, "summary.json"), "w"), indent=1)

for r in rows:
    print(f'{r["cfg"]:6} {r["task"]:9} {r["rep"]} out={r["output"]:6} new_in={r["new_input"]:6} '
          f'cache={r["cache_read"]:7} page={r["page_chars"]:6} ${r["cost"]:.3f} {r["secs"]:.0f}s')
print()
for task in TASKS:
    for cfg in ("indy", "native"):
        g = [r for r in rows if r["cfg"] == cfg and r["task"] == task]
        if not g:
            continue
        m = lambda k: st.median(r[k] for r in g)
        print(f'{task:9} {cfg:6} n={len(g)} out={m("output"):.0f} new_in={m("new_input"):.0f} '
              f'total_in={st.median(r["new_input"] + r["cache_read"] for r in g):.0f} '
              f'page={m("page_chars"):.0f} ${m("cost"):.3f} {m("secs"):.0f}s')
