"""The claim check's agents read and search; none runs commands or writes files (spec 005 FR-012). Prose that
tells an agent to do what the gate now does for it is checked here too."""
import re
import unittest

from paths import PLUGIN

AGENTS = PLUGIN / "agents"
REVIEW_ROUND = PLUGIN / "workflows" / "review-round.js"


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


class ReviewRoundWorkflow(unittest.TestCase):
    def test_when_to_use_names_the_spec_argument_and_both_its_forms(self):
        when = re.search(r'^\s*whenToUse: "(.*)",$', REVIEW_ROUND.read_text(), re.M).group(1)
        for named in ("args.spec", "'<spec folder>'", "null"):
            with self.subTest(named=named):
                self.assertIn(named, when)


if __name__ == "__main__":
    unittest.main()
