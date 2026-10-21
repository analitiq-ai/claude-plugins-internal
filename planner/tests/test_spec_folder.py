"""spec_folder.py: the one check of the run's folder input before anything is written, and of the folder `specify`
recorded after it ran.

The checks are pure: they are handed what the project's `specs/`, the folder's spec.md and `.specify/feature.json`
hold, and read nothing.
"""
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from paths import SCRIPTS

import no_spec
import spec_folder
from premise_report import NO_SPEC
from test_premise_report import report
from test_rootcause import SPEC

FORM = "specs/<issue>-<short-name>"


def problems(folder, issue, kind, existing, project=""):
    """A project at the checkout's root, unless a test says where in the checkout it is."""
    return spec_folder.problems(folder, issue, kind, existing, project)


class Check(unittest.TestCase):
    """problems(folder, issue, kind, existing): `existing` maps each folder name in `specs/` to whether it holds a
    spec.md."""

    def assert_one_problem(self, found, *said):
        self.assertEqual(len(found), 1, found)
        for phrase in (*said, "Next step:"):
            self.assertIn(phrase, found[0])

    def test_a_new_folder_named_by_its_issue_passes(self):
        for folder, issue in (("specs/79-spec-folder-by-issue", "79"), ("specs/7-a1-b2", "7"), ("specs/7-x", "7")):
            with self.subTest(folder):
                self.assertEqual(problems(folder, issue, "new", {}), [])

    def test_a_folder_not_of_the_form_is_refused_naming_the_form(self):
        for kind in ("new", "rescope"):
            for folder in ("79-x", "specs/79-", "specs/79", "specs/79-X", "specs/79-a_b", "specs/79-a b",
                           "specs/79-a--b", "specs/79--a", "specs/79-a-", "specs/79-x/y", "specs/../79-x",
                           "dev/planner/specs/79-x", "specs/x-79", "specs/", "", "specs/79-x'; touch PWNED; '"):
                with self.subTest(kind=kind, folder=folder):
                    self.assert_one_problem(problems(folder, "79", kind, {"79-x": True}), FORM)

    def test_a_folder_numbered_for_another_issue_is_refused_naming_the_prefix_it_needs(self):
        """The number is the issue's as GitHub writes it: no padding, and the hyphen is part of the prefix."""
        for kind in ("new", "rescope"):
            for folder, issue in (("specs/079-x", "79"), ("specs/79-x", "7"), ("specs/7-x", "79")):
                with self.subTest(kind=kind, folder=folder, issue=issue):
                    name = folder.removeprefix("specs/")
                    self.assert_one_problem(problems(folder, issue, kind, {name: True}),
                                            f"does not start with `{issue}-`")

    def test_a_new_scope_of_an_issue_that_has_a_folder_is_refused_naming_the_rescope_form(self):
        for folder in ("specs/7-other", "specs/7-demo"):
            for holds_spec in (True, False):
                with self.subTest(folder=folder, holds_spec=holds_spec):
                    self.assert_one_problem(problems(folder, "7", "new", {"7-demo": holds_spec}),
                                            "`rescope specs/7-demo #7`")

    def test_every_refusal_names_its_folders_from_the_checkout_the_project_is_in(self):
        """A rescope's folder is read from the checkout, so a refusal names every folder from there."""
        cases = {
            "form": (("specs/7_x", "7", "new", {}), ["`dev/x/specs/7_x`"]),
            "not this issue": (("specs/8-x", "7", "new", {}), ["`dev/x/specs/8-x`"]),
            "rescope form": (("specs/7-x", "7", "new", {"7-demo": True}), ["`rescope dev/x/specs/7-demo #7`"]),
            "no spec.md": (("specs/7-demo", "7", "rescope", {"7-demo": False}), ["`dev/x/specs/7-demo`"]),
            "besides and other folders": (("specs/7-demo", "7", "rescope", {"7-demo": True, "7-other": True}),
                                          ["besides `dev/x/specs/7-demo`", "`dev/x/specs/7-other`"]),
        }
        for refusal, (args, said) in cases.items():
            with self.subTest(refusal):
                self.assert_one_problem(problems(*args, project="dev/x/"), *said)

    def test_a_rescope_of_the_issues_one_folder_passes_in_a_project_under_the_checkout(self):
        self.assertEqual(problems("specs/7-demo", "7", "rescope", {"7-demo": True, "8-other": True},
                                  project="dev/x/"), [])

    def test_folders_of_other_issues_do_not_refuse_a_new_scope(self):
        existing = {"70-x": True, "17-y": True, "8-z": True, "007-old": True, "7": True}
        self.assertEqual(problems("specs/7-demo", "7", "new", existing), [])

    def test_a_rescope_of_the_issues_own_folder_passes(self):
        self.assertEqual(problems("specs/7-demo", "7", "rescope", {"7-demo": True, "8-other": True}), [])

    def test_a_rescope_of_a_folder_with_no_spec_md_is_refused(self):
        for existing in ({}, {"7-demo": False}):
            with self.subTest(existing=existing):
                self.assert_one_problem(problems("specs/7-demo", "7", "rescope", existing),
                                        "specs/7-demo", "spec.md")

    def test_a_rescope_of_another_issues_folder_is_refused_saying_its_name_does_not_start_with_the_issue(self):
        self.assert_one_problem(problems("specs/7-demo", "8", "rescope", {"7-demo": True}),
                                "specs/7-demo", "does not start with `8-`")

    def test_a_rescope_while_the_issue_has_a_second_folder_is_refused_naming_it(self):
        found = problems("specs/7-demo", "7", "rescope", {"7-demo": True, "7-other": False})
        self.assert_one_problem(found, "specs/7-other")

    def test_an_issue_that_is_not_a_number_as_github_writes_it_is_refused(self):
        for issue in ("", "07", "x", "#7", "7 "):
            with self.subTest(issue=issue):
                self.assert_one_problem(problems("specs/7-demo", issue, "new", {}), "issue")

    def test_a_kind_other_than_new_or_rescope_cannot_be_checked(self):
        with self.assertRaises(ValueError):
            problems("specs/7-demo", "7", "", {})


class Cli(unittest.TestCase):
    def test_a_check_outside_a_git_checkout_cannot_run_and_says_why(self):
        """The project's folder in the checkout comes from git, so git's own reason is what the step shows."""
        env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
        with tempfile.TemporaryDirectory() as outside:
            done = subprocess.run([sys.executable, str(SCRIPTS / "spec_folder.py"), "check", "specs/7-x", "7", "new"],
                                  cwd=outside, env={**env, "GIT_CEILING_DIRECTORIES": str(Path(outside).parent)},
                                  capture_output=True, text=True)
        self.assertEqual(done.returncode, 2, done.stderr)
        self.assertIn("not a git repository", done.stderr)


class StartsAt(unittest.TestCase):
    """starts_at(kind, spec): where a run whose folder passed the check starts, decided once for the run."""

    def test_a_new_scope_starts_at_the_premise(self):
        self.assertEqual(spec_folder.starts_at("new", None), "premise")

    def test_a_rescope_of_a_no_spec_folder_starts_at_the_premise_and_of_a_spec_at_grill(self):
        """A no-spec spec.md has nothing to grill."""
        no_spec_md = no_spec.text(report(NO_SPEC, rests_on="needs-spec", reason="a typo", wrong="no"))
        self.assertEqual(spec_folder.starts_at("rescope", no_spec_md), "premise")
        self.assertEqual(spec_folder.starts_at("rescope", SPEC.format(section="Not a defect report.")), "grill")


class Recorded(unittest.TestCase):
    """recorded_problems(folder, recorded): `recorded` is the folder `.specify/feature.json` names, None for none."""

    def test_the_folder_the_run_was_given_passes(self):
        self.assertEqual(spec_folder.recorded_problems("specs/7-new", "specs/7-new"), [])

    def test_another_folder_or_none_is_refused_naming_both_and_the_next_step(self):
        for recorded, said in (("specs/001-new", "`specs/001-new`"), ("specs/7-new/", "`specs/7-new/`"),
                               (None, "no folder")):
            with self.subTest(recorded=recorded):
                found = spec_folder.recorded_problems("specs/7-new", recorded)
                self.assertEqual(len(found), 1, found)
                for phrase in (said, "`specs/7-new`", "Next step:"):
                    self.assertIn(phrase, found[0])


if __name__ == "__main__":
    unittest.main()
