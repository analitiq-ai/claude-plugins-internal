import unittest

from helpers import state_with_round

import assessment
import ledger
import policy


def entry(fid, verdict="FIX", kind="defect", **extra):
    return {"id": fid, "verdict": verdict, "kind": kind, "spec_ref": "D1", "mechanism": "m", "reason": "r", **extra}


class ValidateAssessment(unittest.TestCase):
    def setUp(self):
        self.state = state_with_round(findings_per_reviewer=(2, 1))
        self.rnd = ledger.current_round(self.state)
        self.ids = [f["id"] for f in self.rnd["findings"]]

    def check(self, burden=False, **overrides):
        body = {"round_ref": self.rnd["ref"], "brief_token": "tok", "round_verdict": "PATCH",
                "findings": [entry(i) for i in self.ids], "rationale": "x", "next_step": "y"}
        body.update(overrides)
        return assessment.validate_assessment(body, self.rnd, policy.admissible_verdicts(self.rnd), burden=burden, token="tok")

    def test_complete_consistent_patch_is_valid(self):
        self.assertEqual(self.check(), [])

    def test_assessment_made_without_reading_the_brief_is_rejected(self):
        self.assertTrue(self.check(brief_token="guessed"))

    def test_every_finding_needs_exactly_one_entry(self):
        self.assertTrue(self.check(findings=[entry(i) for i in self.ids[:-1]]))
        self.assertTrue(self.check(findings=[entry(self.ids[0])] * 3))

    def test_inadmissible_verdict_is_rejected(self):
        state = state_with_round(stage="audit", escalation=True)
        rnd = ledger.current_round(state)
        body = {"round_ref": rnd["ref"], "brief_token": "tok", "round_verdict": "PATCH",
                "findings": [entry(rnd["findings"][0]["id"])], "rationale": "x", "next_step": "y"}
        errors = assessment.validate_assessment(body, rnd, policy.admissible_verdicts(rnd), burden=False, token="tok")
        self.assertTrue(any("PATCH" in e for e in errors))

    def test_class_fix_must_state_invariant_sites_and_how_they_were_enumerated(self):
        self.assertTrue(self.check(round_verdict="CLASS_FIX"))
        self.assertEqual(self.check(round_verdict="CLASS_FIX", invariant="every reader validates", sites=["a.py:1", "b.py:2"],
                                    enumeration_command="rg -n 'read_cfg\\('"), [])

    def test_redesign_must_name_the_structure_it_replaces(self):
        self.assertTrue(self.check(round_verdict="REDESIGN"))
        self.assertEqual(self.check(round_verdict="REDESIGN", invariant="one parser owns the grammar"), [])

    def test_patch_contradicts_findings_labelled_as_one_class(self):
        findings = [entry(self.ids[0], kind="class_sibling"), entry(self.ids[1]), entry(self.ids[2])]
        self.assertTrue(self.check(findings=findings))

    def test_converged_pushback_means_nothing_is_to_be_fixed(self):
        self.assertTrue(self.check(round_verdict="CONVERGED_PUSHBACK"))
        pushed = [entry(i, verdict="PUSH_BACK", kind="bikeshed") for i in self.ids]
        self.assertEqual(self.check(round_verdict="CONVERGED_PUSHBACK", findings=pushed), [])

    def test_fixing_verdicts_need_something_to_fix(self):
        pushed = [entry(i, verdict="PUSH_BACK", kind="bikeshed") for i in self.ids]
        self.assertTrue(self.check(findings=pushed))

    def test_bikeshedding_cannot_be_marked_fix(self):
        findings = [entry(self.ids[0], kind="gold_plating"), entry(self.ids[1]), entry(self.ids[2])]
        self.assertTrue(self.check(findings=findings))

    def test_reshape_spec_needs_a_spec_gap_finding(self):
        self.assertTrue(self.check(round_verdict="RESHAPE_SPEC", user_decision="q?"))
        findings = [entry(self.ids[0], kind="spec_gap"), entry(self.ids[1]), entry(self.ids[2])]
        self.assertEqual(self.check(round_verdict="RESHAPE_SPEC", findings=findings, user_decision="q?"), [])

    def test_a_locking_verdict_must_state_the_question_the_user_answers(self):
        """A lock with no question leaves the user nothing to do but type unlock, which trains them to."""
        findings = [entry(self.ids[0], kind="spec_gap"), entry(self.ids[1]), entry(self.ids[2])]
        for verdict in policy.LOCKING:
            for missing in ({}, {"user_decision": " "}):
                errors = self.check(round_verdict=verdict, findings=findings, **missing)
                self.assertTrue(any("user_decision" in e for e in errors), (verdict, missing))

    def test_only_a_locking_verdict_asks_the_user_anything(self):
        errors = self.check(user_decision="should we?")
        self.assertTrue(any("user_decision" in e for e in errors))

    def test_the_schema_offers_the_question(self):
        schema = assessment.assessment_schema("r", policy.VERDICTS)
        self.assertIn("user_decision", schema["properties"])

    def test_one_defect_raised_by_two_reviewers_is_still_a_patch(self):
        findings = [entry(self.ids[0]), entry(self.ids[1]), entry(self.ids[2], kind="duplicate", duplicate_of=self.ids[0])]
        self.assertEqual(self.check(findings=findings), [])

    def test_a_duplicate_names_an_original_finding_of_this_round(self):
        for target in (None, self.ids[2], "code-reviewer-99"):
            with self.subTest(duplicate_of=target):
                dup = entry(self.ids[2], kind="duplicate", **({"duplicate_of": target} if target else {}))
                self.assertTrue(self.check(findings=[entry(self.ids[0]), entry(self.ids[1]), dup]))
        chained = [entry(self.ids[0]), entry(self.ids[1], kind="duplicate", duplicate_of=self.ids[0]),
                   entry(self.ids[2], kind="duplicate", duplicate_of=self.ids[1])]
        self.assertTrue(self.check(findings=chained))

    def test_a_duplicate_carries_the_ruling_of_its_original(self):
        findings = [entry(self.ids[0]), entry(self.ids[1]),
                    entry(self.ids[2], verdict="PUSH_BACK", kind="duplicate", duplicate_of=self.ids[0])]
        self.assertTrue(self.check(findings=findings))

    def test_only_a_duplicate_names_an_original(self):
        findings = [entry(self.ids[0]), entry(self.ids[1]), entry(self.ids[2], duplicate_of=self.ids[0])]
        self.assertTrue(self.check(findings=findings))

    def test_patch_under_burden_of_proof_needs_a_defense(self):
        self.assertTrue(self.check(burden=True))
        self.assertEqual(self.check(burden=True, patch_defense="three unrelated modules, no shared code path"), [])


class ValidateReport(unittest.TestCase):
    def test_ids_must_be_unique_and_carry_the_reviewer_prefix(self):
        good = {"findings": [{"id": "code-reviewer-1"}, {"id": "code-reviewer-2"}]}
        self.assertEqual(assessment.validate_report(good, "code-reviewer"), [])
        self.assertTrue(assessment.validate_report({"findings": [{"id": "code-reviewer-1"}] * 2}, "code-reviewer"))
        self.assertTrue(assessment.validate_report({"findings": [{"id": "other-1"}]}, "code-reviewer"))


class Schemas(unittest.TestCase):
    def test_schemas_pin_the_round_so_output_cannot_land_on_another_round(self):
        ref = "acme/demo:feat/1-demo:internal-0.1"
        self.assertEqual(assessment.findings_schema(ref, "code-reviewer")["properties"]["round_ref"]["enum"], [ref])
        schema = assessment.assessment_schema(ref, ["CLASS_FIX", "ESCALATE"])
        self.assertEqual(schema["properties"]["round_verdict"]["enum"], ["CLASS_FIX", "ESCALATE"])

    def test_an_assessor_can_mark_a_finding_as_another_reviewers_duplicate(self):
        entry_schema = assessment.assessment_schema("r", ["PATCH"])["properties"]["findings"]["items"]
        self.assertIn("duplicate", entry_schema["properties"]["kind"]["enum"])
        self.assertIn("duplicate_of", entry_schema["properties"])


if __name__ == "__main__":
    unittest.main()
