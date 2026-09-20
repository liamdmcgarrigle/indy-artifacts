#!/usr/bin/env python3
"""Deliver artifacts events into agent terminals through the Orca CLI.

Long-polls the artifacts server for events (a comment, a batch of feedback, a
human edit), formats each one as a short prompt, and types it into the agent's
live terminal with `orca terminal send`. Runs as a systemd user unit on the
host; standard library only, because the host carries no toolchains.
"""

from __future__ import annotations

import argparse
import json
import os
import shlex
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

DEFAULT_API = "http://127.0.0.1:5174"
DEFAULT_STATE = "~/.local/state/artifacts/hook.json"
DEFAULT_WAIT = 25
DEFAULT_ORCA = "orca"

ORCA_TIMEOUT = 30          # seconds for one `orca terminal send`
MAX_ATTEMPTS = 3           # delivery attempts before an event is given up on
ERROR_BACKOFF = 5          # seconds after an unexpected error
UNREACHABLE_BACKOFF = 30   # seconds after the server refuses the connection

_stop = threading.Event()


# --------------------------------------------------------------------------- log


def log(message: str) -> None:
    """Write one timestamped line to stderr (journald picks it up)."""
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    print(f"{stamp} artifacts-hook: {message}", file=sys.stderr, flush=True)


# ------------------------------------------------------------------------ config


class Config:
    """Everything the poller reads from the environment."""

    def __init__(self, api, state_path, wait, orca, dry_run=False):
        self.api = api.rstrip("/")
        self.state_path = state_path
        self.wait = wait
        self.orca = orca
        self.dry_run = dry_run

    @classmethod
    def from_env(cls, env=None, dry_run=False):
        env = os.environ if env is None else env
        try:
            wait = int(env.get("ARTIFACTS_POLL_WAIT") or DEFAULT_WAIT)
        except ValueError:
            wait = DEFAULT_WAIT
        if wait < 0:
            wait = DEFAULT_WAIT
        state = env.get("ARTIFACTS_STATE") or DEFAULT_STATE
        return cls(
            api=env.get("ARTIFACTS_API") or DEFAULT_API,
            state_path=os.path.expanduser(state),
            wait=wait,
            orca=env.get("ARTIFACTS_ORCA") or DEFAULT_ORCA,
            dry_run=dry_run,
        )


def load_state(path: str) -> dict:
    try:
        with open(path, "r", encoding="utf-8") as fh:
            state = json.load(fh)
    except FileNotFoundError:
        return {"last_id": 0}
    except (OSError, ValueError) as exc:
        log(f"state file {path} unreadable ({exc}); starting from 0")
        return {"last_id": 0}
    if not isinstance(state, dict):
        return {"last_id": 0}
    try:
        state["last_id"] = int(state.get("last_id") or 0)
    except (TypeError, ValueError):
        state["last_id"] = 0
    return state


def save_state(path: str, last_id: int) -> None:
    """Write {"last_id": N} atomically, creating the parent directory."""
    parent = os.path.dirname(path) or "."
    os.makedirs(parent, exist_ok=True)
    tmp = f"{path}.tmp.{os.getpid()}"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump({"last_id": int(last_id)}, fh)
        fh.write("\n")
        fh.flush()
        os.fsync(fh.fileno())
    os.replace(tmp, path)


# --------------------------------------------------------------------- formatting


def _truncate(text: str, limit: int) -> str:
    text = " ".join(str(text or "").split())
    if len(text) <= limit:
        return text
    return text[: max(0, limit - 1)].rstrip() + "…"


def _anchor_lines(anchor: dict):
    """Pull (start, end) out of an anchor's `lines`, whatever shape it is."""
    lines = anchor.get("lines")
    if isinstance(lines, dict):
        return lines.get("start"), lines.get("end")
    if isinstance(lines, (list, tuple)):
        if len(lines) >= 2:
            return lines[0], lines[1]
        if len(lines) == 1:
            return lines[0], lines[0]
    if isinstance(lines, int):
        return lines, lines
    return None, None


def _span(start, end) -> str:
    """The `lines a-b` phrase an agent uses to find the spot in its source."""
    if start is None and end is None:
        return ""
    if end is None:
        return f"line {start}"
    return f"lines {start}-{end}"


def describe_anchor(anchor) -> str:
    """One short phrase saying where in the artifact a comment is pinned."""
    if not anchor:
        return "whole page"
    if not isinstance(anchor, dict):
        return "whole page"

    kind = anchor.get("type")
    start, end = _anchor_lines(anchor)

    if kind == "range":
        quote = _truncate(anchor.get("quote"), 60)
        span = _span(start, end) or "whole page"
        return f'{span} "{quote}"'
    if kind == "point":
        context = _truncate(anchor.get("context"), 40)
        span = f"line {start}" if start is not None else "whole page"
        return f'{span} near "{context}"'
    if kind == "element":
        block = anchor.get("block") or "element"
        span = _span(start, end) or "whole page"
        return f"{span} ({block})"

    block = anchor.get("block")
    return f"block {block}" if block else "whole page"


def _comment_version(comments, fallback=None):
    numbers = [
        c.get("version_number")
        for c in comments
        if isinstance(c, dict) and isinstance(c.get("version_number"), int)
    ]
    return max(numbers) if numbers else fallback


def format_message(event: dict) -> str:
    """Render one event as the plain text typed into the agent's terminal."""
    artifact = event.get("artifact") or {}
    payload = event.get("payload") or {}
    title = artifact.get("title") or artifact.get("slug") or "artifact"
    url = artifact.get("url") or ""
    kind = event.get("kind")

    if kind == "comment.created":
        comment = payload.get("comment") or {}
        version = comment.get("version_number")
        author = comment.get("author_name") or "operator"
        body = " ".join(str(comment.get("body") or "").split())
        where = describe_anchor(comment.get("anchor"))
        return (
            f'[artifacts] Comment on "{title}" v{version} ({url})\n'
            f"  {where}: {body}  — {author}\n"
            "Reply with artifacts_reply/artifacts_resolve; "
            "artifacts_comments lists all open threads."
        )

    if kind == "feedback.sent":
        comments = [c for c in (payload.get("comments") or []) if isinstance(c, dict)]
        version = _comment_version(comments, payload.get("version_number"))
        count = len(comments)
        noun = "comment" if count == 1 else "comments"
        lines = [f'[artifacts] {count} {noun} on "{title}" v{version} ({url})']
        message = payload.get("message")
        if message:
            author = payload.get("author_name")
            if not author:
                author = (comments[0].get("author_name") if comments else None) or "operator"
            lines.append(f"  {author}: {' '.join(str(message).split())}")
        for index, comment in enumerate(comments, start=1):
            where = describe_anchor(comment.get("anchor"))
            body = " ".join(str(comment.get("body") or "").split())
            lines.append(f"  {index}. {where}: {body}")
        lines.append(
            "Use artifacts_comments for the full threads, then artifacts_reply / "
            f"artifacts_resolve, and artifacts_update with expected_version={version}."
        )
        return "\n".join(lines)

    if kind == "version.created":
        version_obj = payload.get("version") or {}
        number = version_obj.get("number")
        author = version_obj.get("author_name") or "the operator"
        try:
            previous = int(number) - 1
        except (TypeError, ValueError):
            previous = "?"
        return (
            f'[artifacts] {author} edited "{title}", now v{number} ({url}). '
            f"Read it back with artifacts_get, or artifacts_diff from={previous} to={number}."
        )

    return f'[artifacts] {kind} on "{title}" ({url})'


# ----------------------------------------------------------------------- transport


def http_json(url: str, timeout: float, payload=None):
    """GET, or POST a JSON body. Returns the decoded body, or None if empty."""
    data = None
    headers = {"Accept": "application/json"}
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        body = response.read()
    if not body:
        return None
    try:
        return json.loads(body.decode("utf-8"))
    except ValueError:
        return None


def fetch_events(cfg: Config, after: int):
    url = f"{cfg.api}/api/events?after={int(after)}&wait={int(cfg.wait)}"
    return http_json(url, timeout=cfg.wait + 10) or {}


def ack(cfg: Config, event_id, note: str) -> bool:
    """Mark an event delivered. Returns False if the server would not take it."""
    url = f"{cfg.api}/api/events/{event_id}/ack"
    try:
        http_json(url, timeout=30, payload={"note": note})
        return True
    except (urllib.error.URLError, OSError, ValueError) as exc:
        log(f"ack of event {event_id} failed: {exc}")
        return False


def deliver(cfg: Config, handle: str, message: str) -> bool:
    """Type one message into a terminal. True when Orca accepted it."""
    if cfg.dry_run:
        print(f"--- would send to {handle} ---\n{message}\n", flush=True)
        return True
    command = shlex.split(cfg.orca) + [
        "terminal",
        "send",
        "--terminal",
        handle,
        "--text",
        message,
        "--enter",
        "--json",
    ]
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=ORCA_TIMEOUT,
        )
    except (subprocess.TimeoutExpired, OSError) as exc:
        log(f"orca terminal send failed: {exc}")
        return False
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip().splitlines()
        log(
            f"orca terminal send exited {result.returncode}"
            + (f": {detail[-1]}" if detail else "")
        )
        return False
    return True


# ---------------------------------------------------------------------- poll cycle


def poll_once(cfg: Config, state: dict, attempts: dict) -> int:
    """One long-poll plus delivery of what came back. Returns events handled.

    Delivery stops at the first event that could not be sent, so the next poll
    fetches it again from the same cursor and retries it in order.
    """
    data = fetch_events(cfg, state.get("last_id", 0))
    events = data.get("events") or []
    handled = 0

    for event in events:
        if _stop.is_set():
            break
        event_id = event.get("id")
        artifact = event.get("artifact") or {}
        handle = artifact.get("terminal_handle")

        if not handle:
            if ack(cfg, event_id, "no-terminal"):
                state["last_id"] = event_id
                save_state(cfg.state_path, event_id)
                attempts.pop(event_id, None)
                handled += 1
                log(f"event {event_id} ({event.get('kind')}) has no terminal; acked")
            continue

        message = format_message(event)
        if deliver(cfg, handle, message):
            note = "sent"
        else:
            tries = attempts.get(event_id, 0) + 1
            attempts[event_id] = tries
            if tries < MAX_ATTEMPTS:
                log(
                    f"event {event_id} delivery attempt {tries}/{MAX_ATTEMPTS} failed; "
                    "will retry"
                )
                break
            note = "undeliverable"
            log(f"event {event_id} undeliverable after {tries} attempts; giving up")

        if ack(cfg, event_id, note):
            state["last_id"] = event_id
            save_state(cfg.state_path, event_id)
            attempts.pop(event_id, None)
            handled += 1
            if note == "sent":
                log(f"event {event_id} ({event.get('kind')}) sent to {handle}")
        else:
            break

    return handled


def _install_signal_handlers() -> None:
    def handler(signum, _frame):
        log(f"signal {signum}; shutting down")
        _stop.set()

    for sig in (signal.SIGTERM, signal.SIGINT):
        try:
            signal.signal(sig, handler)
        except (ValueError, OSError):
            pass


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        prog="artifacts-hook",
        description="Deliver artifacts events into agent terminals via Orca.",
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="run a single poll cycle and exit",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print messages instead of sending them, and still ack",
    )
    args = parser.parse_args(argv)

    cfg = Config.from_env(dry_run=args.dry_run)
    _install_signal_handlers()
    state = load_state(cfg.state_path)
    attempts: dict = {}

    log(
        f"polling {cfg.api} from event {state.get('last_id', 0)} "
        f"(wait={cfg.wait}s, state={cfg.state_path}"
        + (", dry-run" if cfg.dry_run else "")
        + ")"
    )

    while not _stop.is_set():
        try:
            poll_once(cfg, state, attempts)
        except urllib.error.URLError as exc:
            log(f"server unreachable: {exc.reason}")
            if args.once:
                return 1
            _stop.wait(UNREACHABLE_BACKOFF)
            continue
        except Exception as exc:  # never let the loop die
            log(f"poll failed: {exc.__class__.__name__}: {exc}")
            if args.once:
                return 1
            _stop.wait(ERROR_BACKOFF)
            continue
        if args.once:
            return 0

    return 0


if __name__ == "__main__":
    sys.exit(main())
