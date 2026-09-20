"""Tests for artifacts-hook.py.

Run with the host python3, standard library only:

    cd /home/liam/work/artifacts && python3 -m unittest discover -s hook -v
"""

import importlib.util
import json
import os
import pathlib
import re
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest import mock
from urllib.parse import parse_qs, urlparse

HOOK_PATH = pathlib.Path(__file__).resolve().parent / "artifacts-hook.py"
_spec = importlib.util.spec_from_file_location("artifacts_hook", HOOK_PATH)
hook = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(hook)


ARTIFACT = {
    "slug": "backup-run-2026-09-20",
    "title": "Backup run 2026-09-20",
    "url": "http://agentbox:5174/a/backup-run-2026-09-20",
    "terminal_handle": "term-7f3a",
    "agent_name": "claude",
}


def comment_event(event_id=11):
    return {
        "id": event_id,
        "kind": "comment.created",
        "artifact": ARTIFACT,
        "payload": {
            "comment": {
                "id": "c1",
                "body": "This number looks stale.",
                "author_name": "Liam",
                "version_number": 3,
                "anchor": {
                    "type": "range",
                    "block": "b4",
                    "lines": [44, 44],
                    "quote": "restored 1.2 TB",
                },
            }
        },
        "created_at": "2026-09-20T12:00:00Z",
    }


def feedback_event(event_id=12):
    return {
        "id": event_id,
        "kind": "feedback.sent",
        "artifact": ARTIFACT,
        "payload": {
            "message": "Two small things before I sign this off.",
            "comments": [
                {
                    "id": "c1",
                    "body": "This number looks stale.",
                    "author_name": "Liam",
                    "version_number": 3,
                    "anchor": {
                        "type": "range",
                        "block": "b4",
                        "lines": [44, 46],
                        "quote": "restored 1.2 TB",
                    },
                },
                {
                    "id": "c2",
                    "body": "Chart axis needs a unit.",
                    "author_name": "Liam",
                    "version_number": 3,
                    "anchor": {
                        "type": "element",
                        "block": "b9",
                        "lines": [60, 72],
                    },
                },
            ],
        },
        "created_at": "2026-09-20T12:05:00Z",
    }


def version_event(event_id=13):
    return {
        "id": event_id,
        "kind": "version.created",
        "artifact": ARTIFACT,
        "payload": {"version": {"number": 4, "author_name": "Liam"}},
        "created_at": "2026-09-20T12:10:00Z",
    }


class DescribeAnchorTest(unittest.TestCase):
    def test_missing_anchor_is_the_whole_page(self):
        self.assertEqual(hook.describe_anchor(None), "whole page")

    def test_range_anchor_quotes_the_selection(self):
        described = hook.describe_anchor(
            {
                "type": "range",
                "block": "b4",
                "lines": [44, 46],
                "quote": "x" * 90,
            }
        )
        self.assertTrue(described.startswith("lines 44-46 "))
        quoted = described.split('"')[1]
        self.assertEqual(len(quoted), 60)
        self.assertTrue(quoted.endswith("…"))

    def test_point_anchor_names_one_line_and_its_context(self):
        described = hook.describe_anchor(
            {
                "type": "point",
                "block": "b2",
                "lines": [12, 12],
                "offset": 8,
                "context": "y" * 90,
            }
        )
        self.assertTrue(described.startswith("line 12 near "))
        quoted = described.split('"')[1]
        self.assertEqual(len(quoted), 40)

    def test_element_anchor_names_the_block(self):
        described = hook.describe_anchor(
            {"type": "element", "block": "b9", "lines": [60, 72], "x": 0.5, "y": 0.4}
        )
        self.assertEqual(described, "lines 60-72 (b9)")


class SingleLineTest(unittest.TestCase):
    """`orca terminal send --enter` submits on every newline, so a message that
    contained one would arrive as several prompts. Every message must be one line."""

    def test_every_message_kind_is_one_line(self):
        for event in (comment_event(), feedback_event(), version_event()):
            message = hook.format_message(event)
            self.assertNotIn("\n", message, f"{event['kind']} message contains a newline")
            self.assertNotIn("\r", message, f"{event['kind']} message contains a carriage return")


class FormatMessageTest(unittest.TestCase):
    def test_comment_created(self):
        message = hook.format_message(comment_event())
        self.assertIn('commented on "Backup run 2026-09-20" v3', message)
        self.assertIn("http://agentbox:5174/a/backup-run-2026-09-20", message)
        self.assertIn('lines 44-44 "restored 1.2 TB": This number looks stale.', message)
        self.assertIn("Liam commented on", message)
        self.assertIn("artifacts_comments", message)
        self.assertTrue(message.startswith("[artifacts] "))

    def test_feedback_sent(self):
        message = hook.format_message(feedback_event())
        self.assertIn('[artifacts] 2 comments on "Backup run 2026-09-20" v3', message)
        self.assertIn("Liam: Two small things before I sign this off.", message)
        self.assertIn('(1) lines 44-46 "restored 1.2 TB": This number looks stale.', message)
        self.assertIn("(2) lines 60-72 (b9): Chart axis needs a unit.", message)
        self.assertIn("expected_version=3", message)

    def test_version_created(self):
        message = hook.format_message(version_event())
        self.assertIn('Liam edited "Backup run 2026-09-20", now v4', message)
        self.assertIn("artifacts_get", message)
        self.assertIn("artifacts_diff from=3 to=4", message)


class FakeServer:
    """A throwaway artifacts server: one canned events feed, recorded acks."""

    def __init__(self, events):
        self.events = events
        self.acks = []
        self.polls = []
        acks, polls = self.acks, self.polls
        outer = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def _json(self, payload):
                body = json.dumps(payload).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                parsed = urlparse(self.path)
                if parsed.path != "/api/events":
                    self.send_error(404)
                    return
                polls.append(parse_qs(parsed.query))
                events = outer.events
                last_id = events[-1]["id"] if events else 0
                self._json({"events": events, "last_id": last_id})

            def do_POST(self):
                match = re.match(r"^/api/events/(\d+)/ack$", urlparse(self.path).path)
                if not match:
                    self.send_error(404)
                    return
                length = int(self.headers.get("Content-Length") or 0)
                raw = self.rfile.read(length) if length else b"{}"
                acks.append((int(match.group(1)), json.loads(raw.decode("utf-8"))))
                self._json({"ok": True})

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)

    @property
    def url(self):
        host, port = self.server.server_address[:2]
        return f"http://{host}:{port}"

    def __enter__(self):
        self.thread.start()
        return self

    def __exit__(self, *exc):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=5)
        return False


def write_fake_orca(directory, record_path, exit_code=0):
    """A stand-in for the Orca CLI that records argv NUL-separated."""
    path = pathlib.Path(directory) / "orca"
    path.write_text(
        "#!/bin/sh\n"
        f'printf "%s\\0" "$@" >> "{record_path}"\n'
        f"exit {exit_code}\n",
        encoding="utf-8",
    )
    path.chmod(0o755)
    return path


def read_argv(record_path):
    raw = pathlib.Path(record_path).read_bytes().decode("utf-8")
    return [part for part in raw.split("\0") if part != ""]


class PollOnceTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.dir = pathlib.Path(self.tmp.name)
        self.state = self.dir / "state" / "hook.json"
        self.record = self.dir / "orca-argv"
        hook._stop.clear()

    def test_once_sends_through_orca_and_acks(self):
        bindir = self.dir / "bin"
        bindir.mkdir()
        write_fake_orca(bindir, self.record)

        with FakeServer([comment_event(21)]) as server:
            env = {
                "ARTIFACTS_API": server.url,
                "ARTIFACTS_STATE": str(self.state),
                "ARTIFACTS_POLL_WAIT": "1",
                "PATH": f"{bindir}{os.pathsep}{os.environ.get('PATH', '')}",
            }
            env.pop("ARTIFACTS_ORCA", None)
            with mock.patch.dict(os.environ, env, clear=False):
                os.environ.pop("ARTIFACTS_ORCA", None)
                self.assertEqual(hook.main(["--once"]), 0)

            self.assertEqual(server.acks, [(21, {"note": "sent"})])
            self.assertEqual(server.polls[0]["after"], ["0"])

        argv = read_argv(self.record)
        self.assertEqual(argv[:2], ["terminal", "send"])
        self.assertEqual(argv[argv.index("--terminal") + 1], "term-7f3a")
        self.assertIn("--enter", argv)
        self.assertIn("--json", argv)
        text = argv[argv.index("--text") + 1]
        self.assertIn('commented on "Backup run 2026-09-20" v3', text)

        self.assertEqual(json.loads(self.state.read_text()), {"last_id": 21})

    def test_artifact_without_a_terminal_is_acked_immediately(self):
        event = version_event(31)
        event["artifact"] = dict(ARTIFACT, terminal_handle=None)

        with FakeServer([event]) as server:
            cfg = hook.Config(server.url, str(self.state), 1, str(self.dir / "missing-orca"))
            state = {"last_id": 0}
            handled = hook.poll_once(cfg, state, {})

        self.assertEqual(handled, 1)
        self.assertEqual(server.acks, [(31, {"note": "no-terminal"})])
        self.assertFalse(self.record.exists())
        self.assertEqual(state["last_id"], 31)

    def test_failed_delivery_retries_then_acks_undeliverable(self):
        failing = write_fake_orca(self.dir, self.record, exit_code=1)

        with FakeServer([comment_event(41)]) as server:
            cfg = hook.Config(server.url, str(self.state), 1, str(failing))
            state = {"last_id": 0}
            attempts = {}
            for _ in range(hook.MAX_ATTEMPTS):
                hook.poll_once(cfg, state, attempts)

            self.assertEqual(server.acks, [(41, {"note": "undeliverable"})])
            self.assertEqual(len(server.polls), hook.MAX_ATTEMPTS)

        self.assertEqual(state["last_id"], 41)
        self.assertEqual(read_argv(self.record).count("terminal"), hook.MAX_ATTEMPTS)

    def test_dry_run_acks_without_calling_orca(self):
        with FakeServer([feedback_event(51)]) as server:
            cfg = hook.Config(
                server.url, str(self.state), 1, str(self.dir / "missing-orca"), dry_run=True
            )
            hook.poll_once(cfg, {"last_id": 0}, {})

        self.assertEqual(server.acks, [(51, {"note": "sent"})])
        self.assertFalse(self.record.exists())


if __name__ == "__main__":
    unittest.main()
