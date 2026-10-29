"""no_spec.py: the spec.md of a `no spec needed` pick, written from the premise report, and told apart from a spec."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from paths import SCRIPTS
from test_premise_report import report
from test_rootcause import SPEC

import no_spec
from premise_report import NO_SPEC

REASON = "a typo, fixed by the request"
NO_SPEC_REPORT = report(NO_SPEC, rests_on="needs-spec", reason=REASON, wrong="no")


class Folder(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.folder = self.root / "specs" / "7-demo"
        self.report = self.root / "premise-report.md"
        self.report.write_text(NO_SPEC_REPORT)

    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPTS / "no_spec.py"), *args], cwd=self.root,
                              capture_output=True, text=True, check=False)

    def test_write_creates_the_folder_with_a_spec_md_that_says_no_spec_is_needed_and_nothing_else(self):
        done = self.run_cli("write", str(self.folder), str(self.report))
        self.assertEqual((done.returncode, done.stderr), (0, ""))
        self.assertEqual([p.name for p in self.folder.iterdir()], ["spec.md"])
        lines = (self.folder / "spec.md").read_text().splitlines()
        self.assertIn("no spec", lines[0].lower())
        self.assertIn("Rests on: needs-spec", lines)
        self.assertIn(f"Reason: {REASON}", lines)

    def test_what_it_writes_is_a_no_spec_spec_md_and_a_spec_is_not(self):
        self.assertTrue(no_spec.is_no_spec(no_spec.text(NO_SPEC_REPORT)))
        for spec in (SPEC.format(section="Not a defect report."), "", "# Demo\n\nRests on: needs-spec\n"):
            with self.subTest(spec=spec[:20]):
                self.assertFalse(no_spec.is_no_spec(spec))

    def test_a_leading_front_matter_block_does_not_hide_which_one_it_is(self):
        """spec_facts.ts writes the `codeworks` block at the top of both."""
        front_matter = "---\ncodeworks:\n  v: 1\n  kind: no_spec\n  root_cause:\n    observed: none\n---\n"
        self.assertTrue(no_spec.is_no_spec(front_matter + no_spec.text(NO_SPEC_REPORT)))
        self.assertFalse(no_spec.is_no_spec(front_matter + SPEC.format(section="Not a defect report.")))

    def test_a_second_no_spec_pick_writes_the_spec_md_again_from_its_own_report(self):
        """A rescope of a no-spec folder that picks `no spec needed` again."""
        self.run_cli("write", str(self.folder), str(self.report))
        self.report.write_text(report(NO_SPEC, rests_on="change-alters", reason="the request fixes it", wrong="no"))
        done = self.run_cli("write", str(self.folder), str(self.report))
        self.assertEqual((done.returncode, done.stderr), (0, ""))
        lines = (self.folder / "spec.md").read_text().splitlines()
        self.assertIn("Rests on: change-alters", lines)
        self.assertIn("Reason: the request fixes it", lines)
        self.assertEqual([p.name for p in self.folder.iterdir()], ["spec.md"])

    def test_a_report_without_the_question_or_the_reason_writes_nothing_and_names_the_next_step(self):
        for unreadable in (report(NO_SPEC, reason=REASON, wrong="no"),
                           report(NO_SPEC, rests_on="needs-spec", wrong="no"),
                           NO_SPEC_REPORT + "Reason: another\n"):
            with self.subTest(unreadable=unreadable[-40:]):
                self.report.write_text(unreadable)
                done = self.run_cli("write", str(self.folder), str(self.report))
                self.assertEqual(done.returncode, 2)
                self.assertIn("Next step: run `premise_report.py check", done.stderr)
                self.assertFalse(self.folder.exists())

    def test_a_folder_that_cannot_be_written_names_the_path_and_says_to_clear_it(self):
        """The report is good: what is wrong is the path, and checking the report again would not fix it. Whether
        the run resumes is the skill's to say, not the script's."""
        (self.root / "specs").write_text("in the way\n")
        done = self.run_cli("write", str(self.folder), str(self.report))
        self.assertEqual(done.returncode, 2)
        for said in (str(self.root / "specs"), "Next step: make that path writable or clear what is in its way."):
            self.assertIn(said, done.stderr)
        for unsaid in ("premise_report.py check", "resume", "DRIVE"):
            self.assertNotIn(unsaid, done.stderr)

    def test_a_report_that_is_not_there_writes_nothing(self):
        done = self.run_cli("write", str(self.folder), str(self.root / "gone.md"))
        self.assertEqual(done.returncode, 2)
        self.assertFalse(self.folder.exists())

    def test_anything_but_write_with_a_folder_and_a_report_cannot_run(self):
        for args in ((), ("write", str(self.folder)), ("read", str(self.folder), str(self.report))):
            with self.subTest(args=args):
                self.assertEqual(self.run_cli(*args).returncode, 2)


if __name__ == "__main__":
    unittest.main()
