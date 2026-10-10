"""What the alq-issue-tackle, alq-root-cause-check and alq-spec skills say about where the spec is."""
import re
import subprocess
import unittest
from pathlib import Path

from paths import PLUGIN, REPO

import helpers  # noqa: F401  puts scripts/ on the path

import premise_report

SKILLS = PLUGIN / "skills"
TACKLE = SKILLS / "alq-issue-tackle" / "SKILL.md"
ROOT_CAUSE = SKILLS / "alq-root-cause-check" / "SKILL.md"
ALQ_SPEC = SKILLS / "alq-spec" / "SKILL.md"
GATE = PLUGIN / "scripts" / "gate.py"
# Spelled in two halves so that this file is not itself a hit.
DELETED_SKILL = "alq-" + "shape"
# The planning skill's old name, with a hyphen or an underscore, in any case. "design document" is the
# settled-design rule's term and stays.
OLD_SKILL_NAME = re.compile("design[-_]" + "doc(?!ument)", re.I)
OLD_HOME_PHRASES = ("spec lives on the issue", "spec lives **on the issue**", "its only home")


def squashed(path: Path) -> str:
    return re.sub(r"\s+", " ", path.read_text())


class SpecSource(unittest.TestCase):
    def test_issue_tackle_drops_the_surface_rules_and_the_recheck_of_code_decisions(self):
        text = TACKLE.read_text()
        for phrase in ("Hand-maintained surfaces", "Write no copy", "(code)"):
            with self.subTest(phrase=phrase):
                self.assertNotIn(phrase, text)

    def test_nothing_in_the_plugin_or_its_tests_names_the_deleted_skill(self):
        named = [path.relative_to(REPO).as_posix()
                 for root in (PLUGIN, Path(__file__).parent) for path in root.rglob("*")
                 if path.is_file() and "__pycache__" not in path.parts
                 and DELETED_SKILL in path.read_text(errors="ignore")]
        self.assertEqual(named, [])

    def test_no_tracked_file_of_the_plugin_its_tests_the_spec_kit_files_or_ci_names_the_skill_by_its_old_name(self):
        # Tracked files only: a Spec Kit run leaves ignored state in the dev project, named after the workflow it ran.
        tracked = subprocess.run(["git", "ls-files", "-z", "plugins", "dev/alq-review/tests", "dev/alq-review/.specify",
                                  ".github"], cwd=REPO, capture_output=True, text=True, check=True).stdout
        named = [path for path in tracked.split("\0")
                 if path and OLD_SKILL_NAME.search(path + (REPO / path).read_text(errors="ignore"))]
        self.assertEqual(named, [])

    def test_alq_spec_names_the_premise_form_the_report_its_recommendation_and_pick_and_the_resume_in_that_order(self):
        text = squashed(ALQ_SPEC)
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

    def test_alq_spec_says_a_failed_run_leaves_nothing_behind(self):
        text = squashed(ALQ_SPEC)
        self.assertIn("A run that is rejected or fails commits nothing and pushes nothing.", text)

    def test_tackle_root_cause_alq_spec_and_the_gate_hold_none_of_the_old_home_phrases(self):
        for path in (TACKLE, ROOT_CAUSE, ALQ_SPEC, GATE):
            text = squashed(path).lower()
            for phrase in OLD_HOME_PHRASES:
                with self.subTest(file=path.relative_to(PLUGIN).as_posix(), phrase=phrase):
                    self.assertNotIn(phrase, text)


class CommandSubstitution(unittest.TestCase):
    """A `$(...)` inside another command's arguments does not stop the shell when it fails: the command runs on an
    empty value (`git diff ...HEAD` is an empty diff; `gh --repo ""` picks another remote's repo). A value is read
    on its own, as `name=$(...)`, before the command that uses it."""
    WORKFLOW = PLUGIN / "speckit" / "workflows" / "alq-spec" / "workflow.yml"
    READ_ON_ITS_OWN = re.compile(r"^\s*\w+=\$\(")

    def test_no_command_the_skills_or_the_planning_workflow_give_reads_a_value_inside_its_arguments(self):
        commands = [(s.parent.name, c) for s in (TACKLE, ROOT_CAUSE, ALQ_SPEC) for c in re.findall(r"`([^`]+)`", s.read_text())]
        commands += [("workflow.yml", line) for line in self.WORKFLOW.read_text().splitlines()]
        for where, command in commands:
            if "$(" not in command:
                continue
            with self.subTest(where=where, command=command):
                self.assertTrue(self.READ_ON_ITS_OWN.match(command) and command.count("$(") == 1)


class AlqSpecSkill(unittest.TestCase):
    """What /alq-review:alq-spec takes, how it starts the driver, and what it ends with."""
    FORMS = ("#<issue> [<dir>]", "rescope <spec folder> #<issue>")
    ORIGIN = 'repo=$(git remote get-url origin) && gh issue view <ISSUE> --repo "$repo" '

    def test_takes_its_two_forms_and_refuses_anything_else_naming_them(self):
        text = ALQ_SPEC.read_text()
        for form in self.FORMS:
            with self.subTest(form=form):
                self.assertIn(f"- **`{form}`**", text)
        hint = re.search(r'^argument-hint: "(.*)"$', text, re.M).group(1)
        self.assertEqual(hint, " | ".join(self.FORMS))
        said = [s for s in re.split(r"(?<=\.)\s+", squashed(ALQ_SPEC)) if s.startswith("Anything else")]
        self.assertTrue([s for s in said if "the two forms" in s and "stop" in s], said)

    def test_starts_the_driver_with_the_spec_file_and_the_issue_then_the_folder_on_a_rescope(self):
        self.assertIn("`python3 DRIVE start <SPEC_FILE> <ISSUE>`, plus `<SPEC_DIR>` on a rescope.", squashed(ALQ_SPEC))

    def test_a_completed_run_ends_with_the_spec_folder_and_branch_lines(self):
        text = squashed(ALQ_SPEC)
        self.assertIn("End with two lines and nothing after them: `Spec folder: <path>`", text)
        self.assertIn("`Branch: <branch>`", text)

    def test_a_rescope_runs_in_the_issues_existing_worktree_and_never_creates_one(self):
        """A fresh branch would take the re-scoped spec away from the PR it was held for."""
        rescope = re.search(r"^- \*\*`rescope .*?(?=^- \*\*|^$)", ALQ_SPEC.read_text(), re.M | re.S).group(0)
        rescope = re.sub(r"\s+", " ", rescope)
        self.assertIn("never creates one", rescope)
        self.assertIn("the PR bound to that spec folder", rescope)
        self.assertIn("stop and ask the user", rescope)

    def test_a_rescope_writes_the_issue_as_first_stated_then_the_open_decision(self):
        """The folder may hold the wrong scope: the issue is read again from GitHub, not taken from the folder."""
        rescope = re.search(r"^- \*\*`rescope .*?(?=^- \*\*|^$)", ALQ_SPEC.read_text(), re.M | re.S).group(0)
        rescope = re.sub(r"\s+", " ", rescope)
        self.assertIn("the issue is re-read as first stated: write it to `SPEC_FILE` with the same `gh issue view` "
                      "command, then append", rescope)
        self.assertLess(rescope.index("`gh issue view`"), rescope.index("`Open decision: …`"))

    def test_no_spec_needed_tells_the_user_to_pass_a_null_spec_at_review(self):
        """The one value review will take for this PR; nothing else tells the user."""
        said = [s for s in re.split(r"(?<=\.)\s+", squashed(ALQ_SPEC)) if s.startswith("After `no spec needed`")]
        self.assertTrue([s for s in said if "tell the user to pass `spec: null` when the work is reviewed" in s], said)

    def test_every_issue_view_names_the_repo_by_origins_url(self):
        """The same repo the workflow closes a not-worth-doing issue in. origin is read before gh runs: a failed read
        inside gh's arguments leaves `--repo ""`, and gh picks a repo from the other remotes."""
        calls = re.findall(r"`([^`]*gh issue view [^`]*)`", ALQ_SPEC.read_text())
        self.assertTrue(calls)
        for call in calls:
            with self.subTest(call=call):
                self.assertTrue(call.startswith(self.ORIGIN), call)


class RootCauseCheck(unittest.TestCase):
    """The check is handed the spec folder and reads its spec.md; it looks nothing up (R14)."""

    @staticmethod
    def sentences() -> list[str]:
        # A period inside a path (`spec.md`) is not followed by whitespace, so it does not split.
        return re.split(r"(?<=\.)\s+", squashed(ROOT_CAUSE))

    def test_takes_the_spec_folder_as_its_argument_and_reads_its_root_cause_section(self):
        self.assertTrue([s for s in self.sentences() if "argument" in s and "spec folder" in s],
                        "no sentence says the argument is the spec folder")
        text = ROOT_CAUSE.read_text()
        for read in ("`<folder>/spec.md`", "`## Root cause`"):
            with self.subTest(read=read):
                self.assertIn(read, text)

    def test_measures_the_delta_from_origins_main_as_it_is_now(self):
        """A local main behind origin's would put commits merged since into the delta, graded as this fix."""
        self.assertIn("`git fetch -q origin main && git diff origin/main...HEAD`", ROOT_CAUSE.read_text())

    def test_looks_up_no_location(self):
        text = ROOT_CAUSE.read_text()
        for lookup in ("speclocation", "SPECLOC", "location comment"):
            with self.subTest(lookup=lookup):
                self.assertNotIn(lookup, text)

    def test_a_missing_root_cause_section_gives_cannot_tell_for_that_reason_alone(self):
        said = [s for s in self.sentences() if "CANNOT TELL" in s and "no `## Root cause` section" in s]
        self.assertTrue(said, "no sentence gives CANNOT TELL for a missing `## Root cause` section")
        for sentence in said:
            for lookup in ("`show`", "spec: none", "location comment"):
                with self.subTest(lookup=lookup):
                    self.assertNotIn(lookup, sentence)


if __name__ == "__main__":
    unittest.main()
