import unittest
from datetime import timedelta

from helpers import REVIEWERS, T0, add_round, assess, state_with_round

import ledger
import policy

HEAD_A, HEAD_B = "a" * 40, "b" * 40


def mutation(state, inflight=0):
    return policy.mutation(state, inflight=inflight)


def spend_audits(state, verdict="CLASS_FIX"):
    """Every audit the branch may run, each reached by the cap and ruled `verdict`."""
    for _ in range(policy.MAX_AUDITS):
        for i in range(policy.CAP):
            add_round(state, head=str(i) * 40)
            assess(state, "PATCH")
        add_round(state, stage="audit", escalation=True)
        assess(state, verdict, finding_verdict="PUSH_BACK" if verdict == "CONVERGED_PUSHBACK" else "FIX")
    return state


class Mutation(unittest.TestCase):
    def test_branch_without_rounds_is_free(self):
        self.assertTrue(mutation(ledger.new_state("acme/demo", "feat/1-demo", pr=7)).allow)

    def test_denied_while_reviewers_are_still_reporting(self):
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        rnd = ledger.open_round(state, "internal", head_sha=HEAD_A, base_sha="0" * 40, scope="full",
                                expected=REVIEWERS, escalation=False, now=T0)
        ledger.record_report(state, rnd["ref"], REVIEWERS[0], {"round_ref": rnd["ref"], "findings": []}, now=T0)
        decision = mutation(state)
        self.assertFalse(decision.allow)
        self.assertIn("1/2", decision.reason)

    def test_denied_until_the_round_is_assessed_and_names_the_next_step(self):
        decision = mutation(state_with_round())
        self.assertFalse(decision.allow)
        self.assertIn("alq-review:assess-round", decision.reason)

    def test_allowed_once_assessed_as_patch(self):
        state = state_with_round()
        assess(state, "PATCH")
        self.assertTrue(mutation(state).allow)

    def test_clean_round_does_not_block(self):
        self.assertTrue(mutation(state_with_round(findings_per_reviewer=(0, 0))).allow)

    def test_redesign_is_carried_out_not_locked(self):
        """REDESIGN's next step is the rewrite itself; a lock would forbid the one thing it asks for."""
        state = state_with_round()
        assess(state, "REDESIGN")
        self.assertTrue(mutation(state).allow)

    def test_reshape_spec_locks_until_the_user_unlocks(self):
        state = state_with_round()
        assess(state, "RESHAPE_SPEC")
        self.assertFalse(mutation(state).allow)
        ledger.unlock(state, "user decided", now=T0 + timedelta(hours=1))
        self.assertTrue(mutation(state).allow)

    def test_a_lock_tells_the_agent_to_ask_the_user_for_the_unlock(self):
        """The agent is the only one who sees the refusal; the user unlocks only if the agent asks."""
        for pr, ref in ((None, "unlock feat/1-demo"), (414, "unlock #414")):
            state = state_with_round()
            state["pr"] = pr
            assess(state, "ESCALATE")
            reason = mutation(state).reason
            self.assertIn(f"`{ref}`", reason)
            self.assertIn("ask the user", reason)

    def test_spent_audits_lock_the_branch_and_ask_the_user_for_the_unlock(self):
        """Nothing else hands a non-converging branch back: without a lock, no unlock can release it."""
        # Unbound (no pr): the unlock target falls back to the branch name, which this test asserts on.
        state = spend_audits(ledger.new_state("acme/demo", "feat/1-demo"))
        self.assertTrue(policy.locked(state))
        reason = mutation(state).reason
        self.assertIn("not converging", reason)
        self.assertIn("`unlock feat/1-demo`", reason)
        self.assertIn("ask the user", reason)

    def test_a_spent_audit_lock_puts_each_audits_ruling_to_the_user(self):
        reason = mutation(spend_audits(ledger.new_state("acme/demo", "feat/1-demo", pr=7))).reason
        self.assertEqual(reason.count("CLASS_FIX: do the thing"), policy.MAX_AUDITS)

    def test_an_audit_that_found_the_branch_converged_spends_nothing(self):
        """The budget stops a branch that is not converging; an audit that says it has converged is not that."""
        state = spend_audits(ledger.new_state("acme/demo", "feat/1-demo", pr=7), verdict="CONVERGED_PUSHBACK")
        self.assertFalse(policy.locked(state))
        self.assertTrue(mutation(state).allow)

    def test_an_audit_with_no_findings_spends_nothing(self):
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        for _ in range(policy.MAX_AUDITS):
            add_round(state, stage="audit", findings_per_reviewer=(0, 0), escalation=True)
        self.assertFalse(policy.locked(state))

    def test_a_verdict_lock_puts_the_assessors_question_to_the_user(self):
        state = state_with_round()
        assess(state, "RESHAPE_SPEC")
        self.assertIn("which root is canonical?", mutation(state).reason)

    def test_a_reshape_spec_lock_offers_the_rescope_as_well_as_the_unlock(self):
        state = state_with_round()
        assess(state, "RESHAPE_SPEC")
        reason = mutation(state).reason
        self.assertIn("`/design-doc rescope #7`", reason)
        self.assertIn("`unlock #7`", reason)

    def test_an_escalate_lock_offers_no_rescope(self):
        state = state_with_round()
        assess(state, "ESCALATE")
        self.assertNotIn("/design-doc", mutation(state).reason)

    def test_spent_audits_offer_no_rescope_even_when_the_last_audit_ruled_reshape_spec(self):
        """The spent-audit question is whether to go on at all; a re-scope of one ruling does not answer it."""
        state = spend_audits(ledger.new_state("acme/demo", "feat/1-demo", pr=7), verdict="RESHAPE_SPEC")
        self.assertNotIn("/design-doc", mutation(state).reason)

    def test_an_unlock_grants_a_fresh_audit_budget(self):
        state = spend_audits(ledger.new_state("acme/demo", "feat/1-demo", pr=7))
        ledger.unlock(state, "user decided", now=T0 + timedelta(hours=1))
        self.assertTrue(mutation(state).allow)
        self.assertTrue(policy.launch_round(state, "internal", head_sha=HEAD_B, dirty=False, inflight=0).allow)
        spend_audits(state)
        self.assertTrue(policy.locked(state))

    def test_denied_while_any_reviewer_subagent_is_in_flight(self):
        decision = mutation(ledger.new_state("acme/demo", "feat/1-demo", pr=7), inflight=3)
        self.assertFalse(decision.allow)
        self.assertIn("3", decision.reason)


class LaunchRound(unittest.TestCase):
    def launch(self, state, stage="internal", head=HEAD_B, dirty=False, inflight=0):
        return policy.launch_round(state, stage, head_sha=head, dirty=dirty, inflight=inflight)

    def test_first_round_is_full_scope(self):
        decision = self.launch(ledger.new_state("acme/demo", "feat/1-demo", pr=7))
        self.assertTrue(decision.allow)
        self.assertEqual(decision.scope, "full")

    def test_uncommitted_work_is_refused_because_rounds_are_pinned_to_commits(self):
        self.assertFalse(self.launch(ledger.new_state("acme/demo", "feat/1-demo", pr=7), dirty=True).allow)

    def test_second_round_reviews_only_the_delta_since_the_first(self):
        state = state_with_round(head=HEAD_A)
        assess(state, "PATCH")
        decision = self.launch(state, head=HEAD_B)
        self.assertTrue(decision.allow)
        self.assertEqual((decision.scope, decision.delta_from), ("delta", HEAD_A))

    def test_rerunning_on_an_unchanged_head_is_refused(self):
        state = state_with_round(head=HEAD_A)
        assess(state, "PATCH")
        decision = self.launch(state, head=HEAD_A)
        self.assertFalse(decision.allow)
        self.assertIn("re-sample", decision.reason)

    def test_unassessed_round_must_be_assessed_not_rerun(self):
        decision = self.launch(state_with_round(head=HEAD_A))
        self.assertFalse(decision.allow)
        self.assertIn("alq-review:assess-round", decision.reason)

    def test_dead_run_may_be_relaunched_but_a_live_one_may_not(self):
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        ledger.open_round(state, "internal", head_sha=HEAD_A, base_sha="0" * 40, scope="full",
                          expected=REVIEWERS, escalation=False, now=T0)
        self.assertFalse(self.launch(state, head=HEAD_A, inflight=2).allow)
        self.assertTrue(self.launch(state, head=HEAD_A, inflight=0).allow)

    def capped_state(self):
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        for i in range(policy.CAP):
            add_round(state, head=str(i) * 40)
            assess(state, "PATCH")
        return state

    def test_fifth_round_is_refused_and_the_audit_is_named(self):
        decision = self.launch(self.capped_state())
        self.assertFalse(decision.allow)
        self.assertIn("stage: 'audit'", decision.reason)

    def test_audit_at_the_cap_is_an_escalation_and_reopens_the_stage(self):
        state = self.capped_state()
        decision = self.launch(state, stage="audit")
        self.assertTrue(decision.allow and decision.escalation)
        add_round(state, stage="audit", escalation=True)
        assess(state, "CLASS_FIX")
        reopened = self.launch(state, head="c" * 40)
        self.assertTrue(reopened.allow)
        self.assertEqual(reopened.scope, "full")

    def test_audit_below_the_cap_is_not_an_escalation(self):
        decision = self.launch(state_with_round(findings_per_reviewer=(0, 0)), stage="audit")
        self.assertTrue(decision.allow)
        self.assertFalse(decision.escalation)

    def test_the_last_audit_is_itself_terminal(self):
        """Its budget must not refill: the rounds after it are the ones the audit just judged futile."""
        state = spend_audits(ledger.new_state("acme/demo", "feat/1-demo", pr=7))
        decision = self.launch(state, stage="internal")
        self.assertFalse(decision.allow)
        self.assertIn("not converging", decision.reason)

    def converged_at_the_cap(self):
        """Three rounds with findings, then a clean fourth at HEAD_A: the case of engineering#50."""
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        for i in range(policy.CAP - 1):
            add_round(state, head=str(i) * 40)
            assess(state, "PATCH")
        add_round(state, findings_per_reviewer=(0, 0), head=HEAD_A)
        return state

    def test_a_round_after_a_clean_fourth_round_is_a_delta_round_not_the_cap(self):
        decision = self.launch(self.converged_at_the_cap(), head=HEAD_B)
        self.assertTrue(decision.allow, decision.reason)
        self.assertEqual((decision.scope, decision.delta_from), ("delta", HEAD_A))

    def test_an_audit_after_a_clean_fourth_round_is_not_an_escalation(self):
        decision = self.launch(self.converged_at_the_cap(), stage="audit")
        self.assertTrue(decision.allow)
        self.assertFalse(decision.escalation)

    def test_the_cap_counts_again_from_the_last_settled_round(self):
        state = self.converged_at_the_cap()
        for i in range(policy.CAP):
            self.assertTrue(self.launch(state, head=str(i + 5) * 40).allow)
            add_round(state, head=str(i + 5) * 40)
            assess(state, "PATCH")
        decision = self.launch(state, head="f" * 40)
        self.assertFalse(decision.allow)
        self.assertIn("stage: 'audit'", decision.reason)

    def test_cap_hit_after_two_audits_hands_off_to_the_user(self):
        state = spend_audits(ledger.new_state("acme/demo", "feat/1-demo", pr=7))
        for i in range(policy.CAP):
            add_round(state, head=str(i) * 40)
            assess(state, "PATCH")
        for stage in ("internal", "audit"):
            decision = self.launch(state, stage=stage)
            self.assertFalse(decision.allow)
            self.assertIn("user", decision.reason)


class Rerequest(unittest.TestCase):
    def test_refused_while_a_round_is_unassessed(self):
        self.assertFalse(policy.rerequest(state_with_round(stage="github"), inflight=0).allow)

    def test_refused_at_the_cap_until_the_audit_has_run(self):
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        for i in range(policy.CAP):
            add_round(state, stage="github", head=str(i) * 40)
            assess(state, "PATCH")
        decision = policy.rerequest(state, inflight=0)
        self.assertFalse(decision.allow)
        self.assertIn("stage: 'audit'", decision.reason)

    def test_allowed_when_the_round_at_the_cap_converged_on_pushback(self):
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        for i in range(policy.CAP):
            add_round(state, stage="github", head=str(i) * 40)
            assess(state, "PATCH" if i < policy.CAP - 1 else "CONVERGED_PUSHBACK", finding_verdict="PUSH_BACK")
        decision = policy.rerequest(state, inflight=0)
        self.assertTrue(decision.allow, decision.reason)

    def test_allowed_after_an_assessed_round_below_the_cap(self):
        state = state_with_round(stage="github")
        assess(state, "PATCH")
        self.assertTrue(policy.rerequest(state, inflight=0).allow)


class MarkReady(unittest.TestCase):
    def test_refused_without_a_clean_internal_round_at_head(self):
        state = state_with_round(head=HEAD_A)
        assess(state, "PATCH")
        self.assertFalse(policy.mark_ready(state, head_sha=HEAD_A, inflight=0, released=False).allow)
        self.assertFalse(policy.mark_ready(ledger.new_state("acme/demo", "feat/1-demo", pr=7), head_sha=HEAD_A, inflight=0, released=False).allow)

    def test_allowed_when_the_round_at_head_came_back_clean(self):
        state = state_with_round(findings_per_reviewer=(0, 0), head=HEAD_A)
        self.assertTrue(policy.mark_ready(state, head_sha=HEAD_A, inflight=0, released=False).allow)
        self.assertFalse(policy.mark_ready(state, head_sha=HEAD_B, inflight=0, released=False).allow)

    def test_a_version_only_release_needs_no_round(self):
        fresh = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        self.assertTrue(policy.mark_ready(fresh, head_sha=HEAD_A, inflight=0, released=True).allow)

    def test_a_version_only_release_still_waits_for_a_round_in_flight(self):
        self.assertFalse(policy.mark_ready(state_with_round(head=HEAD_A), head_sha=HEAD_A, inflight=0, released=True).allow)

    def test_allowed_when_every_finding_was_pushed_back(self):
        state = state_with_round(head=HEAD_A)
        assess(state, "CONVERGED_PUSHBACK", finding_verdict="PUSH_BACK")
        self.assertTrue(policy.mark_ready(state, head_sha=HEAD_A, inflight=0, released=False).allow)


class Admissible(unittest.TestCase):
    def test_ordinary_round_may_patch(self):
        state = state_with_round()
        self.assertIn("PATCH", policy.admissible_verdicts(ledger.current_round(state)))

    def test_escalation_audit_may_not_patch(self):
        state = state_with_round(stage="audit", escalation=True)
        self.assertNotIn("PATCH", policy.admissible_verdicts(ledger.current_round(state)))

    def test_a_file_at_its_third_edit_may_not_be_answered_with_another_edit(self):
        """The verdicts that keep the code moving are what produced the third edit."""
        state = state_with_round()
        admissible = policy.admissible_verdicts(ledger.current_round(state), churned=True)
        self.assertNotIn("PATCH", admissible)
        self.assertNotIn("CLASS_FIX", admissible)
        self.assertIn("REDESIGN", admissible)
        self.assertIn("RESHAPE_SPEC", admissible)


if __name__ == "__main__":
    unittest.main()
