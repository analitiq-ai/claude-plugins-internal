"""github.py's cleanup decider and its label readers, against a gh stand-in that answers what the test sets."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import helpers  # noqa: F401  (puts scripts/ on the path)
from paths import PLUGIN

import github

SCRIPT = PLUGIN / "scripts" / "github.py"


class IsCleanup(unittest.TestCase):
    def test_the_cleanup_label_marks_a_cleanup_pr(self):
        self.assertTrue(github.is_cleanup(["bug", "cleanup"]))

    def test_github_compares_label_names_without_case_and_so_does_the_decider(self):
        self.assertTrue(github.is_cleanup(["Cleanup"]))

    def test_no_other_label_does(self):
        for labels in ([], ["bug"], ["cleanup-ish"], ["clean up"], ["no-review"]):
            with self.subTest(labels=labels):
                self.assertFalse(github.is_cleanup(labels))


class CleanupFact(unittest.TestCase):
    """The one cleanup fact every hook and the poller decide on."""

    def test_a_pr_whose_label_could_not_be_read_cannot_be_labelled(self):
        with self.assertRaises(ValueError):
            github.Cleanup(labelled=True, unread="HTTP 502")

    def test_the_reader_needs_an_open_pr_and_the_label_on_each(self):
        for found, labelled in (([["cleanup"]], True), ([["bug", "Cleanup"]], True), ([], False),
                                ([["cleanup"], ["bug"]], False), ([["bug"]], False)):
            with self.subTest(found=found):
                self.assertEqual(github.read_cleanup(lambda found=found: found), github.Cleanup(labelled=labelled))

    def test_labels_gh_cannot_say_are_no_label_and_say_why(self):
        def fails():
            raise RuntimeError("gh pr view failed: HTTP 502")
        fact = github.read_cleanup(fails)
        self.assertEqual(fact, github.Cleanup(unread="gh pr view failed: HTTP 502"))
        self.assertTrue(fact.refusal().startswith("The `cleanup` label could not be read (gh pr view failed: HTTP 502)"),
                        fact.refusal())


class StubGh(unittest.TestCase):
    """A gh on PATH that logs its arguments, prints GH_OUT and exits GH_EXIT."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        bin_dir = Path(self.tmp.name) / "bin"
        bin_dir.mkdir()
        gh = bin_dir / "gh"
        gh.write_text('#!/bin/sh\necho "$*" >> "$GH_LOG"\nprintf "%s" "$GH_OUT"\n[ -n "$GH_ERR" ] && echo "$GH_ERR" >&2\n'
                      'exit "${GH_EXIT:-0}"\n')
        gh.chmod(0o755)
        self.log = Path(self.tmp.name) / "gh.log"
        self.env = dict(os.environ, PATH=f"{bin_dir}{os.pathsep}{os.environ['PATH']}", GH_LOG=str(self.log))

    def answering(self, out="", exit_code=0, err=""):
        return mock.patch.dict(os.environ, dict(self.env, GH_OUT=out, GH_EXIT=str(exit_code), GH_ERR=err), clear=True)

    def asked(self):
        return self.log.read_text().splitlines()


def labels(*names):
    return [{"id": f"L{i}", "name": name, "description": "", "color": "ffffff"} for i, name in enumerate(names)]


class PrLabels(StubGh):
    def test_reads_the_label_names_of_one_pr(self):
        with self.answering(json.dumps({"labels": labels("bug", "cleanup")})):
            self.assertEqual(github.pr_labels("acme/demo", 12), ["bug", "cleanup"])
        self.assertEqual(self.asked(), ["pr view 12 --repo acme/demo --json labels"])

    def test_no_answer_from_gh_is_a_runtime_error_in_its_words(self):
        with self.answering(exit_code=1, err="HTTP 502"), self.assertRaisesRegex(RuntimeError, "HTTP 502"):
            github.pr_labels("acme/demo", 12)

    def test_labels_of_another_shape_are_not_read_as_none(self):
        for body in ({}, {"labels": None}, {"labels": "cleanup"}, {"labels": [{"id": "L1"}]}, {"labels": [{"name": 3}]}):
            with self.subTest(body=body), self.answering(json.dumps(body)), self.assertRaises(RuntimeError):
                github.pr_labels("acme/demo", 12)

    def test_an_answer_that_is_not_json_is_a_runtime_error(self):
        with self.answering("not json"), self.assertRaises(RuntimeError):
            github.pr_labels("acme/demo", 12)


class BranchLabels(StubGh):
    def test_reads_the_labels_of_every_open_pr_of_a_branch_in_one_call(self):
        answer = [{"number": 7, "labels": labels("cleanup")}, {"number": 9, "labels": []}]
        with self.answering(json.dumps(answer)):
            self.assertEqual(github.branch_labels("acme/demo", "feat/1-demo"), [["cleanup"], []])
        self.assertEqual(self.asked(), ["pr list --repo acme/demo --head feat/1-demo --state open --json number,labels"])

    def test_a_branch_with_no_open_pr_has_none(self):
        with self.answering("[]"):
            self.assertEqual(github.branch_labels("acme/demo", "feat/1-demo"), [])

    def test_no_answer_or_another_shape_is_a_runtime_error(self):
        for out, code in (("", 1), ("{}", 0), ('[{"number": 7}]', 0), ("7 main", 0)):
            with self.subTest(out=out), self.answering(out, code), self.assertRaises(RuntimeError):
                github.branch_labels("acme/demo", "feat/1-demo")


class CommandLine(StubGh):
    """What the poller runs: `github.py cleanup <owner/repo> <pr>`."""

    def run_script(self, *args, out="", exit_code=0, err=""):
        env = dict(self.env, GH_OUT=out, GH_EXIT=str(exit_code), GH_ERR=err)
        return subprocess.run([sys.executable, str(SCRIPT), *args], capture_output=True, text=True, env=env)

    def test_a_labelled_pr_is_cleanup(self):
        done = self.run_script("cleanup", "acme/demo", "12", out=json.dumps({"labels": labels("cleanup")}))
        self.assertEqual((done.returncode, done.stdout.strip()), (0, "cleanup"))

    def test_an_unlabelled_pr_is_gated(self):
        for names in ((), ("bug",)):
            with self.subTest(names=names):
                done = self.run_script("cleanup", "acme/demo", "12", out=json.dumps({"labels": labels(*names)}))
                self.assertEqual((done.returncode, done.stdout.strip()), (0, "gated"))

    def test_no_answer_says_why_and_exits_1(self):
        done = self.run_script("cleanup", "acme/demo", "12", exit_code=1, err="HTTP 502")
        self.assertEqual((done.returncode, done.stdout), (1, ""))
        self.assertIn("HTTP 502", done.stderr)

    def test_a_wrong_call_exits_2(self):
        for args in ((), ("cleanup", "acme/demo"), ("labels", "acme/demo", "12"), ("cleanup", "acme/demo", "twelve")):
            with self.subTest(args=args):
                self.assertEqual(self.run_script(*args).returncode, 2)


if __name__ == "__main__":
    unittest.main()
