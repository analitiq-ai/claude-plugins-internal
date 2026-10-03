"""The shim check as Claude Code drives it: hook payloads through the gate, its setting, and the workflow under node,
with recorded sweeper and judge outputs standing for the agents and a stand-in for Jev."""
import json
import os
import shutil
import subprocess
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from unittest import mock

from test_claim_gate import HARNESS, ClaimGate
from test_worktree_facts import git

import hookio
import ledger
import jev
import shimcheck

LAUNCH = "alq-review:shim-check"
FIXED = "".join(f"b{i}\n" for i in range(3)) + "b3 checked\n" + "".join(f"b{i}\n" for i in range(4, 20))
SITE = {"file": "c.py", "line": 2, "function": "load", "does": "reads b unchecked"}
SWEEPER, SITE_JUDGE = "alq-review:shim-sweeper", "alq-review:shim-site-judge"
WORKFLOW = Path(__file__).resolve().parent.parent / "workflows" / "shim-check.js"


class Jev(BaseHTTPRequestHandler):
    """Stands in for OpenRouter: answers each question asked from `answers`, or fails with `status`."""
    answers, status, seen, failure = {}, 200, [], {"error": {"message": "down"}}

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
        Jev.seen.append(body)
        reply = {"answers": {q: {"choice": Jev.answers[q]} for q in body["questions"]}, "usage": {"cost": 0.001}}
        self.send_response(Jev.status)
        self.end_headers()
        self.wfile.write(json.dumps(reply if Jev.status == 200 else Jev.failure).encode())

    def log_message(self, *args):
        pass


class ShimGate(ClaimGate):
    @classmethod
    def setUpClass(cls):
        cls.jev = HTTPServer(("127.0.0.1", 0), Jev)
        threading.Thread(target=cls.jev.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.jev.shutdown()

    def setUp(self):
        super().setUp()
        Jev.answers, Jev.status, Jev.seen = {"kind": "fix", "level": "cause", "coverage": "all"}, 200, []
        Jev.failure = {"error": {"message": "down"}}
        key = Path(self.tmp.name) / "jev-key"
        key.write_text("sk-test\n")
        self.env.update(ALQ_REVIEW_SHIM_CHECKS="enforce", JEV_KEY_FILE=str(key),
                        JEV_ENDPOINT=f"http://127.0.0.1:{self.jev.server_port}/")

    def shim_launch(self, **args):
        return self.launch(LAUNCH, **args)

    def sweep(self, args, same=(), callers=(), agent_id="s1"):
        body = {"check_ref": args["check_ref"], "same_operation": list(same), "callers": list(callers)}
        return self.output(SWEEPER, body, agent_id=agent_id)

    def snapshots(self):
        return sorted((self.root / ".claude" / "worktrees").glob("shim-*"))

    def gate_log(self):
        return [json.loads(line) for line in (self.state_dir / "gate.log").read_text().splitlines()]

    def labelled(self, files):
        """Stage `files` (name -> (text, label)) and let the claim check read them, finding no claim."""
        for name, (text, _) in files.items():
            self.stage(name, text)
        _, args = self.check_launch()
        if args["readers"]:  # a hunk read before keeps its label
            self.read(args, {name: (label, []) for name, (_, label) in files.items()})
        return git(self.root, "write-tree")

    def shims(self):
        patched = mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)})
        patched.start()
        self.addCleanup(patched.stop)
        return ledger.open_shims("acme/demo")

    def record(self, tree, **fields):
        """A shim check of `tree` as the gate would have stored it."""
        check = {"ref": shimcheck.check_ref("acme/demo", tree), "tree": tree, "head": git(self.root, "rev-parse", "HEAD"),
                 "branch": git(self.root, "branch", "--show-current"), "chain": None, "mode": "sweep",
                 "status": "complete", **fields}
        with self.shims() as shims:
            shims.save_check(check)
        return check

    def chain(self, **fields):
        chain = {"id": "c" * 16, "branch": git(self.root, "branch", "--show-current"),
                 "head": git(self.root, "rev-parse", "HEAD"), "count": 1, "members": [], "state": "open",
                 "ranges": [{"file": "b.py", "old_start": 4, "old_count": 1}], "seen": {}, **fields}
        with self.shims() as shims:
            shims.save_chain(chain)
        return chain


class ShimCommit(ShimGate):
    def test_a_command_that_stages_is_refused_before_anything_else(self):
        self.labelled({"b.py": (FIXED, "CODE")})
        refused = self.git_commit(f"git -C {self.root} commit -qam change")
        self.assertEqual(self.decision(refused), "deny")
        self.assertIn("`git commit` alone", self.reason(refused))

    def test_a_hunk_with_no_label_names_the_claim_check(self):
        self.stage("b.py", FIXED)
        with mock.patch.dict(self.env, {"ALQ_REVIEW_CLAIM_CHECKS": "log"}):
            refused = self.git_commit()
        self.assertEqual(self.decision(refused), "deny")
        self.assertIn("alq-review:claim-check", self.reason(refused))
        self.assertRegex(self.reason(refused), r"override shim-[0-9a-f]{12}\b")

    def test_all_prose_commits_unchecked(self):
        self.labelled({"b.py": (FIXED, "PROSE")})
        self.assertNotEqual(self.decision(self.git_commit()), "deny")

    def test_an_unchecked_fix_names_the_launch_and_the_override(self):
        tree = self.labelled({"b.py": (FIXED, "CODE")})
        refused = self.git_commit()
        self.assertEqual(self.decision(refused), "deny")
        self.assertIn(f"Workflow(name='{LAUNCH}', args={{worktree: '{self.root}'}})", self.reason(refused))
        self.assertTrue(self.reason(refused).rstrip().endswith(f"override shim-{tree[:12]}`."), self.reason(refused))

    def test_a_running_or_failed_check_refuses_naming_the_relaunch(self):
        tree = self.labelled({"b.py": (FIXED, "CODE")})
        for status, said in (("sweeping", "running"), ("judging", "running"),
                             ("failed", "The check failed, not the fix: Jev timed out")):
            self.record(tree, status=status, reason="Jev timed out")
            refused = self.git_commit()
            self.assertEqual(self.decision(refused), "deny", status)
            self.assertIn(said, self.reason(refused))
            self.assertIn(f"Workflow(name='{LAUNCH}'", self.reason(refused))

    def test_a_patch_lists_every_site_marked_touched_or_not(self):
        tree = self.labelled({"b.py": (FIXED, "CODE")})
        touched = {"file": "b.py", "line": 4, "function": "b3", "does": "reads b unchecked"}
        self.record(tree, verdict="patch", kind="fix", level="cause", coverage="edited_only",
                    same_operation=[touched, SITE], callers=[])
        self.chain(count=2)
        refused = self.git_commit()
        self.assertEqual(self.decision(refused), "deny")
        reason = self.reason(refused)
        for part in ("cause", "edited_only", f"{shimcheck.site_id('b.py', 'b3')} b.py:4 b3 — reads b unchecked (touched)",
                     f"{shimcheck.site_id('c.py', 'load')} c.py:2 load — reads b unchecked (not touched)",
                     "refusal 2 of this bug", "override shim-" + "c" * 16):
            self.assertIn(part, reason)

    def test_a_complete_check_commits(self):
        tree = self.labelled({"b.py": (FIXED, "CODE")})
        self.record(tree, verdict="complete", kind="fix", level="cause", coverage="all", same_operation=[], callers=[])
        self.assertNotEqual(self.decision(self.git_commit()), "deny")

    def test_an_overridden_bug_commits_unchecked(self):
        self.labelled({"b.py": (FIXED, "CODE")})
        self.chain(state="overridden")
        self.assertNotEqual(self.decision(self.git_commit()), "deny")

    def test_under_log_a_patch_commits_and_is_recorded(self):
        tree = self.labelled({"b.py": (FIXED, "CODE")})
        self.record(tree, verdict="patch", kind="fix", level="symptom", coverage="all", same_operation=[SITE],
                    callers=[])
        self.env["ALQ_REVIEW_SHIM_CHECKS"] = "log"
        self.assertNotEqual(self.decision(self.git_commit()), "deny")
        self.assertIn(("shim-commit", "would_deny"), [(e["action"], e["decision"]) for e in self.gate_log()])


class ShimCheckSetting(unittest.TestCase):
    def setUp(self):
        patched = mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": self.id()})
        patched.start()
        self.addCleanup(patched.stop)

    def test_the_shim_check_has_its_own_setting(self):
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_SHIM_CHECKS": "log", "ALQ_REVIEW_CLAIM_CHECKS": "enforce",
                                          "ALQ_REVIEW_MODE": "enforce"}):
            self.assertEqual((hookio.shim_checks_mode(), hookio.claim_checks_mode(), hookio.mode()),
                             ("log", "enforce", "enforce"))
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_SHIM_CHECKS": ""}):
            self.assertEqual(hookio.shim_checks_mode(), "enforce")

    def test_a_refusal_blocks_under_enforce_and_is_only_recorded_under_log(self):
        with mock.patch.object(hookio, "record") as recorded:
            with mock.patch.dict(os.environ, {"ALQ_REVIEW_SHIM_CHECKS": "enforce", "ALQ_REVIEW_MODE": "enforce"}):
                refused = hookio.refuse_shim({}, "shim-commit", "a site is left")
            self.assertEqual(refused["hookSpecificOutput"]["permissionDecision"], "deny")
            with mock.patch.dict(os.environ, {"ALQ_REVIEW_SHIM_CHECKS": "log"}):
                self.assertIsNone(hookio.refuse_shim({}, "shim-commit", "a site is left"))
            self.assertEqual([c.args[2] for c in recorded.call_args_list], ["deny", "would_deny"])



class ShimLaunch(ShimGate):
    def test_the_launch_needs_an_absolute_checkout(self):
        out = self.hook("PreToolUse", "Workflow", {"name": LAUNCH, "args": {"worktree": "demo"}})
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("absolute path", self.reason(out))

    def test_unstaged_changes_or_nothing_staged_refuse_the_launch(self):
        out, _ = self.shim_launch()
        self.assertIn("Nothing is staged", self.reason(out))
        self.labelled({"b.py": (FIXED, "CODE")})
        (self.root / "b.py").write_text("changed again\n")
        out, _ = self.shim_launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("b.py", self.reason(out))

    def test_a_hunk_with_no_label_refuses_the_launch(self):
        self.stage("b.py", FIXED)
        out, _ = self.shim_launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("alq-review:claim-check", self.reason(out))
        self.assertEqual(Jev.seen, [])

    def test_all_prose_is_complete_with_no_question_and_no_sweep(self):
        tree = self.labelled({"b.py": (FIXED, "PROSE")})
        out, args = self.shim_launch()
        self.assertEqual(self.decision(out), "allow")
        self.assertEqual((args["mode"], args["sweepers"]), ("none", []))
        with self.shims() as shims:
            self.assertEqual(shims.check(tree)["status"], "complete")
        self.assertEqual(Jev.seen, [])

    def test_a_mixed_hunk_is_swept_with_the_code(self):
        tree = self.labelled({"b.py": (FIXED, "MIXED"), "README.md": ("Notes.\n", "PROSE")})
        out, args = self.shim_launch()
        self.assertEqual((self.decision(out), args["mode"]), ("allow", "sweep"))
        [asked] = Jev.seen
        self.assertIn("b.py", asked["state"])
        self.assertNotIn("README.md", asked["state"])
        with self.shims() as shims:
            self.assertEqual([h["file"] for h in shims.check(tree)["hunks"]], ["b.py"])

    def test_a_change_that_fixes_nothing_is_complete_with_no_sweep(self):
        Jev.answers["kind"] = "not_fix"
        tree = self.labelled({"b.py": (FIXED, "CODE")})
        out, args = self.shim_launch()
        self.assertEqual((args["mode"], args["sweepers"]), ("not_fix", []))
        with self.shims() as shims:
            check = shims.check(tree)
        self.assertEqual((check["status"], check["kind"], check["verdict"]), ("complete", "not_fix", "complete"))
        self.assertEqual(self.snapshots(), [])
        self.assertEqual(len(Jev.seen), jev.KIND_ASKS)
        for asked in Jev.seen:
            self.assertEqual(list(asked["questions"]), ["kind"])
            self.assertIn("+b3 checked", asked["state"])
        self.assertNotEqual(self.decision(self.git_commit()), "deny")

    def test_a_fix_is_swept_from_a_snapshot_of_head(self):
        tree = self.labelled({"b.py": (FIXED, "CODE")})
        out, args = self.shim_launch()
        self.assertEqual(self.decision(out), "allow")
        with self.shims() as shims:
            check = shims.check(tree)
        self.assertEqual((check["status"], check["kind"], check["mode"]), ("sweeping", "fix", "sweep"))
        self.assertEqual(check["expected"], ["standard"])
        [folder] = self.snapshots()
        self.assertEqual(check["snapshot"], str(folder))
        self.assertTrue((folder / "b.py").is_file())
        self.assertEqual(args["check_ref"], check["ref"])
        self.assertEqual(args["mode"], "sweep")
        [sweeper] = args["sweepers"]
        self.assertEqual(sweeper["type"], SWEEPER)
        self.assertIn(str(folder), sweeper["prompt"])
        self.assertIn("+b3 checked", sweeper["prompt"])
        self.assertEqual(sweeper["schema"]["properties"]["check_ref"], {"enum": [check["ref"]]})

    def test_a_failed_question_leaves_the_check_failed_with_no_answers(self):
        Jev.status = 500
        tree = self.labelled({"b.py": (FIXED, "CODE")})
        out, _ = self.shim_launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("The check failed, not the fix", self.reason(out))
        with self.shims() as shims:
            check = shims.check(tree)
        self.assertEqual((check["status"], check.get("kind")), ("failed", None))
        self.assertIn("The check failed, not the fix", self.reason(self.git_commit()))

    def test_a_tree_already_complete_is_not_checked_again(self):
        Jev.answers["kind"] = "not_fix"
        self.labelled({"b.py": (FIXED, "CODE")})
        self.shim_launch()
        out, _ = self.shim_launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("already checked", self.reason(out))



class Staged(ShimGate):
    """A fix staged in b.py, with c.py in HEAD for a sweeper to list."""

    def setUp(self):
        super().setUp()
        self.commit("c.py", "def load():\n    return open('b').read()\n", "feat: c")
        self.tree = self.labelled({"b.py": (FIXED, "CODE")})


class ShimSweep(Staged):

    def test_a_list_naming_what_head_does_not_hold_goes_back_to_the_sweeper(self):
        _, args = self.shim_launch()
        out = self.sweep(args, [dict(SITE, file="gone.py"), dict(SITE, line=40)])
        self.assertEqual(self.decision(out), "deny")
        for part in ("gone.py is not a file of HEAD", "c.py has lines 1-2"):
            self.assertIn(part, self.reason(out))
        with self.shims() as shims:
            self.assertEqual(shims.check(self.tree)["status"], "sweeping")

    def test_the_last_list_is_judged_and_the_snapshot_given_back(self):
        Jev.answers.update(level="cause", coverage="edited_only")
        _, args = self.shim_launch()
        self.assertNotEqual(self.decision(self.sweep(args, [SITE])), "deny")
        with self.shims() as shims:
            check = shims.check(self.tree)
        self.assertEqual((check["status"], check["verdict"], check["level"], check["coverage"]),
                         ("complete", "patch", "cause", "edited_only"))
        self.assertEqual(check["same_operation"], [SITE])
        self.assertEqual(self.snapshots(), [])
        asked = Jev.seen[-1]
        self.assertEqual(sorted(asked["questions"]), ["coverage", "level"])
        self.assertIn("SAME OPERATION\n- c.py:2 load — reads b unchecked", asked["state"])
        self.assertIn(f"{shimcheck.site_id('c.py', 'load')} c.py:2 load", self.reason(self.git_commit()))

    def test_a_restaged_tree_ends_the_unfinished_check_it_replaces_and_its_snapshot(self):
        _, first = self.shim_launch()
        self.labelled({"b.py": (FIXED.replace("b3 checked", "b3 checked twice"), "CODE")})
        _, args = self.shim_launch()
        with self.shims() as shims:
            old, new = shims.check(self.tree), shims.check(git(self.root, "write-tree"))
        self.assertEqual((old["status"], old["snapshot"]), ("failed", None))
        self.assertIn(new["ref"], old["reason"])
        self.assertEqual(self.snapshots(), [Path(args["snapshot"])])
        self.assertEqual(self.decision(self.sweep(first, [SITE])), "deny")
        [entry] = [e for e in self.gate_log() if e["action"] == "shim-check"]
        self.assertEqual(entry["decision"], "failed")
        self.assertIn(f"{old['ref']}: sweep,", entry["reason"])
        self.assertIn(f"replaced by {new['ref']}", entry["reason"])

    def test_a_launch_in_another_checkout_at_the_same_head_leaves_this_checks_snapshot(self):
        _, first = self.shim_launch()
        main, other = self.root, self.root / ".claude" / "worktrees" / "w1"
        git(main, "worktree", "add", "-q", "-b", "feat/2-other", str(other))
        self.root = other
        try:
            self.labelled({"b.py": (FIXED.replace("b3 checked", "b3 checked elsewhere"), "CODE")})
            _, second = self.shim_launch()
        finally:
            self.root = main
        self.assertNotEqual(first["snapshot"], second["snapshot"])
        with self.shims() as shims:
            self.assertEqual(shims.check(self.tree)["status"], "sweeping")
        self.assertTrue(Path(first["snapshot"]).is_dir())
        self.assertNotEqual(self.decision(self.sweep(first, [SITE])), "deny")

    def test_a_failed_judgement_leaves_the_check_failed_and_gives_the_snapshot_back(self):
        _, args = self.shim_launch()
        Jev.status = 500
        self.sweep(args, [SITE])
        with self.shims() as shims:
            check = shims.check(self.tree)
        self.assertEqual((check["status"], check["verdict"]), ("failed", None))
        self.assertIn("HTTP 500", check["reason"])
        self.assertEqual(self.snapshots(), [])

    def test_a_diff_too_large_for_jev_says_to_split_it(self):
        _, args = self.shim_launch()
        Jev.status = 400
        Jev.failure = {"error": {"message": 'HTTP 400: {"detail":{"error_type":"max_tokens_exceeded"}}', "code": 400}}
        self.sweep(args, [SITE])
        self.assertIn("Split the change", self.reason(self.git_commit()))


class ShimContest(Staged):
    """The author contests a listed site; one judge rules it once per bug, and the tree is judged again (R8)."""
    OTHER = {"file": "b.py", "line": 10, "function": "save", "does": "writes b unchecked"}
    LOAD, SAVE = shimcheck.site_id("c.py", "load"), shimcheck.site_id("b.py", "save")

    def setUp(self):
        super().setUp()
        Jev.answers["coverage"] = "edited_only"
        _, args = self.shim_launch()
        self.sweep(args, [SITE, self.OTHER])

    def contest(self, *sites, reason="c.py reads another file"):
        return self.shim_launch(contests=[{"site": site, "reason": reason} for site in sites])

    def rule(self, args, site, ruling, evidence=("c.py:2",), **extra):
        body = {"check_ref": args["check_ref"], "site": site, "ruling": ruling, "evidence": list(evidence),
                "reason": "read both", **extra}
        return self.output(SITE_JUDGE, body, agent_id=f"j-{site}")

    def test_a_contest_is_refused_before_any_agent_for_an_unlisted_site_or_an_empty_reason(self):
        for contests, said in (([{"site": "0" * 16, "reason": "x"}], "not in"),
                               ([{"site": self.LOAD, "reason": " "}], "reason is empty"),
                               ([], "non-empty list")):
            out, args = self.shim_launch(contests=contests)
            self.assertEqual(self.decision(out), "deny", contests)
            self.assertIn(said, self.reason(out))
            self.assertIsNone(args)

    def test_an_accepted_contest_runs_one_judge_per_site(self):
        out, args = self.contest(self.LOAD, self.SAVE)
        self.assertEqual((self.decision(out), args["mode"], args["sweepers"]), ("allow", "contest", []))
        self.assertEqual([j["site"] for j in args["judges"]], [self.LOAD, self.SAVE])
        self.assertIn("c.py reads another file", args["judges"][0]["prompt"])
        self.assertEqual(args["judges"][0]["schema"]["properties"]["site"], {"enum": [self.LOAD]})

    def test_a_stopped_contest_resumes_with_the_judges_still_owed(self):
        _, args = self.contest(self.LOAD, self.SAVE)
        self.rule(args, self.LOAD, "shares")
        out, args = self.shim_launch()
        self.assertEqual((self.decision(out), args["mode"]), ("allow", "contest"))
        self.assertEqual([j["site"] for j in args["judges"]], [self.SAVE])

    def test_a_site_is_ruled_once_for_its_bug(self):
        _, args = self.contest(self.LOAD)
        self.rule(args, self.LOAD, "shares")
        out, _ = self.contest(self.LOAD)
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("already ruled", self.reason(out))

    def test_a_deferral_needs_an_open_issue_and_evidence_needs_a_staged_file(self):
        _, args = self.contest(self.SAVE)
        for state, extra, evidence, said in (("OPEN", {}, "c.py:2", "needs the number of an open issue"),
                                             ("CLOSED", {"issue": 5}, "c.py:2", "issue #5 is not open"),
                                             ("OPEN", {"issue": 5}, "gone.py:1", "gone.py is not a file of the staged tree")):
            self.env["GH_ISSUE_STATE"] = state
            out = self.rule(args, self.SAVE, "deferred", evidence=[evidence], **extra)
            self.assertEqual(self.decision(out), "deny", said)
            self.assertIn(said, self.reason(out))
        self.env.pop("GH_ISSUE_STATE")
        out = self.rule(args, self.SAVE, "deferred", issue=5)
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("issue #5 could not be read: it is not an issue of this repo, or gh could not reach GitHub",
                      self.reason(out))
        self.env["GH_ISSUE_STATE"] = "OPEN"
        self.assertNotEqual(self.decision(self.rule(args, self.SAVE, "deferred", issue=5)), "deny")

    def test_a_site_ruled_out_leaves_the_judged_list_and_the_tree_is_judged_again_without_counting(self):
        _, args = self.contest(self.LOAD)
        Jev.answers["coverage"], Jev.seen = "all", []
        self.rule(args, self.LOAD, "not_shared")
        self.assertEqual([sorted(q["questions"]) for q in Jev.seen], [["coverage", "level"]])
        self.assertNotIn("c.py:2 load", Jev.seen[0]["state"])
        self.assertIn("b.py:10 save", Jev.seen[0]["state"])
        with self.shims() as shims:
            check = shims.check(self.tree)
            self.assertEqual((check["status"], check["verdict"], check["mode"]), ("complete", "complete", "rejudge"))
            [chain] = shims.chains_at(check["branch"], check["head"])
        self.assertEqual((chain["count"], chain["state"]), (1, "ended"))
        self.assertNotEqual(self.decision(self.git_commit()), "deny")

    def test_an_open_deferral_drops_the_site_from_later_checks_and_a_closed_one_returns_it(self):
        self.env["GH_ISSUE_STATE"] = "OPEN"
        _, args = self.contest(self.SAVE)
        self.rule(args, self.SAVE, "deferred", issue=5)
        self.env.pop("GH_ISSUE_STATE")
        self.labelled({"b.py": (FIXED.replace("b3 checked", "b3 unread"), "CODE")})
        out, _ = self.shim_launch()
        self.assertIn("issue #5 could not be read: it is not an issue of this repo, or gh could not reach GitHub",
                      self.reason(out))
        for state, listed in (("OPEN", False), ("CLOSED", True)):
            self.env["GH_ISSUE_STATE"] = state
            git(self.root, "checkout", "-q", "HEAD", "--", ".")
            self.labelled({"b.py": (FIXED.replace("b3 checked", f"b3 {state}"), "CODE")})
            _, args = self.shim_launch()
            self.sweep(args, [SITE, self.OTHER])
            self.assertEqual("b.py:10 save" in Jev.seen[-1]["state"], listed, state)


class ShimCost(Staged):
    """A staged tree is paid for once, and what each check cost is logged (US4, FR-012)."""

    def setUp(self):
        super().setUp()
        Jev.answers["coverage"] = "edited_only"
        _, args = self.shim_launch()
        self.sweep(args, [SITE])

    def test_a_retried_commit_reuses_the_verdict(self):
        asked = len(Jev.seen)
        first, again = self.reason(self.git_commit()), self.reason(self.git_commit())
        self.assertIn("ruled this fix a patch", first)
        self.assertEqual(first, again)
        self.assertEqual(len(Jev.seen), asked)
        out, _ = self.shim_launch()
        self.assertIn("already checked", self.reason(out))

    def test_a_one_line_change_needs_its_own_check(self):
        self.labelled({"b.py": (FIXED.replace("b3 checked", "b3 checked once more"), "CODE")})
        self.assertIn("has not been shim-checked", self.reason(self.git_commit()))

    def test_every_finished_check_is_logged_with_its_answers_sites_and_cost(self):
        [entry] = [e for e in self.gate_log() if e["action"] == "shim-check"]
        self.assertEqual(entry["decision"], "patch")
        self.assertRegex(entry["reason"], r": sweep, level cause, coverage edited_only, 1 sites, 1 agents, \d+ s, "
                                          r"\$0\.0020$")


class ShimRestart(Staged):
    def stored_check(self):
        with self.shims() as shims:
            return shims.check(self.tree)

    def test_a_check_stopped_while_sweeping_sweeps_again(self):
        self.shim_launch()
        out, args = self.shim_launch()
        self.assertEqual(self.decision(out), "allow")
        self.assertEqual((args["mode"], len(args["sweepers"])), ("sweep", 1))
        self.assertEqual(self.stored_check()["status"], "sweeping")
        self.assertEqual([list(q["questions"]) for q in Jev.seen], [["kind"]])

    def test_a_check_stopped_after_its_lists_asks_only_jev(self):
        _, args = self.shim_launch()
        Jev.status = 500
        self.sweep(args, [SITE])
        Jev.status = 200
        out, args = self.shim_launch()
        self.assertEqual(self.decision(out), "allow")
        self.assertEqual((args["mode"], args["sweepers"]), ("rejudge", []))
        check = self.stored_check()
        self.assertEqual((check["status"], check["verdict"], check["same_operation"]), ("complete", "complete", [SITE]))
        self.assertEqual([sorted(q["questions"]) for q in Jev.seen], [["kind"], ["coverage", "level"], ["coverage", "level"]])

    def test_a_check_that_failed_before_its_lists_asks_and_sweeps_again(self):
        Jev.status = 500
        self.shim_launch()
        Jev.status = 200
        out, args = self.shim_launch()
        self.assertEqual((self.decision(out), args["mode"]), ("allow", "sweep"))
        self.assertEqual(self.stored_check()["kind"], "fix")

    def test_a_restarted_check_counts_once(self):
        self.chain(count=2, ranges=[{"file": "b.py", "old_start": 4, "old_count": 1}])
        _, args = self.shim_launch()
        Jev.status = 500
        self.sweep(args, [SITE])
        with self.shims() as shims:
            self.assertEqual(shims.chain("c" * 16)["count"], 2)
        Jev.status, Jev.answers["coverage"] = 200, "edited_only"
        self.shim_launch()
        with self.shims() as shims:
            self.assertEqual(shims.chain("c" * 16)["count"], 3)


def lines_changed(*numbers, mark="checked"):
    """b.py with each of `numbers` (1-based) rewritten."""
    return "".join(f"b{i} {mark}\n" if i + 1 in numbers else f"b{i}\n" for i in range(20))


class ShimChain(ShimGate):
    """A refused bug is counted on one branch at one HEAD (R9)."""

    def setUp(self):
        super().setUp()
        self.commit("c.py", "def load():\n    return open('b').read()\n", "feat: c")
        Jev.answers["coverage"] = "edited_only"

    def checked(self, text, sites=(SITE,)):
        """Stage b.py as `text` and run its check to the end, with `sites` listed."""
        git(self.root, "checkout", "-q", "HEAD", "--", ".")
        tree = self.labelled({"b.py": (text, "CODE")})
        _, args = self.shim_launch()
        self.sweep(args, sites)
        return tree

    def chains(self):
        with self.shims() as shims:
            return shims.chains_at(git(self.root, "branch", "--show-current"), git(self.root, "rev-parse", "HEAD"))

    def test_a_first_patch_opens_a_chain_holding_its_hunks_and_sites(self):
        self.checked(lines_changed(4))
        [chain] = self.chains()
        self.assertEqual((chain["count"], chain["state"]), (1, "open"))
        self.assertIn({"file": "b.py", "old_start": 4, "old_count": 1}, chain["ranges"])
        self.assertIn({"file": "c.py", "old_start": 2, "old_count": 1}, chain["ranges"])

    def test_a_patch_reaching_an_earlier_hunk_or_a_listed_site_joins_and_counts(self):
        self.checked(lines_changed(4))
        self.checked(lines_changed(4, mark="checked again"))
        git(self.root, "checkout", "-q", "HEAD", "--", ".")
        self.labelled({"c.py": ("def load():\n    return open('b').read() or ''\n", "CODE")})
        _, args = self.shim_launch()
        self.sweep(args, [])
        [chain] = self.chains()
        self.assertEqual(chain["count"], 3)

    def test_a_patch_reaching_neither_opens_its_own_chain(self):
        self.checked(lines_changed(4))
        self.checked(lines_changed(16), sites=())
        self.assertEqual(sorted(c["count"] for c in self.chains()), [1, 1])

    def test_a_complete_check_that_reaches_the_chain_ends_it(self):
        self.checked(lines_changed(4))
        Jev.answers["coverage"] = "all"
        self.checked(lines_changed(4, mark="fixed"))
        [chain] = self.chains()
        self.assertEqual((chain["count"], chain["state"]), (1, "ended"))
        Jev.answers["coverage"] = "edited_only"
        self.checked(lines_changed(4, mark="again"))
        self.assertEqual(sorted((c["state"], c["count"]) for c in self.chains()), [("ended", 1), ("open", 1)])

    def test_head_moving_leaves_the_chain_behind(self):
        self.checked(lines_changed(4))
        git(self.root, "checkout", "-q", "HEAD", "--", ".")
        self.commit("d.py", "d\n", "feat: d")
        self.checked(lines_changed(4, mark="again"))
        [chain] = self.chains()
        self.assertEqual(chain["count"], 1)

    def test_one_patch_reaching_two_chains_counts_for_both(self):
        self.checked(lines_changed(4))
        self.checked(lines_changed(16), sites=())
        self.checked(lines_changed(4, 16))
        self.assertEqual(sorted(c["count"] for c in self.chains()), [2, 2])

    def test_a_chain_of_another_branch_never_matches(self):
        self.chain(branch="feat/9-other")
        self.checked(lines_changed(4))
        [chain] = self.chains()
        self.assertEqual((chain["count"], chain["branch"]), (1, git(self.root, "branch", "--show-current")))
        with self.shims() as shims:
            self.assertEqual(shims.chain("c" * 16)["count"], 1)

    def test_a_tree_checked_twice_counts_once(self):
        tree = self.checked(lines_changed(4))
        with self.shims() as shims:
            check = shims.check(tree)
            check["status"] = "judging"
            shims.save_check(check)
        self.shim_launch()
        [chain] = self.chains()
        self.assertEqual(chain["count"], 1)


class ShimDeep(ShimChain):
    """At a bug's third refusal the next check sweeps deeper, and later checks reuse its list (R10)."""
    OTHER = {"file": "b.py", "line": 10, "function": "save", "does": "writes b unchecked"}

    def refused_three_times(self):
        for mark in ("one", "two", "three"):
            self.checked(lines_changed(4, mark=mark))

    def deep(self):
        self.refused_three_times()
        out, args = self.shim_launch()
        for i, sites in enumerate(([SITE], [SITE, self.OTHER], [self.OTHER])):
            self.sweep(args, sites, agent_id=f"d{i}")
        return out, args

    def test_the_third_refusal_names_the_deep_sweep(self):
        self.refused_three_times()
        [chain] = self.chains()
        self.assertEqual((chain["count"], chain["state"]), (3, "deep_due"))
        self.assertIn("deep sweep", self.reason(self.git_commit()))

    def test_the_next_launch_runs_two_standard_sweepers_and_one_from_the_callers(self):
        out, args = self.deep()
        self.assertEqual((self.decision(out), args["mode"], len(args["sweepers"])), ("allow", "deep", 3))
        standard, again, callers_first = (s["prompt"] for s in args["sweepers"])
        self.assertEqual(standard, again)
        self.assertLess(callers_first.index("caller"), callers_first.index("same operation"))
        self.assertGreater(standard.index("Every caller"), standard.index("same operation"))

    def test_the_deep_list_becomes_the_target_and_replaces_the_third_verdict_without_counting(self):
        self.deep()
        [chain] = self.chains()
        self.assertEqual((chain["count"], chain["state"]), (3, "deep_done"))
        self.assertEqual(sorted(s["function"] for s in chain["target"]["same_operation"]), ["load", "save"])
        reason = self.reason(self.git_commit())
        self.assertIn("b.py:10 save", reason)
        self.assertIn("c.py:2 load", reason)
        self.assertEqual(self.snapshots(), [])

    def test_later_checks_of_the_bug_are_judged_against_the_target_with_no_sweep(self):
        self.deep()
        Jev.seen.clear()
        git(self.root, "checkout", "-q", "HEAD", "--", ".")
        self.labelled({"b.py": (lines_changed(4, mark="four"), "CODE")})
        out, args = self.shim_launch()
        self.assertEqual((self.decision(out), args["mode"], args["sweepers"]), ("allow", "rejudge", []))
        self.assertIn("b.py:10 save", Jev.seen[-1]["state"])
        [chain] = self.chains()
        self.assertEqual(chain["count"], 4)


class ShimMiss(ShimDeep):
    """A site a later list of the same bug names, which an earlier check left out, is logged as that check's miss
    (R12)."""

    def misses(self):
        return [(e["decision"], e["reason"]) for e in self.gate_log() if e["action"] == "shim-miss"]

    def test_a_later_refusal_naming_a_left_out_site_logs_one_miss_against_the_earlier_check(self):
        first = self.checked(lines_changed(4))
        self.checked(lines_changed(4, mark="two"), sites=[SITE, self.OTHER])
        [chain] = self.chains()
        missed = shimcheck.site_id("b.py", "save")
        self.assertEqual(self.misses(), [(missed, f"chain {chain['id']}: left out by {shimcheck.check_ref('acme/demo', first)}")])
        self.checked(lines_changed(4, mark="three"), sites=[SITE, self.OTHER])
        self.assertEqual(len(self.misses()), 1)

    def test_the_deep_list_logs_a_miss_against_every_check_that_left_the_site_out(self):
        self.deep()
        self.assertEqual([d for d, _ in self.misses()], [shimcheck.site_id("b.py", "save")] * 3)

    def test_a_deep_sweep_that_ends_complete_still_logs_its_misses(self):
        self.refused_three_times()
        Jev.answers["coverage"] = "all"
        _, args = self.shim_launch()
        for i in range(3):
            self.sweep(args, [SITE, self.OTHER], agent_id=f"d{i}")
        self.assertEqual(len(self.misses()), 3)
        self.assertEqual([c["state"] for c in self.chains()], ["ended"])


class ShimHold(ShimDeep):
    """At a bug's fourth refusal the check stops and asks the user (R11)."""

    def held(self):
        self.deep()
        git(self.root, "checkout", "-q", "HEAD", "--", ".")
        self.labelled({"b.py": (lines_changed(4, mark="four"), "CODE")})
        self.shim_launch()
        [chain] = self.chains()
        return chain

    def test_the_fourth_refusal_holds_the_bug_and_asks_the_user(self):
        chain = self.held()
        self.assertEqual((chain["count"], chain["state"]), (4, "held"))
        reason = self.reason(self.git_commit())
        self.assertIn("ask the user", reason)
        self.assertTrue(reason.rstrip().endswith(f"override shim-{chain['id']}`."), reason)
        out = self.shim_launch()[0]
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("ask the user", self.reason(out))

    def test_after_the_override_any_staging_of_the_bug_commits(self):
        chain = self.held()
        self.hook("UserPromptSubmit", prompt=f"override shim-{chain['id']}")
        git(self.root, "checkout", "-q", "HEAD", "--", ".")
        self.labelled({"b.py": (lines_changed(4, mark="five"), "CODE")})
        self.assertNotEqual(self.decision(self.git_commit()), "deny")


class ShimOverride(ShimGate):
    def override(self, word):
        return self.hook("UserPromptSubmit", prompt=f"override shim-{word}")

    def test_the_user_overrides_a_bug_by_its_chain(self):
        tree = self.labelled({"b.py": (FIXED, "CODE")})
        self.record(tree, verdict="patch", kind="fix", level="symptom", coverage="all", same_operation=[SITE],
                    callers=[])
        self.chain()
        self.assertIn("override shim-" + "c" * 16, self.reason(self.git_commit()))
        said = self.override("c" * 16)
        self.assertIn("switched the shim check off", json.dumps(said))
        with self.shims() as shims:
            self.assertEqual(shims.chain("c" * 16)["state"], "overridden")
        self.assertNotEqual(self.decision(self.git_commit()), "deny")
        self.assertEqual([e["action"] for e in self.gate_log()].count("shim-override"), 1)

    def test_an_unchecked_tree_is_overridden_by_its_prefix_for_that_bug_only(self):
        tree = self.labelled({"b.py": (FIXED, "CODE")})
        self.assertIn(f"override shim-{tree[:12]}", self.reason(self.git_commit()))
        self.override(tree[:12])
        self.labelled({"b.py": (FIXED.replace("b3 checked", "b3 checked twice"), "CODE")})
        self.assertNotEqual(self.decision(self.git_commit()), "deny")

    def test_an_override_does_not_reach_another_bug(self):
        tree = self.labelled({"b.py": (FIXED, "CODE")})
        self.override(tree[:12])
        git(self.root, "checkout", "-q", "HEAD", "--", "b.py")
        self.labelled({"b.py": ("".join(f"b{i}\n" for i in range(15)) + "b15 checked\n" +
                                "".join(f"b{i}\n" for i in range(16, 20)), "CODE")})
        self.assertEqual(self.decision(self.git_commit()), "deny")

    def test_once_head_moves_the_bug_is_checked_again(self):
        tree = self.labelled({"b.py": (FIXED, "CODE")})
        self.override(tree[:12])
        git(self.root, "reset", "-q", "b.py")
        self.commit("d.py", "d\n", "feat: d")
        self.labelled({"b.py": (FIXED, "CODE")})
        self.assertEqual(self.decision(self.git_commit()), "deny")

    def test_an_overridden_bug_is_not_swept_again(self):
        self.labelled({"b.py": (FIXED, "CODE")})
        self.chain()
        self.override("c" * 16)
        Jev.seen.clear()
        out, _ = self.shim_launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("switched the shim check off for this bug", self.reason(out))
        self.assertEqual((Jev.seen, self.snapshots()), ([], []))
        with self.shims() as shims:
            self.assertEqual(shims.chain("c" * 16)["state"], "overridden")

    def test_an_unknown_id_overrides_nothing(self):
        said = self.override("0" * 16)
        self.assertIn("nothing was switched off", json.dumps(said))


@unittest.skipUnless(shutil.which("node"), "node runs the workflow script")
class ShimCheckWorkflow(ShimGate):
    def run_workflow(self, args, answers):
        done = subprocess.run(["node", str(HARNESS), str(WORKFLOW)], input=json.dumps({"args": args, "answers": answers}),
                              capture_output=True, text=True, check=True)
        return json.loads(done.stdout)

    def test_modes_with_nothing_to_sweep_run_no_agent(self):
        for mode in ("none", "not_fix", "rejudge"):
            ran = self.run_workflow({"worktree": "/w", "check_ref": "shim-acme/demo-0123456789ab", "mode": mode,
                                     "head": "a" * 40, "snapshot": None, "sweepers": [], "judges": []}, {})
            self.assertEqual(ran["calls"], [], mode)
            self.assertEqual(ran["result"]["status"], "COMPLETE", mode)
            self.assertEqual(set(ran["result"]), {"status", "check_ref", "mode", "agents", "next_step"})

    def test_a_sweep_runs_one_sweeper_with_the_injected_brief(self):
        self.labelled({"b.py": (FIXED, "CODE")})
        _, args = self.shim_launch()
        ran = self.run_workflow(args, {SWEEPER: {"same_operation": [], "callers": []}})
        [call] = ran["calls"]
        self.assertEqual((call["agentType"], call["prompt"], call["schema"]),
                         (SWEEPER, args["sweepers"][0]["prompt"], args["sweepers"][0]["schema"]))
        self.assertEqual((ran["result"]["status"], ran["result"]["agents"]), ("COMPLETE", 1))

    def test_a_deep_sweep_runs_three_sweepers(self):
        self.chain(count=3, state="deep_due")
        self.labelled({"b.py": (FIXED, "CODE")})
        _, args = self.shim_launch()
        ran = self.run_workflow(args, {SWEEPER: {"same_operation": [], "callers": []}})
        self.assertEqual([c["prompt"] for c in ran["calls"]], [s["prompt"] for s in args["sweepers"]])
        self.assertEqual((ran["result"]["status"], ran["result"]["mode"], ran["result"]["agents"]), ("COMPLETE", "deep", 3))

    def test_a_contest_runs_one_judge_per_site_with_the_injected_brief(self):
        args = {"worktree": "/w", "check_ref": "shim-acme/demo-0123456789ab", "mode": "contest", "head": "a" * 40,
                "snapshot": None, "sweepers": [],
                "judges": [{"type": SITE_JUDGE, "site": s, "prompt": f"rule {s}", "schema": {"properties": {}}}
                           for s in ("1" * 16, "2" * 16)]}
        ran = self.run_workflow(args, {SITE_JUDGE: {"ruling": "shares"}})
        self.assertEqual([(c["agentType"], c["prompt"]) for c in ran["calls"]],
                         [(SITE_JUDGE, "rule " + "1" * 16), (SITE_JUDGE, "rule " + "2" * 16)])
        self.assertEqual((ran["result"]["status"], ran["result"]["agents"]), ("COMPLETE", 2))
        silent = self.run_workflow(args, {SITE_JUDGE: None})["result"]
        self.assertEqual(silent["did_not_report"], ["judge of site " + "1" * 16, "judge of site " + "2" * 16])

    def test_a_sweeper_that_does_not_report_leaves_the_check_incomplete(self):
        self.labelled({"b.py": (FIXED, "CODE")})
        _, args = self.shim_launch()
        result = self.run_workflow(args, {SWEEPER: None})["result"]
        self.assertEqual((result["status"], result["did_not_report"]), ("INCOMPLETE", ["sweeper 1"]))
        self.assertEqual(set(result), {"status", "check_ref", "did_not_report", "next_step"})


if __name__ == "__main__":
    unittest.main()
