"""The Jev client against a local stand-in for the OpenRouter endpoint; no test calls the model."""
import http.client
import json
import os
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

import helpers  # noqa: F401  (puts scripts/ on the path)

import jev

DIFF = "diff --git a/src/load.py b/src/load.py\n--- a/src/load.py\n+++ b/src/load.py\n@@ -3 +3 @@\n-x\n+y\n"
REPLAY = Path.home() / ".local/share/alq-churn/churn/jev_fix.py"


def reply(**choices):
    return {"answers": {k: {"choice": v, "probabilities": {v: 0.9}, "confidence": 0.8} for k, v in choices.items()},
            "usage": {"input_tokens": 12, "cost": 0.0008}}


class StandIn(BaseHTTPRequestHandler):
    status, reply, replies, seen, delay = 200, None, [], [], 0

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        StandIn.seen.append({"auth": self.headers["Authorization"], "body": body})
        if StandIn.delay:
            threading.Event().wait(StandIn.delay)
        try:
            self.send_response(StandIn.status)
            self.end_headers()
            self.wfile.write(json.dumps(StandIn.replies.pop(0) if StandIn.replies else StandIn.reply).encode())
        except BrokenPipeError:
            pass  # the timeout test's client has hung up, which is what it tests

    def log_message(self, *args):
        pass


class Jev(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = HTTPServer(("127.0.0.1", 0), StandIn)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()

    def setUp(self):
        StandIn.status, StandIn.replies, StandIn.seen, StandIn.delay = 200, [], [], 0
        self.dir = Path(tempfile.mkdtemp())
        (self.dir / "key").write_text("sk-test\n")
        patched = mock.patch.dict(os.environ, {"JEV_ENDPOINT": f"http://127.0.0.1:{self.server.server_port}/",
                                               "JEV_KEY_FILE": str(self.dir / "key")})
        patched.start()
        self.addCleanup(patched.stop)

    def test_kind_is_asked_over_the_diff_alone(self):
        StandIn.reply = reply(kind="fix")
        self.assertEqual(jev.ask_kind(DIFF), ("fix", 0.0008))
        [seen] = StandIn.seen
        self.assertEqual(seen["auth"], "Bearer sk-test")
        self.assertEqual(seen["body"]["model"], "typesafe/jev-1.13")
        self.assertEqual(seen["body"]["state"], f"COMMIT DIFF\n{DIFF}")
        self.assertEqual(seen["body"]["questions"], {"kind": {
            "type": "choice", "instructions": "Does this change correct a defect in existing behaviour?",
            "criteria": {"fix": "the change corrects a defect in existing behaviour",
                         "not_fix": "it adds, restructures or removes behaviour without correcting a defect"}}})

    def test_a_not_fix_is_asked_again_so_a_fix_is_not_missed_on_one_answer(self):
        StandIn.replies = [reply(kind="not_fix"), reply(kind="not_fix"), reply(kind="fix")]
        kind, cost = jev.ask_kind(DIFF)
        self.assertEqual((kind, round(cost, 6)), ("fix", 0.0024))
        StandIn.seen, StandIn.reply = [], reply(kind="not_fix")
        kind, cost = jev.ask_kind(DIFF)
        self.assertEqual((kind, round(cost, 6)), ("not_fix", 0.0024))
        self.assertEqual(len(StandIn.seen), jev.KIND_ASKS)

    @unittest.skipUnless(REPLAY.is_file(), "jev_fix.py holds the questions the evidence fixes were measured with")
    def test_level_and_coverage_are_the_replays_questions_and_its_state(self):
        replayed = {}
        exec(compile(REPLAY.read_text().replace("KEY = ", "KEY = None and "), str(REPLAY), "exec"), replayed)
        StandIn.reply = reply(level="cause", coverage="edited_only")
        same = [{"file": "src/save.py", "line": 9, "function": "save", "does": "writes the file unchecked"}]
        self.assertEqual(jev.ask_fix(DIFF, same, []), ({"level": "cause", "coverage": "edited_only"}, 0.0008))
        body = StandIn.seen[0]["body"]
        self.assertEqual(body["questions"], {k: replayed["QUESTIONS"][k] for k in ("level", "coverage")})
        self.assertEqual(body["state"], f"A fix commit from a Python repository.\n\nCOMMIT DIFF\n{DIFF}\n\n"
                                        "SAME OPERATION\n- src/save.py:9 save — writes the file unchecked\n\n"
                                        "CALLERS/CONSUMERS\n- none")

    def test_the_language_comes_from_the_diffs_files(self):
        StandIn.reply = reply(level="cause", coverage="all")
        jev.ask_fix(DIFF.replace("load.py", "load.ts"), [], [])
        self.assertTrue(StandIn.seen[0]["body"]["state"].startswith("A fix commit from a TypeScript repository."))
        jev.ask_fix(DIFF.replace("load.py", "load.xyz"), [], [])
        self.assertTrue(StandIn.seen[1]["body"]["state"].startswith("A fix commit.\n\nCOMMIT DIFF"))

    def test_a_diff_too_large_for_jev_is_its_own_error(self):
        StandIn.status = 400
        StandIn.reply = {"error": {"message": 'HTTP 400: {"detail":{"error_type":"max_tokens_exceeded"}}', "code": 400}}
        with self.assertRaises(jev.TooLarge):
            jev.ask_kind(DIFF)

    def test_other_failures_raise_with_the_reason(self):
        StandIn.status, StandIn.reply = 400, {"error": {"message": "bad questions", "code": 400}}
        with self.assertRaisesRegex(jev.JevError, "HTTP 400.*bad questions") as raised:
            jev.ask_kind(DIFF)
        self.assertNotIsInstance(raised.exception, jev.TooLarge)
        StandIn.status, StandIn.reply = 200, reply(kind="maybe")
        with self.assertRaisesRegex(jev.JevError, "maybe"):
            jev.ask_kind(DIFF)
        StandIn.reply, StandIn.delay = reply(kind="fix"), 0.5
        with mock.patch.object(jev, "TIMEOUT", 0.1), self.assertRaisesRegex(jev.JevError, "timed out|could not"):
            jev.ask_kind(DIFF)

    def test_a_malformed_reply_raises_rather_than_escaping_as_another_error(self):
        for bad in ({**reply(kind="fix"), "usage": None}, {"answers": {"kind": {"choice": ["fix"]}}}, {"answers": None}, []):
            StandIn.reply = bad
            with self.assertRaises(jev.JevError, msg=bad):
                jev.ask_kind(DIFF)
        with mock.patch.object(jev.urllib.request, "urlopen", side_effect=http.client.IncompleteRead(b"{")):
            with self.assertRaisesRegex(jev.JevError, "could not"):
                jev.ask_kind(DIFF)
        body = mock.Mock(read=mock.Mock(side_effect=http.client.IncompleteRead(b"{")))
        failed = jev.urllib.error.HTTPError("http://x/", 500, "error", {}, body)
        with mock.patch.object(jev.urllib.request, "urlopen", side_effect=failed):
            with self.assertRaisesRegex(jev.JevError, "HTTP 500"):
                jev.ask_kind(DIFF)

    def test_an_endpoint_that_is_not_a_url_raises(self):
        with mock.patch.dict(os.environ, {"JEV_ENDPOINT": "not-a-url"}):
            with self.assertRaisesRegex(jev.JevError, "could not"):
                jev.ask_kind(DIFF)

    def test_no_call_outlasts_the_deadline(self):
        StandIn.reply = reply(kind="fix")
        with self.assertRaisesRegex(jev.JevError, "ran out"):
            jev.ask_kind(DIFF, deadline=time.monotonic())
        self.assertEqual(StandIn.seen, [])
        StandIn.delay = 0.5
        started = time.monotonic()
        with self.assertRaisesRegex(jev.JevError, "timed out|could not"):
            jev.ask_fix(DIFF, [], [], deadline=started + 0.1)
        self.assertLess(time.monotonic() - started, 0.4)

    def test_an_unreadable_key_file_raises_naming_it(self):
        (self.dir / "key").write_bytes(b"\xff\xfe")
        with self.assertRaisesRegex(jev.JevError, "key"):
            jev.ask_kind(DIFF)
        self.assertEqual(StandIn.seen, [])

    def test_a_missing_key_file_raises_naming_it(self):
        with mock.patch.dict(os.environ, {"JEV_KEY_FILE": str(self.dir / "nokey")}):
            with self.assertRaisesRegex(jev.JevError, "nokey"):
                jev.ask_kind(DIFF)
        self.assertEqual(StandIn.seen, [])


if __name__ == "__main__":
    unittest.main()
