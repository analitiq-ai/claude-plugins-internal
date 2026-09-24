import os
import tempfile
import unittest

from helpers import REVIEWERS, T0, add_round, assess, finding, state_with_round

import ledger


def drop(urls, status="findings", head="a" * 40):
    return {"repo": "acme/demo", "pr": 7, "status": status, "at": "2026-09-18T12:00:00Z",
            "head_ref": "feat/1-demo", "head_sha": head,
            "threads": [{"by": "codex", "path": "src/a.py", "line": 3, "url": u, "gist": "g", "severity": "P1",
                         "outdated": False, "at": "2026-09-18T11:59:00Z"} for u in urls],
            "failing_checks": [], "gate_comments": []}


class Rounds(unittest.TestCase):
    def test_round_collects_until_every_expected_reviewer_has_reported(self):
        state = ledger.new_state("acme/demo", "feat/1-demo")
        rnd = ledger.open_round(state, "internal", head_sha="a" * 40, base_sha="0" * 40, scope="full",
                                expected=REVIEWERS, escalation=False, now=T0)
        self.assertEqual(rnd["ref"], "acme/demo:feat/1-demo:internal-0.1")
        ledger.record_report(state, rnd["ref"], REVIEWERS[0],
                             {"round_ref": rnd["ref"], "findings": [finding("code-reviewer-1")]}, now=T0)
        self.assertEqual(rnd["status"], "collecting")
        ledger.record_report(state, rnd["ref"], REVIEWERS[1], {"round_ref": rnd["ref"], "findings": []}, now=T0)
        self.assertEqual(rnd["status"], "awaiting_assessment")
        self.assertEqual([f["id"] for f in rnd["findings"]], ["code-reviewer-1"])
        self.assertEqual(rnd["findings"][0]["reviewer"], REVIEWERS[0])

    def test_round_with_no_findings_is_clean_without_an_assessment(self):
        self.assertEqual(ledger.current_round(state_with_round(findings_per_reviewer=(0, 0)))["status"], "clean")

    def test_report_from_an_unexpected_agent_is_rejected(self):
        state = ledger.new_state("acme/demo", "feat/1-demo")
        rnd = ledger.open_round(state, "internal", head_sha="a" * 40, base_sha="0" * 40, scope="full",
                                expected=REVIEWERS, escalation=False, now=T0)
        with self.assertRaises(ledger.LedgerError):
            ledger.record_report(state, rnd["ref"], "workflow-subagent", {"findings": []}, now=T0)

    def test_relaunch_replaces_a_run_that_never_completed(self):
        state = ledger.new_state("acme/demo", "feat/1-demo")
        for _ in range(2):
            rnd = ledger.open_round(state, "internal", head_sha="a" * 40, base_sha="0" * 40, scope="full",
                                    expected=REVIEWERS, escalation=False, now=T0)
        self.assertEqual(len(state["rounds"]), 1)
        self.assertEqual(rnd["n"], 1)

    def test_round_numbers_count_completed_rounds_of_the_stage(self):
        state = state_with_round()
        assess(state, "PATCH")
        self.assertEqual(add_round(state, head="b" * 40)["n"], 2)

    def test_assessed_escalation_audit_starts_a_new_epoch(self):
        state = state_with_round(stage="audit", escalation=True)
        assess(state, "CLASS_FIX")
        self.assertEqual(state["epoch"], 1)
        self.assertEqual(add_round(state, head="b" * 40)["ref"], "acme/demo:feat/1-demo:internal-1.1")

    def test_clean_escalation_audit_also_starts_a_new_epoch(self):
        state = state_with_round(stage="audit", findings_per_reviewer=(0, 0), escalation=True)
        self.assertEqual(state["epoch"], 1)

    def test_adjudicated_lists_every_assessed_finding_with_its_verdict(self):
        state = state_with_round()
        assess(state, "CONVERGED_PUSHBACK", finding_verdict="PUSH_BACK")
        self.assertEqual([(a["id"], a["verdict"]) for a in ledger.adjudicated(state)], [("code-reviewer-1", "PUSH_BACK")])

    def test_ref_round_trips_to_its_branch(self):
        self.assertEqual(ledger.parse_ref("acme/demo:feat/1-demo:internal-0.1"), ("acme/demo", "feat/1-demo"))


class Polls(unittest.TestCase):
    def test_new_threads_open_a_github_round_awaiting_assessment(self):
        state = ledger.new_state("acme/demo", "feat/1-demo")
        rnd = ledger.ingest_poll(state, drop(["https://x/1", "https://x/2"]), now=T0)
        self.assertEqual((rnd["stage"], rnd["status"], state["pr"]), ("github", "awaiting_assessment", 7))
        self.assertEqual([f["id"] for f in rnd["findings"]], ["https://x/1", "https://x/2"])

    def test_same_threads_polled_again_do_not_open_another_round(self):
        state = ledger.new_state("acme/demo", "feat/1-demo")
        ledger.ingest_poll(state, drop(["https://x/1"]), now=T0)
        self.assertIsNone(ledger.ingest_poll(state, drop(["https://x/1"]), now=T0))
        self.assertEqual(len(state["rounds"]), 1)

    def test_only_unseen_threads_are_findings_of_the_next_round(self):
        state = ledger.new_state("acme/demo", "feat/1-demo")
        ledger.ingest_poll(state, drop(["https://x/1"]), now=T0)
        assess(state, "PATCH")
        rnd = ledger.ingest_poll(state, drop(["https://x/1", "https://x/2"], head="b" * 40), now=T0)
        self.assertEqual([f["id"] for f in rnd["findings"]], ["https://x/2"])
        self.assertEqual(rnd["carried"], ["https://x/1"])
        self.assertEqual(rnd["n"], 2)

    def test_clean_poll_is_recorded_against_its_commit(self):
        state = ledger.new_state("acme/demo", "feat/1-demo")
        self.assertIsNone(ledger.ingest_poll(state, drop([], status="clean", head="c" * 40), now=T0))
        self.assertEqual(state["github_clean_sha"], "c" * 40)


class Storage(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["ALQ_REVIEW_STATE_DIR"] = self.tmp.name
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(os.environ.pop, "ALQ_REVIEW_STATE_DIR")

    def test_state_survives_between_openings(self):
        with ledger.open_state("acme/demo", "feat/1-demo") as state:
            add_round(state)
        with ledger.open_state("acme/demo", "feat/1-demo") as state:
            self.assertEqual(len(state["rounds"]), 1)

    def test_failed_transaction_writes_nothing(self):
        with self.assertRaises(RuntimeError):
            with ledger.open_state("acme/demo", "feat/1-demo") as state:
                add_round(state)
                raise RuntimeError("boom")
        with ledger.open_state("acme/demo", "feat/1-demo") as state:
            self.assertEqual(state["rounds"], [])

    def test_two_branches_flattening_to_one_directory_fail_loudly(self):
        with ledger.open_state("acme/demo", "feat/1__demo"):
            pass
        with self.assertRaises(ledger.LedgerError):
            with ledger.open_state("acme/demo", "feat/1/demo"):
                pass

    def test_inbox_drop_is_consumed_once(self):
        inbox = ledger.state_root() / "inbox"
        inbox.mkdir(parents=True)
        import json
        (inbox / "acme__demo__7.json").write_text(json.dumps(drop(["https://x/1"])))
        (inbox / "acme__demo__8.json").write_text(json.dumps(dict(drop(["https://x/9"]), head_ref="feat/2-other", pr=8)))
        with ledger.open_state("acme/demo", "feat/1-demo") as state:
            ledger.ingest_inbox(state, now=T0)
            self.assertEqual(len(state["rounds"]), 1)
        self.assertFalse((inbox / "acme__demo__7.json").exists())
        self.assertTrue((inbox / "acme__demo__8.json").exists())


if __name__ == "__main__":
    unittest.main()
