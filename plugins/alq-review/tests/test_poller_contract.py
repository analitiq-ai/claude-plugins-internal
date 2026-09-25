"""The poller writes the drop, the ledger reads it: this pins the two ends of that file to each other."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from helpers import T0

import ledger

POLLER = Path(__file__).resolve().parents[3] / "skills" / "alq-github-pr-review" / "poll-pr-review.sh"
THREADS = [{"by": "chatgpt-codex-connector", "path": "src/a.py", "line": 12, "outdated": False,
            "url": "https://github.com/acme/demo/pull/7#discussion_r1", "at": "2026-09-18T11:59:00Z",
            "severity": "P1", "gist": "Guard the empty list"}]
CHECKS = {"failing": [{"name": "unit", "state": "FAILURE", "url": ""}], "running": []}
COMMENTS = [{"at": "2026-09-18T11:58:00Z", "url": "https://github.com/acme/demo/pull/7#issuecomment-1", "approves": False,
             "gist": "Two concerns"},
            {"at": "2026-09-18T11:57:00Z", "url": "https://github.com/acme/demo/pull/7#issuecomment-0", "approves": True,
             "gist": "Didn't find any major issues"}]


class PollerDrop(unittest.TestCase):
    def setUp(self):
        self.assertTrue(POLLER.is_file(), f"poller not found at {POLLER}: the drop has lost its writer")
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        stub = Path(self.tmp.name) / "bin"
        stub.mkdir()
        (stub / "gh").write_text('#!/bin/sh\necho \'{"headRefName": "feat/1-demo", "headRefOid": "abc123"}\'\n')
        (stub / "gh").chmod(0o755)
        self.env = dict(os.environ, ALQ_REVIEW_STATE_DIR=f"{self.tmp.name}/state",
                        PATH=f"{stub}{os.pathsep}{os.environ['PATH']}")

    def hand_to_gate(self, status):
        script = ('eval "$(sed -n \'/^hand_to_gate() {/,/^}/p\' "$POLLER")"; repo=acme/demo; pr=7; '
                  'hand_to_gate "$STATUS" "$THREADS" "$CHECKS" "$COMMENTS"')
        env = dict(self.env, POLLER=str(POLLER), STATUS=status, THREADS=json.dumps(THREADS),
                   CHECKS=json.dumps(CHECKS), COMMENTS=json.dumps(COMMENTS))
        done = subprocess.run(["bash", "-euo", "pipefail", "-c", script], env=env, capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads((Path(self.tmp.name) / "state" / "inbox" / "acme__demo__7.json").read_text())

    def test_findings_drop_opens_a_github_round_in_the_ledger_of_its_pr(self):
        drop = self.hand_to_gate("findings")
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": self.env["ALQ_REVIEW_STATE_DIR"]}):
            with ledger.open_ledger(drop["repo"], drop["pr"]) as state:
                rnd = ledger.ingest_poll(state, drop, now=T0)
        self.assertEqual((rnd["ref"], rnd["head_sha"]), ("acme/demo#7:github-0.1", "abc123"))
        self.assertEqual([f["id"] for f in rnd["findings"]], [THREADS[0]["url"], COMMENTS[0]["url"]])
        self.assertEqual(rnd["failing_checks"], CHECKS["failing"])

    def test_clean_drop_records_the_clean_commit(self):
        state = ledger.new_state("acme/demo", "feat/1-demo")
        self.assertIsNone(ledger.ingest_poll(state, self.hand_to_gate("clean"), now=T0))
        self.assertEqual(state["github_clean_sha"], "abc123")


if __name__ == "__main__":
    unittest.main()
