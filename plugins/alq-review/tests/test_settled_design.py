"""The settled-design check (spec 004 FR-017/018): plan.md's mechanisms each cite a decision in research.md
that says what was chosen, why, and which existing tools were looked at."""
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import helpers  # noqa: F401  (puts scripts/ on the path)
import settled_design

SCRIPT = Path(__file__).resolve().parent.parent / "scripts" / "settled_design.py"

PLAN = """# Plan

## Mechanisms

- Commit gate: R1
- Round gate: R2
"""

RESEARCH = """# Research

## R1: Commit gate

- **Decision**: a PreToolUse hook on git commit.
- **Rationale**: it sees every commit a session makes.
- **Existing tools**: pre-commit and lefthook; neither runs inside a Claude session.

## R2: Round gate

- **Decision**: refuse the first round launch.
- **Rationale**: a half-written plan may still be open at commit time.
- **Existing tools**: None fit. Looked at: the speckit extension catalog and PyPI.
"""


class Check(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.folder = Path(tmp.name) / "specs" / "004-demo"
        self.folder.mkdir(parents=True)

    def write(self, plan=PLAN, research=RESEARCH):
        if plan is not None:
            (self.folder / "plan.md").write_text(plan)
        if research is not None:
            (self.folder / "research.md").write_text(research)
        return settled_design.problems(self.folder)

    def test_a_settled_folder_has_no_problems(self):
        self.assertEqual(self.write(), [])

    def test_existing_tools_may_continue_on_indented_lines(self):
        research = RESEARCH.replace("- **Existing tools**: pre-commit and lefthook; neither runs inside a Claude session.",
                                    "- **Existing tools**:\n  - pre-commit: runs outside the session.\n  - lefthook: same.")
        self.assertEqual(self.write(research=research), [])

    def test_a_cited_decision_missing_from_research_names_the_mechanism(self):
        [problem] = self.write(plan=PLAN.replace("R2", "R4"))
        self.assertIn("plan.md:6", problem)
        self.assertIn("Round gate", problem)
        self.assertIn("R4", problem)
        self.assertIn("Next step:", problem)

    def test_a_decision_naming_no_existing_tool_is_named(self):
        [problem] = self.write(research=RESEARCH.replace(
            "- **Existing tools**: pre-commit and lefthook; neither runs inside a Claude session.\n", ""))
        self.assertIn("research.md:3", problem)
        self.assertIn("R1", problem)
        self.assertIn("Existing tools", problem)

    def test_none_fit_must_say_where_it_looked(self):
        [problem] = self.write(research=RESEARCH.replace(
            "None fit. Looked at: the speckit extension catalog and PyPI.", "None fit."))
        self.assertIn("R2", problem)
        self.assertIn("Looked at:", problem)

    def test_an_empty_field_counts_as_missing(self):
        [problem] = self.write(research=RESEARCH.replace("- **Rationale**: it sees every commit a session makes.",
                                                         "- **Rationale**:"))
        self.assertIn("R1", problem)
        self.assertIn("Rationale", problem)

    def test_a_plan_without_a_mechanisms_section_says_what_the_list_must_hold(self):
        [problem] = self.write(plan="# Plan\n\nSome prose.\n")
        self.assertIn("plan.md", problem)
        self.assertIn("## Mechanisms", problem)
        self.assertIn("- <mechanism>: R<n>", problem)

    def test_an_empty_mechanisms_section_is_refused_like_a_missing_one(self):
        [problem] = self.write(plan="# Plan\n\n## Mechanisms\n\n## Next\n\n- Not a mechanism: R1\n")
        self.assertIn("## Mechanisms", problem)

    def test_a_malformed_mechanism_line_is_named(self):
        [problem] = self.write(plan=PLAN.replace("- Round gate: R2", "- Round gate, see research"))
        self.assertIn("plan.md:6", problem)
        self.assertIn("- <mechanism>: R<n>", problem)

    def test_a_folder_without_plan_md_is_refused(self):
        [problem] = self.write(plan=None)
        self.assertIn("plan.md", problem)
        self.assertIn("## Mechanisms", problem)

    def test_a_folder_without_research_md_names_every_citation(self):
        problems = self.write(research=None)
        self.assertEqual(len(problems), 2)
        self.assertIn("R1", problems[0])
        self.assertIn("R2", problems[1])


class Cli(unittest.TestCase):
    def run_on(self, folder):
        return subprocess.run([sys.executable, str(SCRIPT), str(folder)], capture_output=True, text=True)

    def test_exit_status_and_output_follow_the_problems(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            (folder / "plan.md").write_text(PLAN)
            (folder / "research.md").write_text(RESEARCH)
            self.assertEqual(self.run_on(folder).returncode, 0)
            (folder / "research.md").write_text(RESEARCH.replace("## R2: Round gate", "## R3: Round gate"))
            done = self.run_on(folder)
            self.assertEqual(done.returncode, 1)
            self.assertIn("R2", done.stderr)

    def test_an_empty_folder_argument_is_refused_not_read_as_the_current_directory(self):
        done = self.run_on("")
        self.assertEqual(done.returncode, 2)
        self.assertNotIn("plan.md", done.stderr)

    def test_a_missing_folder_is_an_error_not_a_pass(self):
        done = self.run_on("/nonexistent/specs/x")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("/nonexistent/specs/x", done.stderr)


if __name__ == "__main__":
    unittest.main()
