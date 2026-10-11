import os
import re
import sqlite3
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing

from helpers import REVIEWERS, T0, add_round, assess, finding, state_with_round

import ledger
import policy


def drop(urls, status="findings", head="a" * 40):
    return {"repo": "acme/demo", "pr": 7, "status": status, "at": "2026-09-18T12:00:00Z",
            "head_ref": "feat/1-demo", "head_sha": head,
            "threads": [{"by": "codex", "path": "src/a.py", "line": 3, "url": u, "gist": "g", "severity": "P1",
                         "outdated": False, "at": "2026-09-18T11:59:00Z"} for u in urls],
            "failing_checks": [], "gate_comments": []}


class Rounds(unittest.TestCase):
    def test_round_collects_until_every_expected_reviewer_has_reported(self):
        state = ledger.new_state("acme/demo", "feat/1-demo")
        state["pr"] = 7
        rnd = ledger.open_round(state, "internal", head_sha="a" * 40, base_sha="0" * 40, scope="full",
                                expected=REVIEWERS, escalation=False, now=T0)
        self.assertEqual(rnd["ref"], "acme/demo#7:internal-0.1")
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
        self.assertTrue(add_round(state, head="b" * 40)["ref"].endswith(":internal-1.1"))

    def test_clean_escalation_audit_also_starts_a_new_epoch(self):
        state = state_with_round(stage="audit", findings_per_reviewer=(0, 0), escalation=True)
        self.assertEqual(state["epoch"], 1)

    def test_adjudicated_lists_every_assessed_finding_with_its_verdict(self):
        state = state_with_round()
        assess(state, "CONVERGED_PUSHBACK", finding_verdict="PUSH_BACK")
        self.assertEqual([(a["id"], a["verdict"]) for a in ledger.adjudicated(state)], [("code-reviewer-1", "PUSH_BACK")])


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


class Store(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["ALQ_REVIEW_STATE_DIR"] = self.tmp.name
        self.addCleanup(self.tmp.cleanup)
        self.addCleanup(os.environ.pop, "ALQ_REVIEW_STATE_DIR")

    def primary_key(self, table):
        with ledger.open_ledger("acme/demo", 7):
            pass
        with closing(sqlite3.connect(ledger.state_root() / "ledger.db")) as conn:
            columns = conn.execute(f"PRAGMA table_info({table})").fetchall()
        return [name for _, name, _, _, _, pk in sorted(columns, key=lambda c: c[5]) if pk]

    def test_a_name_that_is_not_utf8_is_refused_by_name_before_it_is_stored(self):
        """sqlite keeps text as UTF-8; a branch, path or file name git holds in other bytes has no UTF-8 to keep."""
        branch = os.fsdecode(b"feat/caf\xe9")
        with self.assertRaisesRegex(ledger.LedgerError, f"{re.escape(repr(branch))} is not UTF-8"):
            ledger.open_pr("acme/demo", branch, "a" * 40, lambda: 7)
        with self.assertRaisesRegex(ledger.LedgerError, f"{re.escape(repr(branch))} is not UTF-8"):
            ledger.names("acme/demo", branch)

    def test_a_ledger_is_keyed_by_its_pr(self):
        self.assertEqual(self.primary_key("ledgers"), ["repo", "pr"])

    def test_githubs_open_pr_is_kept_per_commit(self):
        self.assertEqual(self.primary_key("open_prs"), ["repo", "branch", "head"])
        asked = []

        def ask():
            asked.append(1)
            return 7
        self.assertEqual([ledger.open_pr("acme/demo", "feat/1-demo", head, ask) for head in "aab"], [7, 7, 7])
        self.assertEqual(len(asked), 2)

    def test_github_not_answering_is_not_kept(self):
        def unanswered():
            raise RuntimeError("no answer")
        with self.assertRaises(RuntimeError):
            ledger.open_pr("acme/demo", "feat/1-demo", "a", unanswered)
        self.assertIsNone(ledger.open_pr("acme/demo", "feat/1-demo", "a", lambda: None))

    def test_state_survives_between_openings(self):
        with ledger.open_ledger("acme/demo", 7) as state:
            add_round(state)
        with ledger.open_ledger("acme/demo", 7) as state:
            self.assertEqual((state["repo"], state["pr"], len(state["rounds"])), ("acme/demo", 7, 1))

    def test_failed_transaction_writes_nothing(self):
        with ledger.open_ledger("acme/demo", 7) as state:
            add_round(state)
        with self.assertRaises(RuntimeError):
            with ledger.open_ledger("acme/demo", 7) as state:
                add_round(state, head="b" * 40)
                raise RuntimeError("boom")
        with ledger.open_ledger("acme/demo", 7) as state:
            self.assertEqual(len(state["rounds"]), 1)

    def test_a_ledger_whose_first_opening_failed_does_not_exist(self):
        with self.assertRaises(RuntimeError):
            with ledger.open_ledger("acme/demo", 7):
                raise RuntimeError("boom")
        self.assertEqual(list(ledger.all_states()), [])

    def test_claim_tables_are_keyed_by_repo_and_what_they_fingerprint(self):
        self.assertEqual(self.primary_key("claim_checks"), ["repo", "tree"])
        self.assertEqual(self.primary_key("claim_reads"), ["repo", "patch_id"])
        self.assertEqual(self.primary_key("claim_verdicts"), ["repo", "claim_id"])

    def test_claim_records_round_trip_inside_one_transaction(self):
        with ledger.open_claims("acme/demo") as claims:
            self.assertIsNone(claims.check("t1"))
            claims.save_check({"tree": "t1", "status": "reading"})
            claims.save_read("p1", {"kind": "PROSE", "claims": []})
            claims.save_verdict("c1", {"evidence_blobs": {"a.py": "b1"}})
        with ledger.open_claims("acme/demo") as claims:
            self.assertEqual(claims.check("t1")["status"], "reading")
            self.assertEqual(claims.read("p1")["kind"], "PROSE")
            self.assertEqual(claims.verdict("c1")["evidence_blobs"], {"a.py": "b1"})
        with ledger.open_claims("other/repo") as claims:
            self.assertIsNone(claims.check("t1"))

    def test_a_failed_claims_transaction_writes_nothing(self):
        with self.assertRaises(RuntimeError):
            with ledger.open_claims("acme/demo") as claims:
                claims.save_check({"tree": "t1", "status": "reading"})
                raise RuntimeError("boom")
        with ledger.open_claims("acme/demo") as claims:
            self.assertIsNone(claims.check("t1"))

    def test_an_older_ledger_file_gains_the_claim_tables(self):
        self.tmp_root = ledger.state_root()
        self.tmp_root.mkdir(parents=True, exist_ok=True)
        with closing(sqlite3.connect(self.tmp_root / "ledger.db")) as conn:
            conn.execute("CREATE TABLE ledgers (repo TEXT NOT NULL, pr INTEGER NOT NULL, doc TEXT NOT NULL, "
                         "PRIMARY KEY (repo, pr))")
        with ledger.open_claims("acme/demo") as claims:
            claims.save_check({"tree": "t1", "status": "reading"})

    def test_lineages_are_found_by_their_own_id_or_by_the_id_of_words_they_hold(self):
        def open_one(lid, claim, state="open"):
            return {"id": lid, "opened": "r:1", "file": "README.md", "state": state,
                    "places": [{"start": 0, "end": 5, "claim": claim}]}
        with ledger.open_claims("acme/demo") as claims:
            claims.save_lineage("feat/1-x", open_one("aaa", "now"))
            claims.save_lineage("feat/1-x", open_one("bbb", "bbb", state="ended"))
        with ledger.open_claims("other/repo") as claims:
            claims.save_lineage("feat/2-y", open_one("aaa", "aaa"))
        self.assertEqual(ledger.claim_lineage_holders("aaa"), [("acme/demo", "feat/1-x", "aaa"), ("other/repo", "feat/2-y", "aaa")])
        self.assertEqual(ledger.claim_lineage_holders("now"), [("acme/demo", "feat/1-x", "aaa")])
        self.assertEqual(ledger.claim_lineage_holders("bbb"), [])
        self.assertEqual(ledger.claim_lineage_holders("zzz"), [])

    def test_lineage_tables_are_keyed_by_what_names_one_row(self):
        self.assertEqual(self.primary_key("claim_lineages"), ["repo", "branch", "id", "opened"])
        self.assertEqual(self.primary_key("seen_files"), ["repo", "branch", "gate", "file"])
        self.assertEqual(self.primary_key("shim_bugs"), ["repo", "id"])

    def lineage(self, lid, opened="r:1", file="README.md", state="open"):
        return {"id": lid, "opened": opened, "file": file, "state": state, "ended": None, "chain": [],
                "places": [{"start": 0, "end": 5, "claim": lid}], "released": None}

    def test_lineages_round_trip_by_branch_and_file(self):
        with ledger.open_claims("acme/demo") as claims:
            claims.save_lineage("feat/1-x", self.lineage("a"))
            claims.save_lineage("feat/1-x", self.lineage("b", file="docs/b.md"))
            claims.save_lineage("feat/2-y", self.lineage("a"))
        with ledger.open_claims("acme/demo") as claims:
            self.assertEqual([item["id"] for item in claims.open_lineages("feat/1-x")], ["a", "b"])
            self.assertEqual([item["id"] for item in claims.open_lineages("feat/1-x", "docs/b.md")], ["b"])
            self.assertEqual(claims.open_lineage("feat/1-x", "a")["places"], [{"start": 0, "end": 5, "claim": "a"}])
            self.assertIsNone(claims.open_lineage("feat/1-x", "zz"))
        with ledger.open_claims("other/repo") as claims:
            self.assertEqual(claims.open_lineages("feat/1-x"), [])

    def test_an_ended_lineage_keeps_its_row_and_the_same_words_open_a_new_one(self):
        with ledger.open_claims("acme/demo") as claims:
            claims.save_lineage("feat/1-x", self.lineage("a", opened="r:1", state="ended"))
            self.assertIsNone(claims.open_lineage("feat/1-x", "a"))
            claims.save_lineage("feat/1-x", self.lineage("a", opened="r:2"))
            self.assertEqual(claims.open_lineage("feat/1-x", "a")["opened"], "r:2")
            self.assertEqual([item["opened"] for item in claims.open_lineages("feat/1-x")], ["r:2"])
        with closing(sqlite3.connect(ledger.state_root() / "ledger.db")) as conn:
            self.assertEqual(conn.execute("SELECT count(*) FROM claim_lineages").fetchone(), (2,))

    def test_seen_files_round_trip_per_gate(self):
        with ledger.open_claims("acme/demo") as claims:
            self.assertIsNone(claims.seen("feat/1-x", "claim", "README.md"))
            claims.save_seen("feat/1-x", "claim", "README.md", {"text": "one\n", "ref": "r:1"})
            claims.save_seen("feat/1-x", "shim", "README.md", {"text": "two\n", "ref": "t1"})
        with ledger.open_shims("acme/demo") as shims:
            self.assertEqual(shims.seen("feat/1-x", "claim", "README.md"), {"text": "one\n", "ref": "r:1"})
            self.assertEqual(shims.seen("feat/1-x", "shim", "README.md"), {"text": "two\n", "ref": "t1"})
            self.assertIsNone(shims.seen("feat/2-y", "shim", "README.md"))

    def test_a_claim_check_keeps_its_branch_and_lineages(self):
        with ledger.open_claims("acme/demo") as claims:
            claims.save_check({"tree": "t1", "status": "reading", "branch": "feat/1-x", "lineages": {"c1": "a"}})
        with ledger.open_claims("acme/demo") as claims:
            self.assertEqual(claims.check("t1")["lineages"], {"c1": "a"})

    def test_bugs_round_trip_and_open_bugs_are_found_by_branch(self):
        def bug(bid, branch, state):
            return {"id": bid, "branch": branch, "state": state, "count": 1, "members": [], "ranges": []}
        with ledger.open_shims("acme/demo") as shims:
            for each in (bug("b1", "feat/1-x", "open"), bug("b2", "feat/1-x", "held"), bug("b3", "feat/1-x", "ended"),
                         bug("b4", "feat/1-x", "merged"), bug("b5", "feat/2-y", "open")):
                shims.save_bug(each)
        with ledger.open_shims("acme/demo") as shims:
            self.assertEqual(shims.bug("b1")["state"], "open")
            self.assertIsNone(shims.bug("zz"))
            self.assertEqual([each["id"] for each in shims.open_bugs("feat/1-x")], ["b1", "b2"])
        with ledger.open_shims("other/repo") as shims:
            self.assertEqual(shims.open_bugs("feat/1-x"), [])

    def test_shim_tables_are_keyed_by_repo_and_what_they_record(self):
        self.assertEqual(self.primary_key("shim_checks"), ["repo", "tree"])
        self.assertEqual(self.primary_key("shim_rulings"), ["repo", "chain_id", "site_id"])

    def test_shim_records_round_trip_inside_one_transaction(self):
        with ledger.open_shims("acme/demo") as shims:
            self.assertIsNone(shims.check("t1"))
            self.assertEqual(shims.rulings("c1"), {})
            shims.save_check({"tree": "t1", "status": "sweeping"})
            shims.save_ruling("c1", "s1", {"ruling": "not_shared", "reason": "r"})
        with ledger.open_shims("acme/demo") as shims:
            self.assertEqual(shims.check("t1")["status"], "sweeping")
            self.assertEqual(shims.rulings("c1"), {"s1": {"ruling": "not_shared", "reason": "r"}})
        with ledger.open_shims("other/repo") as shims:
            self.assertIsNone(shims.check("t1"))

    def test_a_failed_shims_transaction_writes_nothing(self):
        with self.assertRaises(RuntimeError):
            with ledger.open_shims("acme/demo") as shims:
                shims.save_check({"tree": "t1", "status": "sweeping"})
                raise RuntimeError("boom")
        with ledger.open_shims("acme/demo") as shims:
            self.assertIsNone(shims.check("t1"))

    def test_an_override_id_is_found_as_a_chain_or_a_tree_prefix(self):
        with ledger.open_shims("acme/demo") as shims:
            shims.save_bug({"id": "c" * 16, "branch": "feat/1-x", "state": "open"})
            shims.save_check({"tree": "0123456789ab" + "f" * 28, "status": "complete"})
        with ledger.open_shims("other/repo") as shims:
            shims.save_check({"tree": "0123456789ab" + "e" * 28, "status": "complete"})
        self.assertEqual(ledger.shim_bug_repos("c" * 16), ["acme/demo"])
        self.assertEqual(ledger.shim_bug_repos("d" * 16), [])
        self.assertEqual(ledger.shim_trees("0123456789ab"),
                         [("acme/demo", "0123456789ab" + "f" * 28), ("other/repo", "0123456789ab" + "e" * 28)])

    def test_two_writers_to_one_ledger_take_turns(self):
        """The second reads only after the first has written, so neither change is lost."""
        first_inside = threading.Event()

        def first():
            with ledger.open_ledger("acme/demo", 7) as state:
                first_inside.set()
                time.sleep(0.3)
                ledger.unlock(state, "first", T0)

        def second():
            first_inside.wait(5)
            with ledger.open_ledger("acme/demo", 7) as state:
                ledger.unlock(state, "second", T0)

        with ThreadPoolExecutor(2) as pool:
            for done in [pool.submit(first), pool.submit(second)]:
                done.result()
        with ledger.open_ledger("acme/demo", 7) as state:
            self.assertEqual([u["reason"] for u in state["unlocks"]], ["first", "second"])

    def test_every_ledger_is_listed(self):
        for repo, pr in [("acme/demo", 7), ("acme/demo", 8), ("acme/other", 7)]:
            with ledger.open_ledger(repo, pr):
                pass
        self.assertEqual(sorted((s["repo"], s["pr"]) for s in ledger.all_states()),
                         [("acme/demo", 7), ("acme/demo", 8), ("acme/other", 7)])

    def test_a_round_ref_names_the_pr_and_parses_back_to_it(self):
        with ledger.open_ledger("acme/demo", 7) as state:
            ref = add_round(state)["ref"]
        self.assertEqual(ref, "acme/demo#7:internal-0.1")
        self.assertEqual(ledger.parse_ref(ref), ("acme/demo", 7))

    def test_inbox_drop_is_consumed_once(self):
        inbox = ledger.state_root() / "inbox"
        inbox.mkdir(parents=True)
        import json
        (inbox / "acme__demo__7.json").write_text(json.dumps(drop(["https://x/1"])))
        (inbox / "acme__demo__8.json").write_text(json.dumps(dict(drop(["https://x/9"]), head_ref="feat/2-other", pr=8)))
        ledger.ingest_inbox(now=T0)
        ledger.ingest_inbox(now=T0)
        rounds = {s["pr"]: len(s["rounds"]) for s in ledger.all_states()}
        self.assertEqual(rounds, {7: 1, 8: 1})
        self.assertEqual(list(inbox.iterdir()), [])


if __name__ == "__main__":
    unittest.main()
