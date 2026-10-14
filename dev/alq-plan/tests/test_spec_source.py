"""What the issue-spec skill and the planning workflow say about where the spec is and how they read values."""
import re
import unittest
from pathlib import Path

from paths import PLUGIN

import premise_report
import yaml  # Spec Kit's own dependency
from test_drive_workflow import workflow_steps

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
    FORMS = ("#<issue> [<dir>]", "rescope <spec folder> #<issue>", 'untracked "<what changes>" [<dir>]')
    ORIGIN = 'repo=$(git remote get-url origin) && gh issue view <ISSUE> --repo "$repo" '

    def test_takes_its_three_forms_and_refuses_anything_else_naming_them(self):
        text = ISSUE_SPEC.read_text()
        for form in self.FORMS:
            with self.subTest(form=form):
                self.assertIn(f"- **`{form}`**", text)
        front = yaml.safe_load(text.split("---\n")[1])
        self.assertEqual(front["argument-hint"], " | ".join(self.FORMS))
        said = [s for s in re.split(r"(?<=\.)\s+", squashed(ISSUE_SPEC)) if s.startswith("Anything else")]
        self.assertTrue([s for s in said if "the three forms" in s and "stop" in s], said)

    def untracked(self):
        form = re.search(r"^- \*\*`untracked .*?(?=^- \*\*|^$)", ISSUE_SPEC.read_text(), re.M | re.S).group(0)
        return re.sub(r"\s+", " ", form)

    def test_untracked_refuses_an_empty_change_before_any_issue_is_created(self):
        self.assertIn("If `<what changes>` is empty or only spaces, tell the user so and stop: no issue is created.",
                      self.untracked())

    def test_untracked_creates_the_issue_from_a_file_only_once_the_user_confirms_its_title_body_and_type(self):
        """The skill writes to GitHub for the user."""
        form = self.untracked()
        steps = ["`python3 NEW_ISSUE types`", "Ask the user to confirm the title, body and type",
                 "`# <title>`, a blank line and the body to `ISSUE_FILE`",
                 "`python3 NEW_ISSUE create <TYPE> <ISSUE_FILE>`"]
        positions = [form.find(step) for step in steps]
        self.assertNotIn(-1, positions, list(zip(steps, positions)))
        self.assertEqual(positions, sorted(positions))
        self.assertIn("create nothing until they do", form)

    def test_untracked_starts_no_run_when_the_create_fails_and_names_the_issue_in_every_later_stop(self):
        form = self.untracked()
        self.assertIn("If it exits non-zero, show its message and stop: no run is started.", form)
        self.assertIn("go on as `#<issue> [<dir>]` with `ISSUE` the new issue", form)
        self.assertIn("every stop from here on names the issue created, by its `url`", form)

    def test_starts_the_driver_with_the_kind_of_run_the_spec_file_the_issue_and_the_folder(self):
        """Every run takes its folder; the subcommand, not whether a folder was given, says which kind it is."""
        self.assertIn("`python3 DRIVE start <SPEC_FILE> <ISSUE> <SPEC_DIR>` on a new scope, "
                      "`python3 DRIVE rescope <SPEC_FILE> <ISSUE> <SPEC_DIR>` on a rescope.", squashed(ISSUE_SPEC))

    def new_scope(self):
        found = re.search(r"^- \*\*`#<issue>.*?(?=^- \*\*|^$)", ISSUE_SPEC.read_text(), re.M | re.S).group(0)
        return re.sub(r"\s+", " ", found)

    def test_a_new_scope_picks_its_folder_once_from_one_to_four_words_of_the_issue_title(self):
        new_scope = self.new_scope()
        self.assertIn("`SPEC_DIR` is `specs/<ISSUE>-<short name>`, picked once, here", new_scope)
        self.assertIn("`<short name>` is 1 to 4 words of the issue title, lowercased, each a run of `[a-z0-9]`, "
                      "joined by single hyphens", new_scope)
        self.assertLess(new_scope.index("gh issue view"), new_scope.index("`<short name>` is 1 to 4 words"))

    def test_a_title_with_no_word_stops_before_anything_is_written_saying_to_retitle_the_issue(self):
        self.assertIn("A title with no such word: stop before writing anything, and tell the user to retitle the "
                      "issue.", self.new_scope())

    def form(self, start):
        found = re.search(rf"^- \*\*`{start}.*?(?=^- \*\*|^$)", ISSUE_SPEC.read_text(), re.M | re.S).group(0)
        return re.sub(r"\s+", " ", found)

    def test_a_new_scope_creates_its_spec_branch_and_worktree_before_anything_else_and_runs_there(self):
        new = self.form("#<issue>")
        self.assertIn("Then, with nothing written yet, run `python3 BRANCH create <ISSUE>`", new)
        self.assertIn("`CHECKOUT` is its `worktree`", new)
        # A title with no word stops before anything is written, so before the spec branch is made.
        self.assertLess(new.index("retitle the issue"), new.index("BRANCH create"))
        self.assertIn("show the user its message and stop", new)

    def test_a_completed_run_is_checked_then_committed_and_pushed_by_the_session_then_a_new_scope_opens_its_pr(self):
        """The session runs git commit and git push itself, so the commit gate sees the commit."""
        text = squashed(ISSUE_SPEC)
        steps = ["`python3 BRANCH check <run_id>`", "`git add -- <SPEC_DIR>`", '`git commit -m "<message>"`',
                 "`git push --set-upstream origin HEAD`", "`python3 BRANCH open-pr <run_id>`"]
        positions = [text.find(step) for step in steps]
        self.assertNotIn(-1, positions, list(zip(steps, positions)))
        self.assertEqual(positions, sorted(positions))
        self.assertIn("Launch no review.", text)
        self.assertIn("End with four lines and nothing after them: `Spec folder: <folder>`, `Branch: <branch>`, "
                      "`PR: <pr>` and `Review: spec: null`", text)
        self.assertIn("On a rescope, end with two lines and nothing after them: `Spec folder: <folder>` and "
                      "`Branch: <branch>`", text)

    def test_a_rescope_works_in_the_worktree_it_is_run_from_and_creates_nothing(self):
        """The spec edit lands in the PR the rescope is run from, a story's or the spec's."""
        self.assertIn("`CHECKOUT` is the worktree this session runs in", self.form("rescope"))
        self.assertIn("A rescope creates no branch, worktree or PR.", self.form("rescope"))

    def test_a_new_scope_that_does_not_land_discards_its_spec_branch(self):
        """A spec branch left behind would refuse the next new scope of the issue and tell it to rescope."""
        discard = "`python3 BRANCH discard <ISSUE>`"
        rule = re.search(r"^\*\*A new scope that does not land\.\*\*.*?(?=^$)", ISSUE_SPEC.read_text(), re.M | re.S)
        self.assertIsNotNone(rule)
        rule = re.sub(r"\s+", " ", rule.group(0))
        for said in (discard, "after `not worth doing`", "a rejected run", "a failed run"):
            with self.subTest(said=said):
                self.assertIn(said, rule)
        self.assertNotIn("either stop pick", rule)
        said = [s for s in re.split(r"(?<=\.)\s+", squashed(ISSUE_SPEC)) if s.startswith("After `not worth doing`")]
        self.assertTrue([s for s in said if f"on a new scope, run {discard}" in s], said)
        self.assertIn("A new scope that does not land", ISSUE_SPEC.read_text().partition("## Stops")[2])

    def test_the_discard_rule_and_the_stops_give_one_order_ask_about_resuming_then_discard(self):
        """A failed run may be resumed, and a discarded one cannot be: the user is asked first, in both places."""
        order = "first ask the user whether they will resume the run; only when they say no, discard"
        rule = re.search(r"^\*\*A new scope that does not land\.\*\*.*?(?=^$)", ISSUE_SPEC.read_text(), re.M | re.S)
        stops = ISSUE_SPEC.read_text().partition("## Stops")[2].partition("The exceptions")[0]
        for where, text in (("discard rule", rule.group(0)), ("Stops", stops)):
            with self.subTest(where=where):
                self.assertIn(order, re.sub(r"\s+", " ", text))

    def test_every_story_heading_check_is_a_stop_the_skill_names(self):
        stops = ISSUE_SPEC.read_text().partition("## Stops")[2]
        checks = [s["id"] for s in workflow_steps() if "story_headings.py" in s.get("run", "")]
        self.assertEqual(len(checks), 5, checks)
        for step in checks:
            with self.subTest(step=step):
                self.assertRegex(stops, rf"`(step: )?{step}`")

    def test_a_rescope_writes_the_issue_as_first_stated_then_the_open_decision(self):
        """The folder may hold the wrong scope: the issue is read again from GitHub, not taken from the folder."""
        rescope = re.search(r"^- \*\*`rescope .*?(?=^- \*\*|^$)", ISSUE_SPEC.read_text(), re.M | re.S).group(0)
        rescope = re.sub(r"\s+", " ", rescope)
        self.assertIn("the issue is re-read as first stated: write it to `SPEC_FILE` with the same `gh issue view` "
                      "command, then append", rescope)
        self.assertLess(rescope.index("`gh issue view`"), rescope.index("`Open decision: …`"))

    def test_no_spec_needed_lands_the_folder_it_wrote_as_a_written_spec_lands(self):
        """A new scope's no-spec folder lands through its own PR, a rescope's on its branch: discarded, it would leave
        the issue with no folder to say no spec is needed."""
        text = squashed(ISSUE_SPEC)
        said = [s for s in re.split(r"(?<=\.)\s+", text) if s.startswith("After `no spec needed`")]
        self.assertTrue([s for s in said if "the workflow has written `SPEC_DIR` with a spec.md that says no spec is "
                         "needed" in s and "land it as step 8 says" in s and "discard" not in s], said)

    def test_a_no_spec_rescope_tells_the_user_to_pass_a_null_spec_at_review(self):
        """The one value review will take for this PR; a rescope's end lines do not carry it, a new scope's do."""
        said = [s for s in re.split(r"(?<=\.)\s+", squashed(ISSUE_SPEC))
                if s.startswith("On a rescope that ended on `no spec needed`")]
        self.assertTrue([s for s in said if "tell the user to pass `spec: null` when the work is reviewed" in s], said)

    def test_a_rescope_of_a_no_spec_folder_is_expected_to_pause_at_the_premise(self):
        self.assertIn("on a rescope of a spec, `paused` at `grill`, and the next step is 4; on a rescope of a folder "
                      "whose spec.md says no spec is needed, `paused` at `premise`.", squashed(ISSUE_SPEC))

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

    def test_a_no_spec_folder_that_cannot_be_written_is_a_stop_that_resumes(self):
        stops = re.sub(r"\s+", " ", ISSUE_SPEC.read_text().split("## Stops", 1)[1])
        self.assertIn("- `step: write-no-spec`, with a `stderr` line that names a Next step: show the user the "
                      "message. When it names a path to clear or make writable, the user does that, not you; resume "
                      "only once they say it is done. When it names `premise_report.py check`, complete the report as "
                      "it says.", stops)

    def test_says_a_failed_run_leaves_nothing_behind(self):
        text = squashed(ISSUE_SPEC)
        self.assertIn("A run that is rejected or fails commits nothing, pushes nothing and opens nothing.", text)

    def test_holds_none_of_the_old_home_phrases(self):
        text = squashed(ISSUE_SPEC).lower()
        for phrase in OLD_HOME_PHRASES:
            with self.subTest(phrase=phrase):
                self.assertNotIn(phrase, text)


if __name__ == "__main__":
    unittest.main()
