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

    @staticmethod
    def held(current):
        holds = []
        for _ in range(claimcheck.REFUSALS_BEFORE_USER):
            holds = claimcheck.count_refusals(holds, current)
        return holds

    def test_a_held_hunk_asks_the_user_and_shows_each_claim_with_its_ruling(self):
        logs = claim("and it logs the reason", line=4)
        logged = verdict("WRONG", failing_case="nothing is logged",
                         assertions=[{"text": "it logs", "confirmed": False, "evidence": "validator.py:1"}])
        current = check(claims=[claim(), logs], verdicts={claim()["id"]: verdict("WRONG"), logs["id"]: logged})
        refused = self.decide(None, held=self.held(current))
        self.assertFalse(refused.allow)
        for part in ("Stop and ask the user", "README.md (old lines 3-3), refused 3 times:",
                     f'- README.md:3 "The validator rejects an empty list" (claim-{claim()["id"]}). Fails when: '
                     f'check([]) returns True. Evidence: validator.py:2. Release: `unlock claim-{claim()["id"]}`',
                     f'- README.md:4 "and it logs the reason" (claim-{logs["id"]}). Fails when: nothing is logged. '
                     f'Evidence: validator.py:1. Release: `unlock claim-{logs["id"]}`'):
            self.assertIn(part, refused.reason)

    def test_each_held_hunk_shows_its_own_count(self):
        far = claim("Other text", line=6, hid="h2")
        current = check(claims=[claim(), far], verdicts={c["id"]: verdict("WRONG") for c in (claim(), far)},
                        hunks=[hunk(), hunk("h2", old=(6, 1), new=(6, 1), patch_id="p2")])
        again = check(verdicts={claim()["id"]: verdict("WRONG")}, hunks=[hunk(patch_id="p3")])
        reason = self.decide(None, held=claimcheck.count_refusals(self.held(current), again)).reason
        self.assertIn("README.md (old lines 3-3), refused 4 times:", reason)
        self.assertIn("README.md (old lines 6-6), refused 3 times:", reason)

    def test_a_held_claim_reads_as_the_wrong_refusal_names_it(self):
        current = check(verdicts={claim()["id"]: verdict("WRONG")})
        [line] = [l for l in self.decide(current).reason.split("\n") if l.startswith("- ")]
        self.assertIn(line, self.decide(None, held=self.held(current)).reason)

    def test_each_held_claim_is_listed_under_its_own_hunk(self):
        far = claim("Other text", line=6, hid="h2")
        current = check(claims=[claim(), far], verdicts={c["id"]: verdict("WRONG") for c in (claim(), far)},
                        hunks=[hunk(), hunk("h2", old=(6, 1), new=(6, 1), patch_id="p2")])
        reason = self.decide(None, held=self.held(current)).reason
        first, second = reason.index("README.md (old lines 3-3)"), reason.index("README.md (old lines 6-6)")
        self.assertLess(first, reason.index(f"claim-{claim()['id']}"))
        self.assertLess(reason.index(f"claim-{claim()['id']}"), second)
        self.assertLess(second, reason.index(f"claim-{far['id']}"))

    def test_a_held_new_file_is_named_as_new(self):
        new = check(verdicts={claim()["id"]: verdict("WRONG")}, hunks=[hunk(old=(0, 0), new=(1, 6))])
        self.assertIn("README.md (new file)", self.decide(None, held=self.held(new)).reason)

    def test_a_released_hunks_wrong_claims_pass(self):
        current = check(verdicts={claim()["id"]: verdict("WRONG")})
        self.assertTrue(self.decide(current, released={"h1"}).allow)


class Holds(unittest.TestCase):
    def test_a_completed_wrong_check_counts_once_per_hunk(self):
        two = [claim(), claim("and it logs the reason", line=4)]
        current = check(claims=two, verdicts={c["id"]: verdict("WRONG") for c in two})
        holds = claimcheck.count_refusals([], current)
        self.assertEqual([(h["file"], h["refusals"]) for h in holds], [("README.md", 1)])
        self.assertEqual([c["id"] for c in holds[0]["claims"]], [c["id"] for c in two])
        self.assertEqual(holds[0]["claims"][1], {"id": two[1]["id"], "file": "README.md", "line": 4,
                                                 "quote": "and it logs the reason",
                                                 "failing_case": "check([]) returns True", "evidence": "validator.py:2"})

    def test_overlapping_or_touching_hunks_continue_a_hold_and_others_do_not(self):
        holds = claimcheck.count_refusals([], check(verdicts={claim()["id"]: verdict("WRONG")}))
        reworded = claim("The validator refuses an empty list")
        moved = check(claims=[reworded], verdicts={reworded["id"]: verdict("WRONG")},
                      hunks=[hunk(old=(4, 2), new=(3, 3), patch_id="p2")])
        holds = claimcheck.count_refusals(holds, moved)
        self.assertEqual([h["refusals"] for h in holds], [2])
        far = check(verdicts={claim()["id"]: verdict("WRONG")}, hunks=[hunk(old=(20, 1), new=(20, 1))])
        self.assertEqual(sorted(h["refusals"] for h in claimcheck.count_refusals(holds, far)), [1, 2])

    def test_a_new_file_is_one_hold(self):
        new = check(verdicts={claim()["id"]: verdict("WRONG")}, hunks=[hunk(old=(0, 0), new=(1, 6))])
        holds = claimcheck.count_refusals(claimcheck.count_refusals([], new), new)
        self.assertEqual([h["refusals"] for h in holds], [2])

    def test_states_open_held_released(self):
        h = hunk()
        hold = {"file": "README.md", "old_start": 3, "old_count": 1, "refusals": 2, "claims": [], "patch_id": "p1",
                "released_patch_id": None}
        self.assertEqual(claimcheck.hunk_state([hold], h), "open")
        hold["refusals"] = 3
        self.assertEqual(claimcheck.hunk_state([hold], h), "held")
        claimcheck.release(hold)
        self.assertEqual(claimcheck.hunk_state([hold], h), "released")
        self.assertEqual(claimcheck.hunk_state([hold], dict(h, patch_id="p2")), "open")
        current = check(verdicts={claim()["id"]: verdict("WRONG")}, hunks=[dict(h, patch_id="p2")])
        [restarted] = claimcheck.count_refusals([hold], current)
        self.assertEqual((restarted["refusals"], restarted["released_patch_id"]), (1, None))

    def test_a_released_hunk_counts_nothing_while_its_words_stand(self):
        hold = {"file": "README.md", "old_start": 3, "old_count": 1, "refusals": 3, "claims": [], "patch_id": "p1",
                "released_patch_id": "p1"}
        [same] = claimcheck.count_refusals([hold], check(verdicts={claim()["id"]: verdict("WRONG")}))
        self.assertEqual(same["refusals"], 3)

    def test_a_contest_outcome(self):
        current = check(verdicts={claim()["id"]: verdict("WRONG")})
        holds = claimcheck.count_refusals([], current)
        rejected = claimcheck.contest_outcome(current, holds, claim()["id"], verdict("WRONG"))
        self.assertEqual((rejected, holds[0]["refusals"]), ("rejected", 2))
        upheld = claimcheck.contest_outcome(current, holds, claim()["id"], verdict("CORRECT"))
        self.assertEqual((upheld, holds[0]["refusals"]), ("upheld", 2))
        self.assertEqual(current["verdicts"][claim()["id"]]["verdict"], "CORRECT")

    def test_a_hold_names_the_wrong_claims_of_every_hunk_of_one_check_it_covers(self):
        wide = check(verdicts={claim()["id"]: verdict("WRONG")}, hunks=[hunk(old=(3, 4), new=(3, 4))])
        far = claim("Other text", line=6, hid="h2")
        both = check(claims=[claim(), far], verdicts={c["id"]: verdict("WRONG") for c in (claim(), far)},
                     hunks=[hunk(patch_id="p2"), hunk("h2", old=(6, 1), new=(6, 1), patch_id="p3")])
        [hold] = claimcheck.count_refusals(claimcheck.count_refusals([], wide), both)
        self.assertEqual([c["id"] for c in hold["claims"]], [claim()["id"], far["id"]])
        claimcheck.contest_outcome(both, [hold], claim()["id"], verdict("WRONG"))
        self.assertEqual([c["id"] for c in hold["claims"]], [claim()["id"], far["id"]])

    def test_an_upheld_contest_drops_its_claim_from_the_hold(self):
        logs = claim("and it logs the reason", line=4)
        current = check(claims=[claim(), logs], verdicts={c["id"]: verdict("WRONG") for c in (claim(), logs)})
        holds = claimcheck.count_refusals([], current)
        claimcheck.contest_outcome(current, holds, claim()["id"], verdict("CORRECT"))
        self.assertEqual([c["id"] for c in holds[0]["claims"]], [logs["id"]])

    def test_a_rejected_contest_keeps_the_hunks_other_wrong_claims_and_shows_the_fresh_ruling(self):
        logs = claim("and it logs the reason", line=4)
        current = check(claims=[claim(), logs], verdicts={c["id"]: verdict("WRONG") for c in (claim(), logs)})
        holds = claimcheck.count_refusals([], current)
        claimcheck.contest_outcome(current, holds, claim()["id"], verdict("WRONG", failing_case="check([0]) is True"))
        self.assertEqual([(c["quote"], c["failing_case"]) for c in holds[0]["claims"]],
                         [("The validator rejects an empty list", "check([0]) is True"),
                          ("and it logs the reason", "check([]) returns True")])


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
