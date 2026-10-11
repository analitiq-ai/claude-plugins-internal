"""What the issue-spec skill and the planning workflow say about where the spec is and how they read values."""
import re
import unittest
from pathlib import Path

from paths import PLUGIN

import premise_report

ISSUE_SPEC = PLUGIN / "skills" / "issue-spec" / "SKILL.md"
WORKFLOW = PLUGIN / "speckit" / "workflows" / "alq-spec" / "workflow.yml"
OLD_HOME_PHRASES = ("spec lives on the issue", "spec lives **on the issue**", "its only home")


def squashed(path: Path) -> str:
    return re.sub(r"\s+", " ", path.read_text())


class CommandSubstitution(unittest.TestCase):
    """A `$(...)` inside another command's arguments does not stop the shell when it fails: the command runs on an
    empty value (`git diff ...HEAD` is an empty diff; `gh --repo ""` picks another remote's repo). A value is read
    on its own, as `name=$(...)`, before the command that uses it."""
    READ_ON_ITS_OWN = re.compile(r"^\s*\w+=\$\(")

    def test_no_command_the_skill_or_the_planning_workflow_give_reads_a_value_inside_its_arguments(self):
        commands = [("SKILL.md", c) for c in re.findall(r"`([^`]+)`", ISSUE_SPEC.read_text())]
        commands += [("workflow.yml", line) for line in WORKFLOW.read_text().splitlines()]
        for where, command in commands:
            if "$(" not in command:
                continue
            with self.subTest(where=where, command=command):
                self.assertTrue(self.READ_ON_ITS_OWN.match(command) and command.count("$(") == 1)


class IssueSpecSkill(unittest.TestCase):
    """What /alq-plan:issue-spec takes, how it starts the driver, and what it ends with."""
    FORMS = ("#<issue> [<dir>]", "rescope <spec folder> #<issue>")
    ORIGIN = 'repo=$(git remote get-url origin) && gh issue view <ISSUE> --repo "$repo" '

    def test_takes_its_two_forms_and_refuses_anything_else_naming_them(self):
        text = ISSUE_SPEC.read_text()
        for form in self.FORMS:
            with self.subTest(form=form):
                self.assertIn(f"- **`{form}`**", text)
        hint = re.search(r'^argument-hint: "(.*)"$', text, re.M).group(1)
        self.assertEqual(hint, " | ".join(self.FORMS))
        said = [s for s in re.split(r"(?<=\.)\s+", squashed(ISSUE_SPEC)) if s.startswith("Anything else")]
        self.assertTrue([s for s in said if "the two forms" in s and "stop" in s], said)

    def test_starts_the_driver_with_the_spec_file_and_the_issue_then_the_folder_on_a_rescope(self):
        self.assertIn("`python3 DRIVE start <SPEC_FILE> <ISSUE>`, plus `<SPEC_DIR>` on a rescope.", squashed(ISSUE_SPEC))

    def test_a_completed_run_ends_with_the_spec_folder_and_branch_lines(self):
        text = squashed(ISSUE_SPEC)
        self.assertIn("End with two lines and nothing after them: `Spec folder: <path>`", text)
        self.assertIn("`Branch: <branch>`", text)

    def test_a_rescope_runs_in_the_issues_existing_worktree_and_never_creates_one(self):
        """A fresh branch would take the re-scoped spec away from the PR it was held for."""
        rescope = re.search(r"^- \*\*`rescope .*?(?=^- \*\*|^$)", ISSUE_SPEC.read_text(), re.M | re.S).group(0)
        rescope = re.sub(r"\s+", " ", rescope)
        self.assertIn("never creates one", rescope)
        self.assertIn("the PR bound to that spec folder", rescope)
        self.assertIn("stop and ask the user", rescope)

    def test_a_rescope_writes_the_issue_as_first_stated_then_the_open_decision(self):
        """The folder may hold the wrong scope: the issue is read again from GitHub, not taken from the folder."""
        rescope = re.search(r"^- \*\*`rescope .*?(?=^- \*\*|^$)", ISSUE_SPEC.read_text(), re.M | re.S).group(0)
        rescope = re.sub(r"\s+", " ", rescope)
        self.assertIn("the issue is re-read as first stated: write it to `SPEC_FILE` with the same `gh issue view` "
                      "command, then append", rescope)
        self.assertLess(rescope.index("`gh issue view`"), rescope.index("`Open decision: …`"))

    def test_no_spec_needed_tells_the_user_to_pass_a_null_spec_at_review(self):
        """The one value review will take for this PR; nothing else tells the user."""
        said = [s for s in re.split(r"(?<=\.)\s+", squashed(ISSUE_SPEC)) if s.startswith("After `no spec needed`")]
        self.assertTrue([s for s in said if "tell the user to pass `spec: null` when the work is reviewed" in s], said)

    def test_every_issue_view_names_the_repo_by_origins_url(self):
        """The same repo the workflow closes a not-worth-doing issue in. origin is read before gh runs: a failed read
        inside gh's arguments leaves `--repo ""`, and gh picks a repo from the other remotes."""
        calls = re.findall(r"`([^`]*gh issue view [^`]*)`", ISSUE_SPEC.read_text())
        self.assertTrue(calls)
        for call in calls:
            with self.subTest(call=call):
                self.assertTrue(call.startswith(self.ORIGIN), call)

    def test_names_the_premise_form_the_report_its_recommendation_and_pick_and_the_resume_in_that_order(self):
        text = squashed(ISSUE_SPEC)
        steps = ["PREMISE form", ".specify/workflows/runs/<run_id>/premise-report.md",
                 f"`{premise_report.RECOMMENDATION}:`", f"`{premise_report.PICK}:`", 'premise_verdict=<pick>"',
                 "/speckit-grill-me"]
        positions = [text.find(step) for step in steps]
        self.assertNotIn(-1, positions, list(zip(steps, positions)))
        self.assertEqual(positions, sorted(positions))
        for outcome in premise_report.OUTCOMES:
            with self.subTest(outcome=outcome):
                self.assertIn(f"`{outcome}`", text)
        self.assertIn("Never ask for approve or reject at this step.", text)
        self.assertIn("Ask the user only what the issue and the code cannot answer.", text)

    def test_says_a_failed_run_leaves_nothing_behind(self):
        text = squashed(ISSUE_SPEC)
        self.assertIn("A run that is rejected or fails commits nothing and pushes nothing.", text)

    def test_holds_none_of_the_old_home_phrases(self):
        text = squashed(ISSUE_SPEC).lower()
        for phrase in OLD_HOME_PHRASES:
            with self.subTest(phrase=phrase):
                self.assertNotIn(phrase, text)


if __name__ == "__main__":
    unittest.main()
