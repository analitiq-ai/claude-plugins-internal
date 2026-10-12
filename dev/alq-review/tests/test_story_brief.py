"""What a story PR's reviewers and assessor are told of the story it is bound to (spec 81, scenarios 10 and 11, SC-002)."""
import re
import unittest

from helpers import T0

from test_worktree_facts import Repo, git

import briefs
import ledger
import policy
import worktree

FOLDER = "dev/x/specs/7-demo"
STORY = f"{FOLDER}/spec.md § User Story 2"


class StoryBrief(Repo):
    def setUp(self):
        super().setUp()
        self.head = self.commit("b.py", "b\n", "feat: b")

    def bound(self, **binding):
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        state.update(binding)
        return state

    def round_of(self, state, stage="internal"):
        waves = briefs.AUDIT_WAVES if stage == "audit" else [briefs.INTERNAL_REVIEWERS]
        rnd = ledger.open_round(state, stage, head_sha=self.head, base_sha=git(self.root, "rev-parse", "main"),
                                scope="full", expected=[t for wave in waves for t in wave], escalation=False, now=T0)
        rnd["root"] = str(self.root)
        return rnd

    def prompts(self, state, stage="internal"):
        args = briefs.review_args(state, self.round_of(state, stage), worktree.locate(str(self.root)),
                                  policy.Decision(True, scope="full"), briefs.bound_spec(state))
        return [r["prompt"] for wave in args["waves"] for r in wave]

    def test_each_internal_reviewer_is_told_the_story_its_heading_and_to_raise_nothing_of_another_story(self):
        graded = (f"\n\nThis change implements User Story 2 of the spec in {FOLDER}/spec.md of {self.root}. Read the "
                  "section under the heading `### User Story 2`, and what the spec excludes. Every acceptance scenario "
                  "of that story the change does not meet is a finding: quote the scenario in its title. What the spec "
                  "excludes bounds what you may ask for. The requirements of other stories are not this PR's: raise "
                  "none.")
        prompts = self.prompts(self.bound(spec=STORY, spec_blob="d" * 40))
        self.assertEqual(len(prompts), len(briefs.INTERNAL_REVIEWERS))
        for prompt in prompts:
            with self.subTest(prompt=prompt[:40]):
                self.assertIn(graded, prompt)
                self.assertEqual(re.findall(r"User Story (\d+)", prompt), ["2", "2"])

    def test_the_assessor_brief_carries_the_bound_folder_and_story_number(self):
        state = self.bound(spec=STORY, spec_blob="d" * 40)
        brief = briefs.brief(state, self.round_of(state))
        self.assertEqual((brief["spec_folder"], brief["user_story"]), (FOLDER, 2))

    def test_the_assessor_brief_of_a_pr_bound_to_null_or_to_nothing_carries_neither(self):
        for binding in ({"spec": None, "spec_blob": None}, {}):
            with self.subTest(binding=binding):
                state = self.bound(**binding)
                brief = briefs.brief(state, self.round_of(state))
                self.assertEqual((brief["spec_folder"], brief["user_story"]), (None, None))


if __name__ == "__main__":
    unittest.main()
