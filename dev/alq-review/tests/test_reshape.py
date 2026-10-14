import unittest

from helpers import assess, state_with_round

import reshape

FOLDER = "specs/123-login"
SPEC_GAPS = (("spec_gap", "the canonical root is chosen round by round", "FR-3"),
             ("spec_gap", "the fallback root is unnamed", "spec silent"),
             ("defect", "an unchecked None", "n/a"))


def ruled_round(gaps=SPEC_GAPS):
    """A round ruled RESHAPE_SPEC on PR 7 whose findings carry `gaps` as (kind, mechanism, spec_ref)."""
    state = state_with_round(findings_per_reviewer=(len(gaps), 0))
    ruling = assess(state, "RESHAPE_SPEC")
    ruling["rationale"] = "two rounds chose different roots"
    for finding, (kind, mechanism, spec_ref) in zip(ruling["findings"], gaps):
        finding.update(kind=kind, mechanism=mechanism, spec_ref=spec_ref)
    return state["rounds"][-1]


class Summary(unittest.TestCase):
    def test_it_names_the_open_decision_the_rationale_each_spec_gap_and_the_folder(self):
        self.assertEqual(reshape.summary(FOLDER, ruled_round()["assessment"]),
                         "Open decision: which root is canonical? Why: two rounds chose different roots Spec gaps: "
                         "the canonical root is chosen round by round (FR-3); the fallback root is unnamed (spec "
                         "silent). Spec folder: specs/123-login.")

    def test_a_ruling_without_spec_gaps_says_none_were_named(self):
        self.assertIn("Spec gaps: none named.", reshape.summary(FOLDER, ruled_round(SPEC_GAPS[2:])["assessment"]))


class IssueOf(unittest.TestCase):
    def test_the_issue_is_the_number_the_folders_own_name_starts_with(self):
        cases = {"specs/123-x": 123, "dev/a/specs/111-x": 111, "specs/020-decision-review": None, "specs/x": None,
                 "specs/0-x": None, "specs/123": None, "specs/12a-x": None}
        for folder, issue in cases.items():
            with self.subTest(folder=folder):
                self.assertEqual(reshape.issue_of(folder), issue)


class Notice(unittest.TestCase):
    def test_a_folder_naming_an_issue_owes_both_calls_on_it(self):
        self.assertEqual(reshape.notice(FOLDER), {"issue": 123, "comment": None, "edit": None})

    def test_a_folder_naming_no_issue_is_failed_from_the_start(self):
        unposted = {"error": "spec folder specs/020-decision-review names no issue"}
        self.assertEqual(reshape.notice("specs/020-decision-review"),
                         {"issue": None, "comment": unposted, "edit": unposted})


class Comment(unittest.TestCase):
    def test_it_says_which_pr_and_round_ruled_and_carries_the_summary(self):
        rnd = ruled_round()
        rnd.update(stage="internal", n=3)
        self.assertEqual(reshape.comment(FOLDER, 118, rnd),
                         "alq-review ruled #118, internal round 3 RESHAPE_SPEC: the spec has to be reshaped before this "
                         "PR's code may change.\n\n" + reshape.summary(FOLDER, rnd["assessment"]))

    def test_it_carries_nothing_local(self):
        rnd = ruled_round()
        rnd.update(root="/home/someone/checkout", session="s1")
        body = reshape.comment(FOLDER, 7, rnd)
        for local in ("/home/someone/checkout", rnd["ref"], "s1"):
            with self.subTest(local=local):
                self.assertNotIn(local, body)


class NoticeFailures(unittest.TestCase):
    def with_notice(self, comment, edit, issue=123):
        rnd = ruled_round()
        rnd["notice"] = {"issue": issue, "comment": comment, "edit": edit}
        return rnd

    def test_nothing_is_said_without_a_notice_or_when_both_calls_were_done(self):
        self.assertEqual(reshape.notice_failures("acme/demo", ruled_round()), "")
        self.assertEqual(reshape.notice_failures("acme/demo", self.with_notice({"done": True}, {"done": True})), "")

    def test_each_failed_call_is_named_with_githubs_error(self):
        said = reshape.notice_failures("acme/demo", self.with_notice({"error": "gh issue failed: HTTP 502"},
                                                                     {"error": "'reshape_spec' not found"}))
        self.assertEqual(said, "The RESHAPE_SPEC notice on acme/demo#123 failed: the comment was not posted (gh issue "
                               "failed: HTTP 502). Post it by hand. The RESHAPE_SPEC notice on acme/demo#123 failed: the "
                               "reshape_spec label and assignee were not added ('reshape_spec' not found). Add them by "
                               "hand.")

    def test_only_the_failed_call_is_named(self):
        said = reshape.notice_failures("acme/demo", self.with_notice({"done": True}, {"error": "no such user"}))
        self.assertNotIn("comment", said)
        self.assertIn("label and assignee were not added (no such user)", said)

    def test_an_answer_never_recorded_is_not_read_as_done(self):
        said = reshape.notice_failures("acme/demo", self.with_notice(None, None))
        self.assertEqual(said, "The RESHAPE_SPEC notice on acme/demo#123: GitHub's answer to the comment was not "
                               "recorded. Check the issue and post it by hand if it is missing. The RESHAPE_SPEC notice on "
                               "acme/demo#123: GitHub's answer to the reshape_spec label and assignee was not recorded. "
                               "Check the issue and add them by hand if they are missing.")

    def test_a_folder_naming_no_issue_is_said_once(self):
        unposted = {"error": "spec folder specs/020-decision-review names no issue"}
        said = reshape.notice_failures("acme/demo", self.with_notice(unposted, unposted, issue=None))
        self.assertEqual(said, "The RESHAPE_SPEC notice was not posted: spec folder specs/020-decision-review names no "
                               "issue. Tell the spec's issue by hand.")


if __name__ == "__main__":
    unittest.main()
