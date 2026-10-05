"""The claim check's agents read and search; none runs commands or writes files (spec 005 FR-012). Prose that
tells an agent to do what the gate now does for it is checked here too."""
import re
import unittest
from pathlib import Path

AGENTS = Path(__file__).resolve().parent.parent / "agents"
TACKLE = Path(__file__).resolve().parents[1] / "skills" / "alq-issue-tackle" / "SKILL.md"


def tools(name: str) -> list[str]:
    front = (AGENTS / f"{name}.md").read_text().split("---")[1]
    return re.search(r"^tools: (.*)$", front, re.M).group(1).split(", ")


class ClaimAgents(unittest.TestCase):
    def test_each_agent_has_only_the_tools_its_work_needs(self):
        self.assertEqual(tools("claim-reader"), ["Read"])
        self.assertEqual(tools("claim-judge"), ["Read", "Glob", "Grep"])
        self.assertEqual(tools("claim-contest-judge"), ["Read", "Glob", "Grep", "WebFetch"])


class ShimAgents(unittest.TestCase):
    def test_sweepers_and_judges_read_and_search_only(self):
        self.assertEqual(tools("shim-sweeper"), ["Read", "Glob", "Grep"])
        self.assertEqual(tools("shim-site-judge"), ["Read", "Glob", "Grep"])


class IssueTackle(unittest.TestCase):
    def test_step_4_leaves_handing_reviewers_the_spec_to_the_gate(self):
        """The gate replaces a review round's args (engineering#62), so an agent told to pass the spec has no way to."""
        step4 = TACKLE.read_text().split("## Step 4")[1].split("## Step 5")[0]
        self.assertIn("gate", step4)


if __name__ == "__main__":
    unittest.main()
