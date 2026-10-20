"""deepsource-pr-gate.sh against a fake gh serving DeepSource's real summary comments."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from paths import PLUGIN

HERE = Path(__file__).resolve().parent
GATE = PLUGIN / "skills" / "github-pr-review" / "deepsource-pr-gate.sh"
GRADE_A = (HERE / "fixtures" / "deepsource-grade-a.html").read_text()          # reviews 28ad046...babd121
GRADE_B = (HERE / "fixtures" / "deepsource-grade-b-python-failed.html").read_text()  # reviews 034d6f8...4b982f3
DEEPSOURCE = "deepsource-io[bot]"

FAKE_GH = r'''#!/usr/bin/env python3
import json, os, sys
args = sys.argv[1:]
if args[:2] == ["pr", "view"]:
    print(json.dumps({"headRefOid": os.environ["FAKE_HEAD"]}))
elif args[:1] == ["api"] and args[1].endswith("/issues/7/comments"):
    comments = json.loads(os.environ["FAKE_COMMENTS"])
    # --paginate prints one array per page.
    print(json.dumps(comments[:1]))
    print(json.dumps(comments[1:]))
else:
    sys.stderr.write("fake gh: unexpected call: %r\n" % (args,))
    sys.exit(99)
'''


def comment(author, body):
    return {"user": {"login": author}, "body": body, "html_url": "https://github.com/acme/demo/pull/7#issuecomment-1"}


class DeepSourceGate(unittest.TestCase):
    def setUp(self):
        self.bin = Path(tempfile.mkdtemp())
        self.addCleanup(subprocess.run, ["rm", "-rf", str(self.bin)])
        (self.bin / "gh").write_text(FAKE_GH)
        (self.bin / "gh").chmod(0o755)

    def gate(self, head, *comments):
        env = dict(os.environ, FAKE_HEAD=head, FAKE_COMMENTS=json.dumps(list(comments)),
                   PATH=f"{self.bin}{os.pathsep}{os.environ['PATH']}")
        return subprocess.run(["bash", str(GATE), "acme/demo", "7"], env=env, capture_output=True, text=True,
                              timeout=60)

    def test_grade_a_with_every_analyzer_passed_on_the_head_passes(self):
        done = self.gate("babd121" + "0" * 33, comment("someone", "hi"), comment(DEEPSOURCE, GRADE_A))
        self.assertEqual(done.returncode, 0, done.stdout + done.stderr)
        self.assertIn("Overall Grade: A", done.stdout)
        self.assertIn("Python passed", done.stdout)
        self.assertIn("https://app.deepsource.com/gh/analitiq-ai/claude-code-plugins/run/3999f2b7-a80c-4cba-8a32-f2ffd0b42510/", done.stdout)

    def test_below_a_reports_every_dimension_and_analyzer(self):
        done = self.gate("4b982f3" + "0" * 33, comment(DEEPSOURCE, GRADE_B))
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        for fact in ("Overall Grade: B", "Security: A", "Reliability: A", "Complexity: A", "Hygiene: D",
                     "Python failed", "Docker passed", "Shell passed", "Secrets passed"):
            self.assertIn(fact, done.stdout)
        self.assertIn("get_run_report", done.stdout)

    def test_grade_a_with_an_analyzer_not_passed_is_below_a(self):
        timed_out = GRADE_A.replace("light/status_passed.svg", "light/status_timed_out.svg", 2)
        done = self.gate("babd121" + "0" * 33, comment(DEEPSOURCE, timed_out))
        self.assertEqual(done.returncode, 2, done.stdout + done.stderr)
        self.assertIn("Python timed_out", done.stdout)

    def test_a_summary_of_an_older_commit_is_not_yet_a_verdict(self):
        done = self.gate("feed123" + "0" * 33, comment(DEEPSOURCE, GRADE_A))
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)
        self.assertIn("babd121", done.stdout)
        self.assertIn("feed123", done.stdout)

    def test_no_summary_yet_is_not_yet_a_verdict(self):
        done = self.gate("babd121" + "0" * 33, comment("someone", "hi"))
        self.assertEqual(done.returncode, 3, done.stdout + done.stderr)

    def test_an_unrecognised_analyzer_status_fails_loud(self):
        odd = GRADE_A.replace("light/status_passed.svg", "light/status_queued.svg", 2)
        done = self.gate("babd121" + "0" * 33, comment(DEEPSOURCE, odd))
        self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
        self.assertIn("queued", done.stderr)

    def test_a_summary_without_an_overall_grade_fails_loud(self):
        done = self.gate("babd121" + "0" * 33, comment(DEEPSOURCE, GRADE_A.replace("Overall Grade", "Grade")))
        self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
        self.assertIn("Overall Grade", done.stderr)

    def test_an_analyzer_row_the_parser_cannot_read_fails_loud(self):
        unreadable = GRADE_A.replace(
            '<img src="https://static.deepsource.com/comment_artifacts/light/status_passed.svg" height="20"/></picture>',
            '</picture>Queued', 1)
        unreadable = unreadable.replace("light/status_passed.svg", "light/queued.svg", 2)
        done = self.gate("babd121" + "0" * 33, comment(DEEPSOURCE, unreadable))
        self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
        self.assertIn("analyzer", done.stderr)

    def test_a_summary_without_analyzers_fails_loud(self):
        done = self.gate("babd121" + "0" * 33, comment(DEEPSOURCE, GRADE_A.replace("<td><strong>", "<td><b>")))
        self.assertEqual(done.returncode, 1, done.stdout + done.stderr)
        self.assertIn("analyzer", done.stderr)


if __name__ == "__main__":
    unittest.main()
