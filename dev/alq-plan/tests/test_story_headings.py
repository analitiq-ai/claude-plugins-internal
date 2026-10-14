"""story_headings.py: each story heading of spec.md is in Spec Kit's form with a number of its own, and a rescope
numbers a new story above every story spec.md had when the run found it."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from paths import SCRIPTS

import story_headings


def heading(number, title=None, priority=1):
    return f"### User Story {number} - {title or f'Story {number}'} (Priority: P{priority})"


def spec(*headings):
    """spec.md with one story under each heading; an int is that story's heading in the form."""
    stories = "".join(f"{heading(h) if isinstance(h, int) else h}\n\nA maintainer does a thing.\n\n" for h in headings)
    return f"# Demo\n\n## User Scenarios & Testing\n\n{stories}## Requirements\n\n- x\n"


class Form(unittest.TestCase):
    def assert_one_problem(self, found, *said):
        self.assertEqual(len(found), 1, found)
        for phrase in (*said, "Next step:"):
            self.assertIn(phrase, found[0])

    def test_stories_in_the_form_each_with_its_own_number_pass(self):
        self.assertEqual(story_headings.problems(spec(1, 2, heading(3, "Land it", 2)), None), [])

    def test_a_spec_with_no_stories_passes(self):
        self.assertEqual(story_headings.problems("# Demo\n\n## Requirements\n\n- x\n", None), [])

    def test_a_story_heading_not_in_the_form_is_a_problem_naming_it_and_its_line(self):
        for bad in ("### User Story 1: Demo (Priority: P1)", "### User Story 1 - Demo", "## User Story 1 - Demo (Priority: P1)",
                    "### User Story One - Demo (Priority: P1)", "### User story 1 - Demo (Priority: P1)",
                    "### User Story 1 -  (Priority: P1)", "### User Story 1 – Demo (Priority: P1)",
                    "### User Story 1 - Demo (Priority: 1)", "#### User Story 1 - Demo (Priority: P1) extra"):
            with self.subTest(bad):
                found = story_headings.problems(spec(bad, 2), None)
                self.assert_one_problem(found, bad, "line 5", story_headings.FORM)

    def test_two_stories_with_one_number_is_a_problem_naming_both_headings(self):
        first, second = heading(2, "Name the folder"), heading(2, "Land the PR")
        self.assert_one_problem(story_headings.problems(spec(1, first, second), None), first, second, "number 2")


class Rescope(unittest.TestCase):
    """Against spec.md as the run found it: a story that was there keeps its number, a new one is numbered above
    every number that was there, and a dropped number is not taken again."""
    FOUND = spec(1, 2, 3)

    def test_a_new_story_numbered_above_every_story_there_was_passes_with_one_dropped(self):
        self.assertEqual(story_headings.problems(spec(1, 3, 4), self.FOUND), [])

    def test_dropping_stories_passes(self):
        self.assertEqual(story_headings.problems(spec(1, 3), self.FOUND), [])

    def test_a_new_story_at_a_number_dropped_before_the_run_is_a_problem_naming_the_numbers(self):
        [problem] = story_headings.problems(spec(1, 2, 3), spec(1, 3))
        self.assertIn(heading(2), problem)
        self.assertIn("1 and 3", problem)
        self.assertIn("above 3", problem)
        self.assertIn("Next step:", problem)

    def test_a_story_renumbered_into_a_dropped_number_is_a_problem_naming_the_numbers(self):
        [problem] = story_headings.problems(spec(1, heading(2, "Story 3")), spec(1, 3))
        self.assertIn(heading(2, "Story 3"), problem)
        self.assertIn("above 3", problem)

    def test_each_new_story_below_the_highest_number_is_its_own_problem(self):
        found = story_headings.problems(spec(1, 2, 4, 5, 6), spec(1, 5))
        self.assertEqual(len(found), 2, found)
        self.assertIn(heading(2), found[0])
        self.assertIn(heading(4), found[1])

    def test_a_spec_that_had_no_stories_grades_only_the_form_of_those_it_has_now(self):
        found_with_none = "# Old\n\nScoped before story headings were checked.\n"
        self.assertEqual(story_headings.problems(spec(1, 2), found_with_none), [])
        [problem] = story_headings.problems(spec(1, "### User Story 2 - Demo"), found_with_none)
        self.assertIn(story_headings.FORM, problem)

    def test_the_form_of_the_spec_as_found_is_not_graded(self):
        self.assertEqual(story_headings.problems(spec(1, 2), spec(1, "### User Story 2: Old")), [])

    def test_form_and_numbering_problems_are_both_reported(self):
        found = story_headings.problems(spec(1, 2, "### User Story 4: Demo"), spec(1, 3))
        self.assertEqual(len(found), 2, found)


class Cli(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder = Path(tmp.name) / "specs" / "7-demo"
        self.folder.mkdir(parents=True)
        self.found = Path(tmp.name) / "spec-as-found.md"

    def run_cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPTS / "story_headings.py"), *args], capture_output=True,
                              text=True)

    def test_a_spec_in_the_form_passes_with_and_without_the_spec_as_found(self):
        (self.folder / "spec.md").write_text(spec(1, 3, 4))
        self.found.write_text(spec(1, 2, 3))
        for args in ((), (str(self.found),)):
            with self.subTest(args=args):
                done = self.run_cli("check", str(self.folder), *args)
                self.assertEqual((done.returncode, done.stderr), (0, ""))

    def test_each_problem_is_printed_naming_spec_md(self):
        (self.folder / "spec.md").write_text(spec(1, 2, 3))
        self.found.write_text(spec(1, 3))
        done = self.run_cli("check", str(self.folder), str(self.found))
        self.assertEqual(done.returncode, 1)
        self.assertTrue(done.stderr.startswith(f"{self.folder / 'spec.md'}: "), done.stderr)
        self.assertEqual(len(done.stderr.splitlines()), 1, done.stderr)

    def test_a_missing_spec_md_a_missing_spec_as_found_or_a_wrong_call_cannot_be_checked(self):
        self.assertEqual(self.run_cli("check", str(self.folder)).returncode, 2)
        (self.folder / "spec.md").write_text(spec(1))
        for args in (("check", str(self.folder), str(self.found)), ("check",), (str(self.folder),)):
            with self.subTest(args=args):
                done = self.run_cli(*args)
                self.assertEqual(done.returncode, 2)
                self.assertIn("could not run", done.stderr)


if __name__ == "__main__":
    unittest.main()
