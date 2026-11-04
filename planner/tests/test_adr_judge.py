"""adr-judge.md copies reviewer's definition of a departure from a decision, so a plan and a change are judged alike."""
import re
import unittest

from paths import PLUGIN, REPO

JUDGE = PLUGIN / "speckit" / "workflows" / "issue-spec" / "adr-judge.md"
REVIEWER = REPO / "reviewer" / "plugin" / "agents" / "decision-reviewer.md"
DEFINITION = re.compile(r"A decision record settles a question:.*?however you would have done it\.")
# The one difference the copy keeps: the planner judges an artifact, reviewer a change.
SUBJECT = {"reviewer": "The change violates it", "planner": "The artifact departs from it"}


def definition(path):
    found = DEFINITION.search(" ".join(path.read_text().split()))
    if found is None:
        raise AssertionError(f"{path} defines no departure from a decision")
    return found[0]


class JudgeDefinition(unittest.TestCase):
    def test_the_judge_defines_a_departure_as_the_decision_reviewer_does(self):
        copy = definition(JUDGE)
        self.assertIn(SUBJECT["planner"], copy)
        self.assertEqual(copy.replace(SUBJECT["planner"], SUBJECT["reviewer"]), definition(REVIEWER))


if __name__ == "__main__":
    unittest.main()
