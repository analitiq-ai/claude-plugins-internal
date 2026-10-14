"""The decision check: its pure rules (decisions.py) on adrkit's captured answer, its setting and refusal helpers
(hookio)."""
import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path
from unittest import mock

import helpers  # noqa: F401  puts the plugin's scripts on sys.path
from paths import PLUGIN

import adrkit
import decisions
import hookio

HERE = Path(__file__).resolve().parent
CAPTURED = HERE / "fixtures" / "adrkit" / "check.json"
# The call the capture was made with, from this folder: the corpus sits outside any docs/adr path, so it is not one of
# this repo's own corpora.
CAPTURE_CALL = ["check", "--dir", "fixtures/adrkit/corpus", "--json", "--", "src/a.py", "lib/b.py", "dup/c.py",
                "fixtures/adrkit/corpus/0006-same-id.md", "fixtures/adrkit/corpus/0007-no-frontmatter.md"]
REPO = decisions.Corpus("dev/x/docs/adr", "/r/dev/x/docs/adr", org=False)
ORG = decisions.Corpus("org (/org/docs/adr)", "/org/docs/adr", org=True)


def needs_adr(test: unittest.TestCase) -> str:
    """The `adr` command: a test that needs it skips without it, except in CI, where it fails."""
    found = shutil.which("adr")
    if found is None:
        if os.environ.get("CI"):
            test.fail(f"CI runs without adr; it must install it: {adrkit.INSTALL}")
        test.skipTest("adr is not installed here")
    return found


def captured() -> decisions.Answer:
    return adrkit.parse(json.loads(CAPTURED.read_text()))


class DecisionCheckSetting(unittest.TestCase):
    def setUp(self):
        patched = mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": self.id()})
        patched.start()
        self.addCleanup(patched.stop)

    def test_the_decision_check_has_its_own_setting_shipped_enforce(self):
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_DECISION_CHECKS": "log", "ALQ_REVIEW_MODE": "enforce"}):
            self.assertEqual((hookio.decision_checks_mode(), hookio.mode()), ("log", "enforce"))
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_DECISION_CHECKS": ""}):
            self.assertEqual(hookio.decision_checks_mode(), "enforce")

    def test_the_file_limit_is_shipped_at_50(self):
        self.assertEqual(hookio.max_review_files(), 50)

    def test_a_file_limit_that_is_not_a_positive_whole_number_is_an_error(self):
        for bad in (0, -1, "50", 2.5, True):
            with self.subTest(bad=bad), mock.patch("config.load", return_value={"max_review_files": bad}):
                with self.assertRaisesRegex(ValueError, "max_review_files"):
                    hookio.max_review_files()

    def outcome(self, helper, plugin, decisions):
        with mock.patch.object(hookio, "record") as recorded, \
                mock.patch.dict(os.environ, {"ALQ_REVIEW_MODE": plugin, "ALQ_REVIEW_DECISION_CHECKS": decisions}):
            refused = helper({}, "launch", "the check could not run")
        decision = refused and refused["hookSpecificOutput"]["permissionDecision"]
        return decision, recorded.call_args.args[2]

    def test_a_broken_record_blocks_only_when_the_plugin_and_the_decision_check_both_enforce(self):
        cases = {("enforce", "enforce"): ("deny", "deny"), ("log", "enforce"): (None, "would_deny"),
                 ("enforce", "log"): (None, "would_deny"), ("log", "log"): (None, "would_deny")}
        for (plugin, decisions), expected in cases.items():
            with self.subTest(plugin=plugin, decisions=decisions):
                self.assertEqual(self.outcome(hookio.refuse_decision, plugin, decisions), expected)

    def test_a_check_that_could_not_run_blocks_whenever_the_decision_check_enforces(self):
        cases = {("enforce", "enforce"): ("deny", "deny"), ("log", "enforce"): ("deny", "deny"),
                 ("enforce", "log"): (None, "would_deny"), ("log", "log"): (None, "would_deny")}
        for (plugin, decisions), expected in cases.items():
            with self.subTest(plugin=plugin, decisions=decisions):
                self.assertEqual(self.outcome(hookio.block_decision, plugin, decisions), expected)


class Capture(unittest.TestCase):
    def test_the_captured_answer_is_what_adrkit_answers_today(self):
        done = subprocess.run([needs_adr(self), *CAPTURE_CALL], cwd=HERE, capture_output=True, text=True)
        self.assertEqual((done.returncode, json.loads(done.stdout)), (1, json.loads(CAPTURED.read_text())))


class Judge(unittest.TestCase):
    def test_accepted_records_govern_and_neither_a_draft_nor_a_broken_record_does(self):
        judged = decisions.judge(REPO, captured())
        self.assertEqual(judged.governing, ({"corpus": REPO.label, "id": "0001", "title": "Accepted on src"},
                                            {"corpus": REPO.label, "id": "0005", "title": "Path and entity"}))

    def test_a_matcher_adrkit_cannot_evaluate_in_one_repo_is_a_notice_naming_record_corpus_and_matcher(self):
        notices = decisions.judge(REPO, captured()).notices
        self.assertEqual([(n["corpus"], n["id"], n["matcher"]) for n in notices],
                         [(REPO.label, "0004", 'affects.path "src/**"'), (REPO.label, "0003", 'affects.package "core"'),
                          (REPO.label, "0005", 'affects.entity "billing"')])
        self.assertIn('repo "acme/other"', notices[0]["reason"])

    def test_a_changed_record_adrkit_fails_on_is_broken_named_by_its_file_and_its_id_when_adrkit_gives_one(self):
        broken = decisions.judge(REPO, captured()).broken
        self.assertEqual([(b["corpus"], b["file"], b.get("id"), b["rule"]) for b in broken],
                         [(REPO.label, "fixtures/adrkit/corpus/0007-no-frontmatter.md", None, "frontmatter-fence"),
                          (REPO.label, "fixtures/adrkit/corpus/0006-same-id.md", "0006", "unique-id")])
        self.assertNotIn("id", broken[0])
        self.assertIn("multiple records", broken[1]["message"])

    def test_every_other_finding_is_ignored(self):
        answer = captured()
        quiet = decisions.Answer(True, answer.governing, (
            decisions.Finding("corpus-file-skipped", "warn", "skipped notes.md", path="notes.md"),
            decisions.Finding("affects-bad-pattern", "warn", "bad", id="0001")))
        judged = decisions.judge(REPO, quiet)
        self.assertEqual((judged.notices, judged.broken), ((), ()))
        self.assertEqual(len(judged.governing), 4)

    def test_a_capped_marker_scan_means_the_corpus_was_not_checked(self):
        for rule in ("marker-scan-capped", "marker-declarations-capped"):
            with self.subTest(rule=rule):
                answer = captured()
                capped = decisions.Answer(answer.ok, answer.governing,
                                          answer.findings + (decisions.Finding(rule, "warn", "the cap was reached"),))
                outcome = decisions.judge(REPO, capped)
                self.assertEqual((outcome.corpus, outcome.cause), (REPO, decisions.COULD_NOT_RUN))
                self.assertIn(REPO.label, outcome.reason)
                self.assertIn(rule, outcome.reason)
                self.assertTrue(outcome.reason.endswith("Next step: split the change."), outcome.reason)


class Result(unittest.TestCase):
    def test_it_tells_nothing_governs_from_a_corpus_not_checked(self):
        none_found = decisions.result([], "unset")
        self.assertEqual(none_found, {"corpora": [], "governing": [], "notices": [], "broken": [], "not_checked": [],
                                      "org_corpus": "unset"})
        judged = decisions.Judged(REPO, (), (), ())
        unread = decisions.NotChecked(ORG, decisions.COULD_NOT_RUN, "it failed. Next step: x.")
        both = decisions.result([judged, unread], ORG.label)
        self.assertEqual((both["corpora"], both["governing"], both["org_corpus"]), ([REPO.label], [], ORG.label))
        self.assertEqual(both["not_checked"],
                         [{"corpus": ORG.label, "cause": "could not run", "reason": "it failed. Next step: x."}])

    def test_the_same_id_in_two_corpora_is_two_records(self):
        repo = decisions.Judged(REPO, ({"corpus": REPO.label, "id": "0001", "title": "a"},), (), ())
        org = decisions.Judged(ORG, ({"corpus": ORG.label, "id": "0001", "title": "b"},), (), ())
        self.assertEqual([(g["corpus"], g["id"]) for g in decisions.result([repo, org], ORG.label)["governing"]],
                         [(REPO.label, "0001"), (ORG.label, "0001")])


class Refusals(unittest.TestCase):
    def test_too_big_names_the_count_the_limit_and_the_step_for_the_round_kind(self):
        full, delta = decisions.too_big(51, 50, "full"), decisions.too_big(51, 50, "delta")
        for reason in (full, delta):
            self.assertIn("decision check", reason)
            self.assertIn("51 files", reason)
            self.assertIn("max_review_files is 50", reason)
        self.assertTrue(full.endswith("Next step: split the PR."), full)
        self.assertTrue(delta.endswith("Next step: commit in smaller steps and launch after each."), delta)

    def test_a_corpus_not_checked_is_refused_with_each_corpus_and_its_reason(self):
        outcomes = [decisions.Judged(REPO, (), (), ()),
                    decisions.NotChecked(ORG, decisions.COULD_NOT_RUN, "adr failed. Next step: y."),
                    decisions.NotChecked(REPO, decisions.TOO_BIG, "too many. Next step: z.")]
        reason = decisions.not_checked_refusal(outcomes)
        self.assertIn("decision check could not run", reason)
        self.assertIn(f"- {ORG.label}: adr failed. Next step: y.", reason)
        self.assertNotIn("too many", reason)
        self.assertIsNone(decisions.not_checked_refusal([decisions.Judged(REPO, (), (), ())]))

    def test_a_broken_record_is_refused_with_a_fix_that_works_in_its_corpus(self):
        repo = decisions.judge(REPO, captured())
        org = decisions.judge(ORG, captured())
        reason = decisions.broken_refusal([repo])
        self.assertIn("decision check failed", reason)
        self.assertIn(f"{REPO.label} fixtures/adrkit/corpus/0006-same-id.md (id 0006)", reason)
        self.assertIn("is used by multiple records", reason)
        self.assertIn("correct the record in this repo, commit and launch again", reason)
        org_reason = decisions.broken_refusal([org])
        self.assertIn(ORG.label, org_reason)
        self.assertNotIn("commit", org_reason)
        self.assertIsNone(decisions.broken_refusal([decisions.Judged(REPO, (), (), ())]))

    def test_a_call_past_the_deadline_names_the_deadline_and_each_steps_seconds(self):
        outcome = decisions.timed_out(REPO, 55, {"gh calls": 1.04, "review-base fetch": 2.5,
                                                 f"adr check of {REPO.label}": 51.46})
        self.assertEqual(outcome.cause, decisions.COULD_NOT_RUN)
        self.assertIn("55 s", outcome.reason)
        self.assertIn(f"gh calls 1.0 s, review-base fetch 2.5 s, adr check of {REPO.label} 51.5 s", outcome.reason)
        self.assertIn(f"Next step: adr check of {REPO.label} spent the most", outcome.reason)


class Readme(unittest.TestCase):
    def test_it_gives_the_install_step_of_the_adrkit_version_the_plugin_is_built_for(self):
        self.assertIn(f"`{adrkit.INSTALL}`", (PLUGIN / "README.md").read_text())


if __name__ == "__main__":
    unittest.main()
