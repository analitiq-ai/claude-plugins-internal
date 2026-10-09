import unittest

import helpers  # noqa: F401  (puts scripts/ on the path)

import claimcheck

TREE = "a" * 40
STAGED = {
    "README.md": ["# Demo", "", "The validator rejects an empty list,", "and it logs the reason.", "", "Other text."],
    "validator.py": ["def check(items):", "    return True"],
}


def hunk(hid="h1", file="README.md", old=(3, 1), new=(3, 2), removed=("old",), added=("new",), patch_id="p1"):
    return {"id": hid, "file": file, "old_start": old[0], "old_count": old[1], "new_start": new[0],
            "new_count": new[1], "removed": list(removed), "added": list(added), "patch_id": patch_id}


def located(path):
    return len(STAGED[path]) if path in STAGED else None


def text_of(path):
    return STAGED.get(path)


def claim(quote="The validator rejects an empty list", file="README.md", line=3, category="K1", hid="h1"):
    return {"id": claimcheck.claim_id(file, quote), "hunk": hid, "file": file, "line": line, "quote": quote,
            "category": category}


def verdict(kind="WRONG", **fields):
    body = {"check_ref": claimcheck.check_ref("acme/demo", TREE), "file": "README.md",
            "quote": "The validator rejects an empty list", "verdict": kind, "basis": "b",
            "assertions": [{"text": "it rejects an empty list", "confirmed": kind == "CORRECT",
                            "evidence": "validator.py:2"}]}
    if kind == "WRONG":
        body["failing_case"] = "check([]) returns True"
    if kind == "UNSURE":
        body["gap"] = "the caller is in another repo"
    return {**body, **fields}


def check(status="complete", verdicts=None, claims=None, hunks=None):
    claims = claims if claims is not None else [claim()]
    return {"repo": "acme/demo", "tree": TREE, "base": "b" * 40, "status": status,
            "hunks": hunks if hunks is not None else [hunk()], "batches": [["h1"]], "labels": {"h1": "PROSE"},
            "claims": {c["id"]: c for c in claims}, "verdicts": verdicts or {}, "contests": {}}


class Ids(unittest.TestCase):
    def test_a_claim_id_follows_its_file_and_words(self):
        same = claimcheck.claim_id("README.md", "the validator rejects")
        self.assertEqual(same, claimcheck.claim_id("README.md", "the  validator\n rejects"))
        self.assertNotEqual(same, claimcheck.claim_id("README.md", "the validator accepts"))
        self.assertNotEqual(same, claimcheck.claim_id("docs/x.md", "the validator rejects"))

    def test_a_claim_is_named_claim_dash_id_and_parses_back(self):
        cid = claimcheck.claim_id("README.md", "the validator rejects")
        self.assertEqual(claimcheck.claim_ref(cid), f"claim-{cid}")
        self.assertEqual(claimcheck.parse_claim_ref(claimcheck.claim_ref(cid)), cid)
        for other in (cid, f"claim-{cid}x", f" claim-{cid}", "claim-", None, 7):
            self.assertIsNone(claimcheck.parse_claim_ref(other), other)

    def test_a_check_ref_names_repo_and_tree_and_parses_back(self):
        ref = claimcheck.check_ref("acme/demo", TREE)
        self.assertEqual(ref, f"acme/demo#tree:{TREE}")
        self.assertEqual(claimcheck.parse_check_ref(ref), ("acme/demo", TREE))
        for bad in ("acme/demo#7:internal-0.1", "acme/demo#tree:xyz", f"demo#tree:{TREE}"):
            self.assertIsNone(claimcheck.parse_check_ref(bad), bad)

    def test_words_carry_the_offsets_of_the_words_plain_joins(self):
        text = "  # The validator\n  rejects  an\n\n// empty list"
        found = claimcheck.words(text)
        self.assertEqual([w for w, _, _ in found], ["The", "validator", "rejects", "an", "empty", "list"])
        self.assertTrue(all(text[start:end] == w for w, start, end in found))
        self.assertEqual(claimcheck.plain(text), "The validator rejects an empty list")

    def test_a_comment_marker_only_counts_at_the_start_of_a_line(self):
        self.assertEqual(claimcheck.plain("a # b\n> c"), "a # b c")

    def test_the_vocabularies(self):
        self.assertEqual(claimcheck.CATEGORIES, tuple(f"K{i}" for i in range(1, 10)))
        self.assertEqual(claimcheck.JUDGED, ("K1", "K9"))
        self.assertEqual(claimcheck.VERDICTS, ("CORRECT", "WRONG", "UNSURE"))


class ValidateReader(unittest.TestCase):
    def output(self, *hunks):
        return {"check_ref": claimcheck.check_ref("acme/demo", TREE), "batch": 0, "hunks": list(hunks)}

    def validate(self, *hunks, batch=(hunk(),)):
        return claimcheck.validate_reader(self.output(*hunks), [claimcheck.span(h, text_of(h["file"])) for h in batch])

    def test_a_quote_from_the_paragraph_passes(self):
        claims = [{"line": 3, "quote": "The validator rejects an empty list, and it logs", "category": "K1"}]
        self.assertEqual(self.validate({"id": "h1", "kind": "PROSE", "claims": claims}), [])

    def test_every_hunk_of_the_batch_exactly_once(self):
        both = (hunk(), hunk("h2", old=(6, 1), new=(6, 1)))
        self.assertTrue(self.validate({"id": "h1", "kind": "PROSE", "claims": []}, batch=both))
        twice = self.validate({"id": "h1", "kind": "PROSE", "claims": []}, {"id": "h1", "kind": "PROSE", "claims": []})
        self.assertTrue(twice)
        self.assertTrue(self.validate({"id": "h9", "kind": "PROSE", "claims": []}))

    def test_a_quote_not_in_the_staged_text_is_rejected(self):
        claims = [{"line": 3, "quote": "The validator rejects every list", "category": "K1"}]
        [error] = self.validate({"id": "h1", "kind": "PROSE", "claims": claims})
        self.assertIn("README.md:3", error)

    def test_a_line_outside_the_hunks_paragraph_is_rejected(self):
        claims = [{"line": 6, "quote": "Other text.", "category": "K1"}]
        self.assertTrue(self.validate({"id": "h1", "kind": "PROSE", "claims": claims}))

    def test_a_code_hunk_carries_no_claims(self):
        claims = [{"line": 3, "quote": "The validator rejects an empty list", "category": "K1"}]
        self.assertTrue(self.validate({"id": "h1", "kind": "CODE", "claims": claims}))

    def test_a_removal_is_read_in_the_paragraph_that_is_left(self):
        removal = hunk(old=(4, 1), new=(3, 0), removed=("only for admins",), added=())
        claims = [{"line": 3, "quote": "The validator rejects an empty list", "category": "K1"}]
        self.assertEqual(self.validate({"id": "h1", "kind": "PROSE", "claims": claims}, batch=(removal,)), [])

    def test_comment_markers_and_line_breaks_are_not_words(self):
        lines = ["# the gate refuses", "# every commit", "x = 1"]
        self.assertEqual(claimcheck.validate_reader(
            self.output({"id": "h1", "kind": "MIXED",
                         "claims": [{"line": 1, "quote": "the gate refuses every commit", "category": "K1"}]}),
            [claimcheck.span(hunk(file="a.py", old=(1, 0), new=(1, 3)), lines)]), [])


class ValidateVerdict(unittest.TestCase):
    def validate(self, body, contest=False):
        return claimcheck.validate_verdict(body, located, contest=contest)

    def test_well_formed_verdicts_pass(self):
        for kind in claimcheck.VERDICTS:
            self.assertEqual(self.validate(verdict(kind)), [], kind)

    def test_correct_needs_every_assertion_confirmed_with_evidence(self):
        unconfirmed = verdict("CORRECT", assertions=[{"text": "a", "confirmed": False, "evidence": "validator.py:1"}])
        self.assertTrue(self.validate(unconfirmed))
        bare = verdict("CORRECT", assertions=[{"text": "a", "confirmed": True, "evidence": "I read it"}])
        self.assertTrue(self.validate(bare))

    def test_wrong_needs_a_failing_case_and_a_broken_assertion_with_evidence(self):
        self.assertTrue(self.validate(verdict("WRONG", failing_case="")))
        confirmed = verdict("WRONG", assertions=[{"text": "a", "confirmed": True, "evidence": "validator.py:1"}])
        self.assertTrue(self.validate(confirmed))

    def test_every_settled_assertion_names_its_line(self):
        reasoned = {"text": "so the finding halts", "confirmed": False, "evidence": "this follows from the first"}
        broken = {"text": "a", "confirmed": False, "evidence": "validator.py:1"}
        self.assertTrue(self.validate(verdict("WRONG", assertions=[broken, reasoned])))
        found = {"text": "a", "confirmed": True, "evidence": "validator.py:1"}
        self.assertTrue(self.validate(verdict("UNSURE", assertions=[dict(found, evidence="I read it"), reasoned])))
        self.assertEqual(self.validate(verdict("UNSURE", assertions=[found, reasoned])), [])

    def test_unsure_needs_a_gap(self):
        self.assertTrue(self.validate(verdict("UNSURE", gap=" ")))

    def test_evidence_must_be_in_the_staged_tree(self):
        errors = self.validate(verdict("WRONG", assertions=[{"text": "a", "confirmed": False,
                                                             "evidence": "notes/untracked.py:3"}]))
        self.assertIn("notes/untracked.py", errors[0])
        self.assertTrue(self.validate(verdict("WRONG", assertions=[{"text": "a", "confirmed": False,
                                                                    "evidence": "validator.py:9"}])))

    def test_a_url_is_evidence_only_in_a_contest(self):
        cited = verdict("WRONG", assertions=[{"text": "a", "confirmed": False, "evidence": "https://docs.example/x"}])
        self.assertTrue(self.validate(cited))
        self.assertEqual(self.validate(cited, contest=True), [])


class Completion(unittest.TestCase):
    def settle(self, current):
        return claimcheck.settle(current)["status"]

    def test_unlabelled_hunks_keep_it_reading_and_unjudged_claims_keep_it_judging(self):
        self.assertEqual(self.settle(dict(check(), labels={})), "reading")
        self.assertEqual(self.settle(check()), "judging")

    def test_every_judged_claim_with_a_verdict_completes_it(self):
        current = check(verdicts={claim()["id"]: verdict("WRONG")})
        self.assertEqual(self.settle(current), "complete")

    def test_a_check_whose_verdicts_cite_nothing_in_the_tree_is_complete(self):
        nothing = verdict("UNSURE", assertions=[{"text": "a", "confirmed": False, "evidence": "not found"}])
        self.assertEqual(self.settle(check(verdicts={claim()["id"]: nothing})), "complete")

    def test_only_k1_is_judged_and_the_rest_are_counted(self):
        listed = claim("every rule is listed", category="K3")
        current = check(claims=[listed])
        self.assertEqual(self.settle(current), "complete")
        self.assertEqual(claimcheck.not_judged(current), {"K3": 1})
        self.assertEqual(claimcheck.to_judge(current), [])

    def test_what_a_test_checks_is_judged_like_what_the_code_does(self):
        named = claim("test_an_empty_list_is_rejected", file="tests/test_validator.py", category="K9")
        current = check(claims=[named, claim("every rule is listed", category="K3")])
        self.assertEqual(self.settle(current), "judging")
        self.assertEqual(claimcheck.to_judge(current), [named])
        self.assertEqual(claimcheck.not_judged(current), {"K3": 1})


class CommitPreconditions(unittest.TestCase):
    """What every commit check decides before reading its own record (shared with the shim check)."""

    def decide(self, **facts):
        return claimcheck.commit_preconditions(**{"empty": False, "concluding": False, "staging": False, "alone": True,
                                                  **facts})

    def test_nothing_to_commit_or_a_concluding_commit_is_let_through(self):
        self.assertTrue(self.decide(empty=True).allow)
        self.assertTrue(self.decide(concluding=True).allow)

    def test_a_commit_that_stages_or_shares_its_command_is_refused(self):
        for facts in ({"staging": True}, {"alone": False}):
            refused = self.decide(**facts)
            self.assertFalse(refused.allow)
            self.assertIn("then run `git commit` alone", refused.reason)

    def test_otherwise_the_check_decides(self):
        self.assertIsNone(self.decide())


def entry(ref, ruling="WRONG", line=3, words="The validator rejects an empty list", released=False, **fields):
    body = {"ref": ref, "claim": claimcheck.claim_id("README.md", words), "line": line, "words": words,
            "ruling": ruling, "released": released}
    if ruling == "WRONG":
        body.update(failing_case="check([]) returns True", evidence="validator.py:2")
    return {**body, **fields}


def lineage(lid="a" * 16, chain=(), released=None, state="open", file="README.md", places=None):
    claim_id = claimcheck.claim_id("README.md", "The validator rejects an empty list")
    return {"id": lid, "opened": "r1", "file": file, "state": state, "ended": None, "chain": list(chain),
            "places": places if places is not None else [{"start": 0, "end": 36, "claim": claim_id}],
            "released": released}


class Count(unittest.TestCase):
    def test_the_count_is_the_distinct_checks_that_ruled_wrong(self):
        self.assertEqual(claimcheck.count(lineage(chain=[entry("r1"), entry("r2"), entry("r3")])), 3)

    def test_unsure_and_correct_rulings_count_nothing(self):
        self.assertEqual(claimcheck.count(lineage(chain=[entry("r1"), entry("r2", "UNSURE"), entry("r3", "CORRECT")])), 1)

    def test_a_released_entry_counts_nothing(self):
        self.assertEqual(claimcheck.count(lineage(chain=[entry("r1"), entry("r2", released=True)])), 1)

    def test_one_check_counts_once_however_many_of_its_claims_are_wrong(self):
        self.assertEqual(claimcheck.count(lineage(chain=[entry("r1"), entry("r1", line=4, words="another half")])), 1)

    def test_entering_a_ruling_of_a_check_already_in_the_chain_adds_nothing(self):
        found = lineage()
        for _ in range(2):
            claimcheck.enter(found, "r1", claim(), verdict("WRONG"))
        self.assertEqual([e["ref"] for e in found["chain"]], ["r1"])

    def test_the_halves_of_a_split_claim_each_enter_a_ruling_under_the_one_check(self):
        found = lineage()
        other_half = dict(claim(), id="other-half", line=4, quote="it logs the reason")
        for half in (claim(), other_half, claim(), other_half):
            claimcheck.enter(found, "r1", half, verdict("WRONG"))
        self.assertEqual([(e["ref"], e["claim"]) for e in found["chain"]],
                         [("r1", claim()["id"]), ("r1", "other-half")])
        self.assertEqual(claimcheck.count(found), 1)

    def test_an_entry_keeps_where_and_what_the_ruling_was(self):
        found = lineage()
        claimcheck.enter(found, "r1", claim(), verdict("WRONG"))
        self.assertEqual(found["chain"], [{"ref": "r1", "claim": claim()["id"], "line": 3,
                                           "words": "The validator rejects an empty list", "ruling": "WRONG",
                                           "failing_case": "check([]) returns True", "evidence": "validator.py:2",
                                           "released": False}])
        claimcheck.enter(found, "r2", claim(), verdict("UNSURE"))
        self.assertNotIn("failing_case", found["chain"][1])

    def test_a_new_lineage_is_named_by_its_first_words_and_opened_by_the_check(self):
        found = claimcheck.new_lineage(claim(), "r1")
        self.assertEqual((found["id"], found["opened"], found["file"], found["state"], found["chain"]),
                         (claim()["id"], "r1", "README.md", "open", []))
        self.assertEqual(found["released"], None)


class Held(unittest.TestCase):
    def wrong(self, n, **fields):
        return lineage(chain=[entry(f"r{i}") for i in range(n)], **fields)

    def test_a_lineage_is_held_from_its_third_wrong_ruling(self):
        self.assertEqual([claimcheck.held(self.wrong(n)) for n in (0, 1, 2, 3, 4)], [False, False, False, True, True])

    def test_an_ended_lineage_is_never_held(self):
        self.assertFalse(claimcheck.held(self.wrong(3, state="ended")))

    def test_a_lineage_released_at_its_count_is_free_and_one_more_wrong_holds_it_again(self):
        found = self.wrong(3)
        claimcheck.release(found, "2026-10-08T10:00:00Z")
        self.assertEqual(found["released"], {"count": 3, "claims": [claim()["id"]], "at": "2026-10-08T10:00:00Z"})
        self.assertEqual((claimcheck.count(found), claimcheck.held(found)), (3, False))
        claimcheck.enter(found, "r9", claim("The validator refuses an empty list"), verdict("WRONG"))
        self.assertEqual((claimcheck.count(found), claimcheck.held(found)), (4, True))

    def test_the_released_words_stay_free_when_ruled_wrong_again(self):
        found = self.wrong(3)
        claimcheck.release(found, "t")
        claimcheck.enter(found, "r9", claim(), verdict("WRONG"))
        self.assertEqual((claimcheck.count(found), claimcheck.held(found)), (3, False))
        self.assertTrue(found["chain"][-1]["released"])

    def test_release_keeps_the_chain(self):
        found = self.wrong(3)
        claimcheck.release(found, "t")
        self.assertEqual(len(found["chain"]), 3)

    def test_a_release_covers_every_place_the_lineage_holds(self):
        found = self.wrong(3, places=[{"start": 0, "end": 5, "claim": "c1"}, {"start": 9, "end": 12, "claim": "c2"}])
        claimcheck.release(found, "t")
        self.assertEqual(found["released"]["claims"], ["c1", "c2"])


class KeepHolds(unittest.TestCase):
    """A hold the user has not released survives a merge (constitution P2: only the user's release lowers it)."""

    def merged(self, loser, winner):
        gone = dict(loser, state="ended", ended={"by": "merged", "ref": "r9", "into": winner["id"]})
        return [loser, winner], [gone, winner]

    def test_a_held_lineage_absorbed_by_a_released_one_holds_it_again(self):
        loser = lineage("a" * 16, chain=[entry(f"r{i}") for i in range(3)])
        winner = lineage("b" * 16, chain=[entry(f"s{i}") for i in range(4)],
                         released={"count": 4, "claims": [], "at": "t"})
        before, after = self.merged(loser, winner)
        self.assertFalse(claimcheck.held(winner))
        claimcheck.keep_holds(before, after)
        self.assertEqual((winner["released"], claimcheck.held(winner)), (None, True))

    def test_a_released_lineage_absorbed_by_another_leaves_its_release_alone(self):
        loser = lineage("a" * 16, chain=[entry(f"r{i}") for i in range(3)], released={"count": 3, "claims": [], "at": "t"})
        winner = lineage("b" * 16, chain=[entry(f"s{i}") for i in range(4)],
                         released={"count": 4, "claims": [], "at": "t"})
        before, after = self.merged(loser, winner)
        claimcheck.keep_holds(before, after)
        self.assertEqual(winner["released"]["count"], 4)


class WrongClaims(unittest.TestCase):
    def test_wrong_claims_of_released_ids_are_not_listed(self):
        current = check(verdicts={claim()["id"]: verdict("WRONG")})
        self.assertEqual([c["id"] for c in claimcheck.wrong_claims(current)], [claim()["id"]])
        self.assertEqual(claimcheck.wrong_claims(current, {claim()["id"]}), [])


class CommitDecision(unittest.TestCase):
    def decide(self, current, **facts):
        given = {"empty": False, "concluding": False, "staging": False, "alone": True, "held": [], "released": set(),
                 "root": "/w/demo"}
        return claimcheck.commit_decision(current, **{**given, **facts})

    def test_nothing_to_commit_or_a_concluding_commit_is_not_checked(self):
        self.assertTrue(self.decide(None, empty=True).allow)
        self.assertTrue(self.decide(None, concluding=True).allow)

    def test_a_commit_that_stages_or_shares_its_command_is_refused(self):
        for facts in ({"staging": True}, {"alone": False}):
            refused = self.decide(check(), **facts)
            self.assertFalse(refused.allow)
            self.assertIn("then run `git commit` alone", refused.reason)

    def test_no_check_names_the_workflow(self):
        refused = self.decide(None)
        self.assertFalse(refused.allow)
        self.assertIn("Workflow(name='alq-review:claim-check', args={worktree: '/w/demo'})", refused.reason)

    def test_an_unfinished_check_refuses_as_a_failure(self):
        for status in ("reading", "judging"):
            refused = self.decide(check(status=status))
            self.assertFalse(refused.allow)
            self.assertIn("not that a claim is wrong", refused.reason)

    def test_a_wrong_claim_is_handed_back_with_its_case_and_evidence(self):
        refused = self.decide(check(verdicts={claim()["id"]: verdict("WRONG")}))
        self.assertFalse(refused.allow)
        for part in ("README.md:3", "The validator rejects an empty list", "check([]) returns True", "validator.py:2",
                     "contest"):
            self.assertIn(part, refused.reason)

    def test_correct_and_unsure_pass(self):
        for kind in ("CORRECT", "UNSURE"):
            self.assertTrue(self.decide(check(verdicts={claim()["id"]: verdict(kind)})).allow, kind)

    def test_a_held_lineage_asks_the_user_and_shows_its_chain(self):
        held = lineage("a" * 16, chain=[entry("r1"), entry("r2", line=4, words="The validator refuses an empty list"),
                                        entry("r3", line=4, words="Empty lists are rejected", failing_case="check([0])",
                                              evidence="validator.py:1")])
        refused = self.decide(None, held=[held])
        self.assertFalse(refused.allow)
        for part in ("Stop and ask the user",
                     'README.md:3 "The validator rejects an empty list" - WRONG (r1)',
                     'README.md:4 "The validator refuses an empty list" - WRONG (r2)',
                     'README.md:4 "Empty lists are rejected" - WRONG (r3)',
                     "Fails when: check([0])", "Evidence: validator.py:1", f"`unlock claim-{'a' * 16}`"):
            self.assertIn(part, refused.reason)

    def test_the_chain_is_shown_oldest_first_and_only_the_last_failing_case_is(self):
        held = lineage("a" * 16, chain=[entry("r1", failing_case="first case"), entry("r2", failing_case="last case"),
                                        entry("r3", ruling="UNSURE")])
        reason = self.decide(None, held=[held]).reason
        self.assertLess(reason.index("(r1)"), reason.index("(r2)"))
        self.assertLess(reason.index("(r2)"), reason.index("(r3)"))
        self.assertIn("Fails when: last case", reason)
        self.assertNotIn("first case", reason)

    def test_each_held_lineage_is_listed_with_its_own_unlock(self):
        first, second = lineage("a" * 16, chain=[entry("r1")]), lineage("b" * 16, chain=[entry("r2")])
        reason = self.decide(None, held=[first, second]).reason
        self.assertLess(reason.index("unlock claim-" + "a" * 16), reason.index("(r2)"))
        self.assertIn("unlock claim-" + "b" * 16, reason)

    def test_a_released_claims_wrong_ruling_passes(self):
        current = check(verdicts={claim()["id"]: verdict("WRONG")})
        self.assertFalse(self.decide(current).allow)
        self.assertTrue(self.decide(current, released={claim()["id"]}).allow)


class ContestOutcome(unittest.TestCase):
    def contested(self, chain=None):
        found = lineage(chain=chain or [entry("r1")])
        current = check(verdicts={claim()["id"]: verdict("WRONG")})
        current["ref"] = "r1"
        return current, found

    def test_a_rejected_contest_is_a_wrong_ruling_of_its_own(self):
        current, found = self.contested()
        outcome = claimcheck.contest_outcome(current, found, claim()["id"], verdict("WRONG"))
        self.assertEqual((outcome, claimcheck.count(found)), ("rejected", 2))
        self.assertEqual(found["chain"][-1]["ref"], "r1/contest-1")
        self.assertEqual(current["contests"][claim()["id"]], "rejected")

    def test_each_rejected_contest_of_one_claim_in_one_check_counts(self):
        current, found = self.contested()
        for _ in range(2):
            claimcheck.contest_outcome(current, found, claim()["id"], verdict("WRONG"))
        self.assertEqual([e["ref"] for e in found["chain"]], ["r1", "r1/contest-1", "r1/contest-2"])
        self.assertEqual(claimcheck.count(found), 3)

    def test_an_upheld_contest_enters_its_ruling_and_lowers_nothing(self):
        for kind in ("UNSURE", "CORRECT"):
            current, found = self.contested(chain=[entry("r0"), entry("r1")])
            outcome = claimcheck.contest_outcome(current, found, claim()["id"], verdict(kind))
            self.assertEqual((outcome, claimcheck.count(found)), ("upheld", 2), kind)
            self.assertEqual((found["chain"][-1]["ref"], found["chain"][-1]["ruling"]), ("r1/contest-1", kind))
            self.assertEqual(current["verdicts"][claim()["id"]]["verdict"], kind)

    def test_an_upheld_contest_ruled_unsure_keeps_the_claims_place_and_the_lineage_open(self):
        current, found = self.contested()
        claimcheck.contest_outcome(current, found, claim()["id"], verdict("UNSURE"))
        self.assertEqual(([p["claim"] for p in found["places"]], found["state"]), ([claim()["id"]], "open"))

    def test_an_upheld_contest_ruled_correct_takes_the_claims_place_out_and_ends_the_lineage(self):
        current, found = self.contested()
        claimcheck.contest_outcome(current, found, claim()["id"], verdict("CORRECT"))
        self.assertEqual((found["places"], found["state"], found["ended"]["by"]), ([], "ended", "correct"))

    def test_a_contest_of_a_released_claim_counts_nothing(self):
        current, found = self.contested(chain=[entry("r0"), entry("r1")])
        claimcheck.release(found, "t")
        claimcheck.contest_outcome(current, found, claim()["id"], verdict("WRONG"))
        self.assertEqual(claimcheck.count(found), 2)


class Contests(unittest.TestCase):
    def test_a_contest_names_a_wrong_claim_and_gives_evidence(self):
        current = check(verdicts={claim()["id"]: verdict("WRONG")})
        cid = claim()["id"]
        ref = claimcheck.claim_ref(cid)
        self.assertEqual(claimcheck.accept_contest({"claim": ref, "evidence": "see validator.py:2"}, current, located),
                         (cid, []))
        self.assertEqual(claimcheck.accept_contest({"claim": ref, "evidence": "https://docs.example/a"}, current,
                                                   located), (cid, []))
        _, [missing] = claimcheck.accept_contest({"claim": ref, "evidence": "I am sure it rejects"}, current, located)
        self.assertIn("path:line", missing)

    def test_a_contest_refusal_names_what_the_check_holds(self):
        cid = claim()["id"]
        current = check(verdicts={cid: verdict("WRONG")})
        for named in (cid, "nope", None):
            self.assertEqual(claimcheck.accept_contest({"claim": named, "evidence": "validator.py:2"}, current, located),
                             (None, [f"{named!r} is not a claim id of this check; its WRONG claims: "
                                     f'README.md:3 "The validator rejects an empty list" (claim-{cid})']))
        passed = check(verdicts={cid: verdict("CORRECT")})
        self.assertEqual(claimcheck.accept_contest({"claim": f"claim-{cid}", "evidence": "validator.py:2"}, passed,
                                                   located), (None, [f"claim-{cid} is CORRECT, not WRONG"]))
        unjudged = check()
        _, [said] = claimcheck.accept_contest({"claim": f"claim-{cid}", "evidence": "validator.py:2"}, unjudged, located)
        self.assertEqual(said, f"claim-{cid} was not judged, so it has no WRONG verdict to contest")

    def test_a_fetch_goes_only_to_a_cited_host(self):
        hosts = claimcheck.cited_hosts([{"claim": "c", "evidence": "per https://docs.example/a and validator.py:2"}])
        self.assertEqual(hosts, ["docs.example"])
        self.assertTrue(claimcheck.fetch_allowed("https://docs.example/other/page", hosts))
        self.assertFalse(claimcheck.fetch_allowed("https://evil.example/?q=secret", hosts))
        self.assertFalse(claimcheck.fetch_allowed("https://docs.example.evil.example/", hosts))


class VerdictCache(unittest.TestCase):
    def test_only_a_correct_claim_with_no_universal_word_is_cached(self):
        self.assertTrue(claimcheck.cacheable(claim("The validator rejects a list"), verdict("CORRECT")))
        for word in ("every", "only", "all", "exactly", "always", "never"):
            self.assertFalse(claimcheck.cacheable(claim(f"it {word} rejects"), verdict("CORRECT")), word)
        for kind in ("WRONG", "UNSURE"):
            self.assertFalse(claimcheck.cacheable(claim(), verdict(kind)), kind)

    def test_a_cached_verdict_holds_while_its_cited_files_are_unchanged(self):
        entry = {"category": "K1", "evidence_blobs": {"validator.py": "b1"}, "verdict": verdict("CORRECT")}
        self.assertTrue(claimcheck.still_correct(entry, claim(), {"validator.py": "b1"}.get))
        self.assertFalse(claimcheck.still_correct(entry, claim(), {"validator.py": "b2"}.get))
        self.assertFalse(claimcheck.still_correct(entry, claim(), {}.get))
        self.assertFalse(claimcheck.still_correct(entry, claim(category="K9"), {"validator.py": "b1"}.get))
        self.assertEqual(claimcheck.cited_paths(verdict("CORRECT"), located), {"validator.py"})


if __name__ == "__main__":
    unittest.main()
