"""The claim check's agents read and search; none runs commands or writes files. Prose that
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
    def test_when_to_use_names_the_spec_argument_both_its_forms_and_the_header_line_it_agrees_with(self):
        when = re.search(r'^\s*whenToUse: "(.*)",$', REVIEW_ROUND.read_text(), re.M).group(1)
        for named in ("args.spec = '<folder>/spec.md § User Story <N>' | null", "Implements:"):
            with self.subTest(named=named):
                self.assertIn(named, when)


class Assessor(unittest.TestCase):
    def test_the_brief_names_the_story_number_and_the_section_of_spec_md_to_read_for_it(self):
        brief = (AGENTS / "assessor.md").read_text().split("## Rule on each finding")[0]
        for named in ("`user_story`", "`### User Story <user_story>`", "`<spec_folder>/spec.md`", "excludes"):
            with self.subTest(named=named):
                self.assertIn(named, brief)


if __name__ == "__main__":
    unittest.main()
