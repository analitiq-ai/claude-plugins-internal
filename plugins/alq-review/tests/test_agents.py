"""The claim check's agents read and search; none runs commands or writes files (spec 005 FR-012)."""
import re
import unittest
from pathlib import Path

AGENTS = Path(__file__).resolve().parent.parent / "agents"


def tools(name: str) -> list[str]:
    front = (AGENTS / f"{name}.md").read_text().split("---")[1]
    return re.search(r"^tools: (.*)$", front, re.M).group(1).split(", ")


class ClaimAgents(unittest.TestCase):
    def test_each_agent_has_only_the_tools_its_work_needs(self):
        self.assertEqual(tools("claim-reader"), ["Read"])
        self.assertEqual(tools("claim-judge"), ["Read", "Glob", "Grep"])
        self.assertEqual(tools("claim-contest-judge"), ["Read", "Glob", "Grep", "WebFetch"])


if __name__ == "__main__":
    unittest.main()
