"""rootcause.py: spec.md carries a labelled `## Root cause` section."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from paths import SCRIPTS
from test_premise_report import report, spec_section

import rootcause

SPEC = "# Demo\n\n" + spec_section() + "## Root cause\n\n{section}\n\n## Requirements\n\n- x\n"
DEFECT, NOT_A_DEFECT = report(wrong="yes"), report(wrong="no")


class Section(unittest.TestCase):
    def problems(self, section, premise_report=None):
        return rootcause.problems(SPEC.format(section=section), premise_report)

    def assert_one_problem(self, found, *said):
        self.assertEqual(len(found), 1, found)
        for phrase in (*said, "Next step:"):
            self.assertIn(phrase, found[0])

    def test_a_section_that_opens_with_what_was_observed_passes(self):
        for opening in ("Observed: test_gate fails on main with a KeyError.",
                        "Observed: nothing; this trace is a hypothesis from reading the code."):
            with self.subTest(opening):
                self.assertEqual(self.problems(f"{opening}\n\nThe ledger drops the verdict.", DEFECT), [])

    def test_a_spec_with_no_root_cause_heading_is_a_problem(self):
        self.assert_one_problem(rootcause.problems("# Demo\n\n## Requirements\n\n- x\n", DEFECT), "## Root cause")

    def test_a_section_that_opens_with_anything_else_is_a_problem(self):
        for section in ("The ledger drops the verdict.\n\nObserved: a KeyError.", "", "observed: a KeyError",
                        "<!-- Observed: fill this in -->\nThe ledger drops the verdict."):
            with self.subTest(section):
                self.assert_one_problem(self.problems(section, DEFECT), "Observed:")

    def test_an_observed_line_that_names_nothing_is_a_problem(self):
        for section in ("Observed:", "Observed:   ", "Observed: [the failing test this trace is anchored to]"):
            with self.subTest(section):
                self.assert_one_problem(self.problems(f"{section}\n\nThe ledger drops the verdict.", DEFECT),
                                        "Observed:")

    def test_an_observed_line_that_starts_with_a_bracket_and_goes_on_passes(self):
        self.assertEqual(self.problems("Observed: [ERROR] pipeline 12 failed at load, in the run log", DEFECT), [])

    def test_a_second_root_cause_heading_is_a_problem(self):
        twice = SPEC.format(section="Observed: a KeyError.") + f"\n{rootcause.HEADING}\n\n{rootcause.NOT_A_DEFECT}\n"
        self.assert_one_problem(rootcause.problems(twice, DEFECT), f"`{rootcause.HEADING}` heading")

    def test_a_premise_report_that_does_not_say_yes_or_no_cannot_grade_the_section(self):
        for text in ("garbage", report(wrong="Yes"), NOT_A_DEFECT + "Reports wrong behaviour: yes\n"):
            with self.subTest(text[:30]):
                with self.assertRaises(ValueError):
                    self.problems(rootcause.NOT_A_DEFECT, text)

    def test_a_change_that_is_no_defect_says_so_under_the_heading(self):
        self.assertEqual(self.problems(rootcause.NOT_A_DEFECT, NOT_A_DEFECT), [])

    def test_a_defect_cannot_be_passed_off_as_no_defect(self):
        self.assert_one_problem(self.problems(rootcause.NOT_A_DEFECT, DEFECT), "Reports wrong behaviour: yes",
                                rootcause.NOT_A_DEFECT)

    def test_a_re_scope_has_no_premise_report_to_contradict(self):
        self.assertEqual(self.problems(rootcause.NOT_A_DEFECT), [])
        self.assertEqual(self.problems("Observed: a KeyError."), [])

    def test_a_later_sections_observed_line_is_not_this_sections(self):
        text = "# Demo\n\n## Root cause\n\n## Notes\n\nObserved: a KeyError.\n"
        self.assert_one_problem(rootcause.problems(text, DEFECT), "Observed:")


class Cli(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder = Path(tmp.name) / "specs" / "7-demo"
        self.folder.mkdir(parents=True)
        self.report = Path(tmp.name) / "premise-report.md"
        self.report.write_text(DEFECT)

    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPTS / "rootcause.py"), "check", str(self.folder), *args],
                              capture_output=True, text=True)

    def test_a_labelled_section_passes_with_and_without_a_report(self):
        (self.folder / "spec.md").write_text(SPEC.format(section="Observed: a KeyError."))
        for args in ((), (str(self.report),)):
            done = self.run_cli(*args)
            self.assertEqual((done.returncode, done.stderr), (0, ""))

    def test_a_problem_is_printed_naming_spec_md(self):
        (self.folder / "spec.md").write_text(SPEC.format(section=rootcause.NOT_A_DEFECT))
        done = self.run_cli(str(self.report))
        self.assertEqual(done.returncode, 1)
        self.assertTrue(done.stderr.startswith(f"{self.folder / 'spec.md'}: "), done.stderr)

    def test_a_folder_with_no_spec_md_or_a_named_report_that_is_missing_cannot_be_checked(self):
        self.assertEqual(self.run_cli().returncode, 2)
        (self.folder / "spec.md").write_text(SPEC.format(section="Observed: a KeyError."))
        self.assertEqual(self.run_cli(str(self.report) + ".gone").returncode, 2)

    def test_a_report_that_cannot_be_read_is_a_check_that_could_not_run(self):
        (self.folder / "spec.md").write_text(SPEC.format(section=rootcause.NOT_A_DEFECT))
        self.report.write_text("garbage")
        done = self.run_cli(str(self.report))
        self.assertEqual(done.returncode, 2)
        self.assertIn("Reports wrong behaviour:", done.stderr)


if __name__ == "__main__":
    unittest.main()
