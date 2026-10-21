"""What the issue-tackle skill tells the agent to do."""
import re
import unittest

from paths import PLUGIN

TACKLE = PLUGIN / "skills" / "issue-tackle" / "SKILL.md"
ROOT_CAUSE = PLUGIN / "skills" / "root-cause-check" / "SKILL.md"


def sentences(path) -> list[str]:
    # A period inside a path or a call (`spec.md`, `.claude/`) is not followed by whitespace, so it does not split.
    return re.split(r"(?<=\.)\s+", re.sub(r"\s+", " ", path.read_text()))


class IssueTackle(unittest.TestCase):
    """What the skill text tells the agent to do, per contracts/interfaces.md `/builder:issue-tackle` (R14)."""

    def assertSaid(self, *needles: str):
        said = [s for s in sentences(TACKLE) if all(n.lower() in s.lower() for n in needles)]
        self.assertTrue(said, f"no sentence of the skill holds all of {needles}")

    def test_takes_the_issue_the_spec_and_the_branch(self):
        self.assertIn("`<n> spec=<folder|null> [branch=<branch>]`", TACKLE.read_text())

    def test_stops_when_a_folder_comes_without_its_branch(self):
        self.assertSaid("without `branch`", "stop")

    def test_works_in_the_issue_worktree_on_the_given_branch(self):
        self.assertSaid("`.claude/worktrees/<n>`", "`branch`")

    def test_stops_before_code_when_spec_md_is_missing_or_empty_at_the_branch_head(self):
        self.assertSaid("`git show HEAD:<folder>/spec.md`", "missing or empty", "stop", "before writing")

    def test_launches_the_internal_round_with_the_spec_it_was_given(self):
        self.assertIn("Workflow(name='reviewer:review-round', args={worktree: '<absolute worktree path>', "
                      "stage: 'internal', spec: ", TACKLE.read_text())
        self.assertSaid("review-round", "same `spec`")

    def test_stops_before_the_pr_when_the_review_round_is_not_installed(self):
        self.assertSaid("the review step needs reviewer", "stop")
        step = re.sub(r"\s+", " ", self.step(4))
        self.assertLess(step.index("the review step needs reviewer"), step.index("open the PR as a draft"))

    def test_names_each_root_cause_verdict_on_its_own_line_with_its_action(self):
        verdicts = {"AT CAUSE": ("Step 6",), "AT SYMPTOM": ("back to",), "SPEC WRONG": ("stop", "trace got wrong"),
                    "CANNOT TELL": ("stop", "which case", "resolve", "draft")}
        lines = TACKLE.read_text().splitlines()
        for verdict, action in verdicts.items():
            # A line naming two verdicts gives the reader no way to tell which action is whose.
            own = [line for line in lines if verdict in line and sum(v in line for v in verdicts) == 1]
            with self.subTest(verdict=verdict):
                self.assertTrue([line for line in own if all(a.lower() in line.lower() for a in action)],
                                f"no line names {verdict} alone with {action}")

    def test_runs_no_root_cause_check_with_a_null_spec(self):
        said = [s for s in sentences(TACKLE) if "`spec=null`" in s and "root-cause" in s]
        self.assertTrue([s for s in said if "does not run" in s], said)

    @staticmethod
    def step(n: int) -> str:
        """The text of the skill's Step `n`, up to the next heading."""
        return re.search(rf"^## Step {n}\b.*?(?=^## )", TACKLE.read_text(), re.M | re.S).group(0)

    def test_a_root_cause_section_that_is_no_defect_report_goes_on_to_mark_the_pr_ready(self):
        """root-cause-check stops with no verdict on such a spec; none of the four verdicts' actions applies."""
        said = [s for s in re.split(r"(?<=\.)\s+", re.sub(r"\s+", " ", self.step(5)))
                if "`Not a defect report.`" in s and "Step 6" in s]
        self.assertTrue(said, "Step 5 has no sentence that names `Not a defect report.` and goes on to Step 6")
        self.assertIn("Mark the PR ready", self.step(6))

    def test_names_no_planning_command_and_reads_no_issue_comment_for_the_spec(self):
        """The spec reaches the build as its argument: a skill that plans or looks the spec up has a second source."""
        for skill in (TACKLE, ROOT_CAUSE):
            text = skill.read_text()
            for named in ("issue-spec", "issue-spec", "speclocation", "SPECLOC", "location comment", "--comments",
                          "/comments"):
                with self.subTest(skill=skill.parent.name, named=named):
                    self.assertNotIn(named, text)



if __name__ == "__main__":
    unittest.main()
