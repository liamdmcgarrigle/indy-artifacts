#!/usr/bin/env python3
"""Fill a development Indy with pages worth organising.

    tools/seed-dev.py http://127.0.0.1:5178 you@example.com 'password'

Signs in, makes an agent token, publishes a handful of pages across projects
and two series over MCP, then leaves comments: one the agent replies to, and
some the owner has not sent. Only for a development database.
"""
import json
import sys
import urllib.error
import urllib.request
from http.cookiejar import CookieJar

base, email, password = sys.argv[1].rstrip("/"), sys.argv[2], sys.argv[3]
jar = CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, body=None, headers=None):
    req = urllib.request.Request(
        base + path,
        method=method,
        data=None if body is None else json.dumps(body).encode(),
        headers={"content-type": "application/json", **(headers or {})},
    )
    try:
        with opener.open(req) as res:
            return res.read().decode()
    except urllib.error.HTTPError as err:
        raise SystemExit(f"{method} {path} -> {err.code}: {err.read().decode()[:400]}")


call("POST", "/api/auth/login", {"email": email, "password": password})
token = json.loads(call("POST", "/api/tokens", {"name": "seed script"}))["token"]
mcp_headers = {
    "authorization": f"Bearer {token}",
    "accept": "application/json, text/event-stream",
    "mcp-protocol-version": "2025-06-18",
}
ids = iter(range(1, 10_000))


def tool(name, args):
    raw = call(
        "POST",
        "/mcp",
        {"jsonrpc": "2.0", "id": next(ids), "method": "tools/call", "params": {"name": name, "arguments": args}},
        mcp_headers,
    )
    line = next(l[6:] if l.startswith("data: ") else l for l in raw.splitlines() if "{" in l)
    result = json.loads(line)["result"]
    if result.get("isError"):
        raise SystemExit(f"{name} failed: {result['content'][0]['text']}")
    return result["content"][0]["text"]


call("POST", "/mcp", {"jsonrpc": "2.0", "id": 0, "method": "initialize", "params": {
    "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "seed", "version": "1"}}}, mcp_headers)

claude = {"name": "claude"}
codex = {"name": "codex"}

BACKUP = """---
title: Backup run {date}
---

Nightly backup of the photo and document sets. {lede}

:::kpis
- Files copied: {files}
- Failed: {failed} {{tone={tone}}}
- Duration: {mins} min
- Transferred: {gb} GB
:::

```chart
type: bar
x: night
y: [files]
data:
  - {{ night: Sat, files: 41200 }}
  - {{ night: Sun, files: 39800 }}
  - {{ night: Mon, files: 43100 }}
  - {{ night: Tue, files: 45000 }}
  - {{ night: Wed, files: 44200 }}
  - {{ night: Thu, files: 46900 }}
  - {{ night: Fri, files: {files_raw} }}
```

## What changed

{body}
"""

runs = [
    ("2026-09-24", "Everything copied.", "46,120", 46120, 0, "good", 38, "11.8", "A quiet night. The document set grew by 140 files."),
    ("2026-09-25", "Everything copied.", "46,904", 46904, 0, "good", 39, "12.0", "The photo set picked up the weekend's camera import."),
    ("2026-09-26", "Three files failed, all under one directory the backup user cannot read.", "48,211", 48211, 3, "bad", 41, "12.4",
     "Friday's run was the slowest of the week because the document set picked up 2,100 new scans from the office scanner.\n\n:::callout{tone=warn title=\"Needs a look\"}\nThe failures are under `/srv/photos/2019-raw`, which is owned by root with mode 700.\n:::"),
]
for date, lede, files, raw, failed, tone, mins, gb, body in runs:
    tool("artifact_publish", {
        "source": BACKUP.format(date=date, lede=lede, files=files, files_raw=raw, failed=failed, tone=tone, mins=mins, gb=gb, body=body),
        "project": "backup-studio", "series": "Nightly backup", "agent": claude,
    })

e2e = tool("artifact_publish", {"project": "picaflick", "series": "E2E suite runs", "agent": codex, "source": """---
title: E2E suite on Cuttlefish slots
---

Eleven of twelve files passed on slot 1. The share sheet test failed twice, and the retry on the third attempt hides a real flake in the intent handler.

:::kpis
- Files passed: 11 / 12 {tone=warn}
- Wall time: 12m 40s
- Device: SDK 37
:::

## Failing test

```
share_sheet_test.dart · attempt 1 FAIL · attempt 2 FAIL · attempt 3 pass
expected intent ACTION_SEND, got null after 4000ms
```

## Timings per file

| File | Time | Result |
|---|---|---|
| login_test.dart | 58s | pass |
| feed_test.dart | 1m 12s | pass |
| share_sheet_test.dart | 2m 31s | flaky |
| upload_test.dart | 1m 40s | pass |
"""})
e2e_slug = e2e.split('"')[1]

tool("artifact_publish", {"project": "picaflick", "agent": claude, "source": """---
title: Release notes, 0.14
---

## What's new

- Share straight to a group from the photo viewer.
- Uploads resume after the app is closed mid-way.

## Fixed

- The feed no longer jumps back to the top after a like.
"""})

tool("artifact_publish", {"project": "local-dev-setup", "agent": claude, "source": """---
title: Worker memory budget, measured
---

Two Cuttlefish slots peak at 18 GB together while both run tests. A third would need about 26 GB on a 30 GB box, so the slot limit stays at two.

:::kpis
- One slot, idle: 6.1 GB
- One slot, testing: 9.2 GB
- Two slots, testing: 18.0 GB {tone=warn}
:::
"""})

checkout = tool("artifact_publish", {"project": "slopshop", "agent": claude, "source": """---
title: Checkout flow, three options
---

Three versions of the checkout, each running live. Stepped hides shipping until the last screen; single page shows the total the whole time; the drawer keeps you on the product page.

:::columns{n=3}
::::col
### Stepped
Four screens, one decision each.
::::
::::col
### Single page
Everything on one screen, total always visible.
::::
::::col
### Drawer
Checkout slides over the product page.
::::
:::
"""})
checkout_slug = checkout.split('"')[1]

# An owner comment the agent answered, and comments not sent yet.
root = json.loads(call("POST", f"/api/artifacts/{e2e_slug}/comments", {
    "body": "The retry masks a real flake. Should we drop it?", "author_name": "Liam", "notify": True}))["comment"]["id"]
tool("artifact_reply", {"comment_id": root, "body": "Yes. Without it the test fails 2 in 10 runs. I can fix the handler first so CI does not go red for a week. Which do you want?", "agent": codex})
for text in ["Single page reads best on a phone.", "Can the drawer show the total too?", "Stepped feels slow for repeat buyers."]:
    call("POST", f"/api/artifacts/{checkout_slug}/comments", {"body": text, "author_name": "Liam"})

print(f"seeded; token for this dev install: {token}")
