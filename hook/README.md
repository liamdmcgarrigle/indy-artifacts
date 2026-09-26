# artifacts-hook

This script is the bridge between the artifacts server and a live agent terminal.

When the operator comments on an artifact in the browser and ticks "Notify agent", or
presses "Send N comments to agent", or saves an edit of their own, the server writes an
event. This script long-polls `GET /api/events`, formats each event as a short prompt, and
types it into the agent's terminal with `orca terminal send --enter`. The agent sees the
feedback in its own session and can answer it with the `artifacts_*` MCP tools.

It is the only part of the system that runs on the host rather than in the container,
because the Orca CLI is host-only. It uses the standard library alone, so there is nothing
to install.

## Install

```sh
cp ~/work/artifacts/hook/artifacts-hook.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now artifacts-hook
```

Check it:

```sh
systemctl --user status artifacts-hook
journalctl --user -u artifacts-hook -f
```

Every delivery, every skipped event and every error is one timestamped line on stderr,
which journald collects.

## Run it by hand

```sh
python3 ~/work/artifacts/hook/artifacts-hook.py --once      # one poll cycle, then exit
python3 ~/work/artifacts/hook/artifacts-hook.py --dry-run   # print messages, still ack
```

`--dry-run` is the safe way to see what an event would look like in a terminal without
interrupting a running agent.

## Environment

| variable | default | meaning |
|---|---|---|
| `ARTIFACTS_API` | `http://127.0.0.1:5174` | base URL of the artifacts server |
| `ARTIFACTS_STATE` | `~/.local/state/artifacts/hook.json` | cursor file holding the last delivered event id |
| `ARTIFACTS_POLL_WAIT` | `25` | seconds the server holds a long poll open |
| `ARTIFACTS_ORCA` | `orca` | Orca CLI to call; a full path works |

Add overrides to the unit with `systemctl --user edit artifacts-hook`.

## Behaviour worth knowing

The cursor only moves on an ack. `{"last_id": N}` is written atomically once the server
confirms each event, so a crash mid-batch replays from the last confirmed event rather
than losing one.

Delivery is in order, and a failed send stops the batch: if Orca rejects an event, the
loop breaks and the next poll fetches the same event again. After three attempts the
event is acked `undeliverable` and the poller moves on. The comment stays in the UI, and
the agent can still pull it with `artifact_comments`.

An artifact with no terminal handle is acked `no-terminal` and never sent. That happens
when the agent published without passing `agent.terminal`.

Errors never kill the loop. An unreachable server backs off 30 seconds, anything else 5
seconds. SIGTERM and SIGINT exit cleanly, so `systemctl --user stop` is instant.

## Tests

```sh
cd ~/work/artifacts && python3 -m unittest discover -s hook -v
```

11 tests, host python3, no network: the message formats, the anchor descriptions, and a
full `--once` cycle against a throwaway HTTP server with a fake `orca` on `PATH`.
