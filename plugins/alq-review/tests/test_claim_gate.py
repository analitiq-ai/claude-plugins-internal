"""The claim check through the gate, as Claude Code drives it: hook payloads in, decisions out, with recorded reader
and judge outputs standing for the agents."""
import json
import os
import shutil
import subprocess
import unittest
from pathlib import Path
from unittest import mock

from test_gate import Gate
from test_worktree_facts import git

import claimcheck
import hookio
import ledger

HARNESS = Path(__file__).resolve().parent / "workflow_harness.mjs"
WORKFLOW = Path(__file__).resolve().parent.parent / "workflows" / "claim-check.js"
CHECK = "alq-review:claim-check"
READER, JUDGE, CONTEST = "alq-review:claim-reader", "alq-review:claim-judge", "alq-review:claim-contest-judge"
VALIDATOR = "def check(items):\n    return True\n"
FALSE = "The validator rejects an empty list.\n"
TRUE = "The validator accepts every list it is given.\n"


class ClaimGate(Gate):
    def setUp(self):
        super().setUp()
        self.env["ALQ_REVIEW_CLAIM_CHECKS"] = "enforce"

    def stage(self, name, text):
        path = self.root / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
        git(self.root, "add", name)

    def git_commit(self, command=None, session="s1"):
        return self.bash(command or f"git -C {self.root} commit -q -m change", session=session)

    def check_launch(self, **args):
        return self.launch(CHECK, **args)

    def output(self, agent_type, body, agent_id="r1"):
        pre = self.hook("PreToolUse", "StructuredOutput", body, agent_id=agent_id, agent_type=agent_type)
        if self.decision(pre) != "deny":
            self.hook("PostToolUse", "StructuredOutput", body, agent_id=agent_id, agent_type=agent_type)
        return pre

    def read(self, args, labels, batch=0):
        """labels: hunk file -> (kind, [(line, quote, category)])."""
        reader = args["readers"][batch]
        hunks = [{"id": h["id"], "kind": labels[h["file"]][0],
                  "claims": [{"line": line, "quote": quote, "category": category}
                             for line, quote, category in labels[h["file"]][1]]} for h in reader["hunks"]]
        return self.output(READER, {"check_ref": args["check_ref"], "batch": reader["batch"], "hunks": hunks})

    def judge(self, args, file, quote, kind="WRONG", evidence="validator.py:2", agent_type=JUDGE, **extra):
        body = {"check_ref": args["check_ref"], "file": file, "quote": quote, "verdict": kind, "basis": "read it",
                "assertions": [{"text": "a", "confirmed": kind == "CORRECT", "evidence": evidence}], **extra}
        if kind == "WRONG":
            body.setdefault("failing_case", "check([]) returns True")
        if kind == "UNSURE":
            body.setdefault("gap", "the caller lives in another repo")
        return self.output(agent_type, body)

    def wrong_readme(self):
        """A README claim the validator falsifies, checked to WRONG."""
        self.stage("validator.py", VALIDATOR)
        self.stage("README.md", FALSE)
        _, args = self.check_launch()
        self.read(args, {"README.md": ("PROSE", [(1, FALSE.strip(), "K1")]), "validator.py": ("CODE", [])})
        self.judge(args, "README.md", FALSE.strip())
        return args

    def stored(self, tree=None):
        tree = tree or git(self.root, "write-tree")
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_claims("acme/demo") as claims:
                return claims.check(tree)

    def holds(self, file="README.md"):
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_claims("acme/demo") as claims:
                return claims.holds(git(self.root, "rev-parse", "HEAD^{tree}"), file)

    def gate_log(self):
        return [json.loads(line) for line in (self.state_dir / "gate.log").read_text().splitlines()]


class ClaimCheckSetting(ClaimGate):
    def test_the_claim_check_has_its_own_setting(self):
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_CLAIM_CHECKS": "log", "ALQ_REVIEW_MODE": "enforce"}):
            self.assertEqual((hookio.claim_checks_mode(), hookio.mode()), ("log", "enforce"))
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_CLAIM_CHECKS": ""}):
            self.assertEqual(hookio.claim_checks_mode(), "enforce")


class ClaimCheckCommit(ClaimGate):
    def test_a_wrong_claim_is_refused_with_its_case_and_evidence(self):
        self.stage("validator.py", VALIDATOR)
        self.stage("README.md", FALSE)
        first = self.git_commit()
        self.assertEqual(self.decision(first), "deny")
        self.assertIn(f"Workflow(name='{CHECK}', args={{worktree: '{self.root}'}})", self.reason(first))
        _, args = self.check_launch()
        self.read(args, {"README.md": ("PROSE", [(1, FALSE.strip(), "K1")]), "validator.py": ("CODE", [])})
        self.judge(args, "README.md", FALSE.strip())
        refused = self.git_commit()
        self.assertEqual(self.decision(refused), "deny")
        for part in ("README.md:1", FALSE.strip(), "check([]) returns True", "validator.py:2"):
            self.assertIn(part, self.reason(refused))

    def test_a_true_claim_passes(self):
        self.stage("validator.py", VALIDATOR)
        self.stage("README.md", TRUE)
        _, args = self.check_launch()
        self.read(args, {"README.md": ("PROSE", [(1, TRUE.strip(), "K1")]), "validator.py": ("CODE", [])})
        self.judge(args, "README.md", TRUE.strip(), "CORRECT")
        self.assertNotEqual(self.decision(self.git_commit()), "deny")
        self.assertEqual(git(self.root, "log", "-1", "--format=%s"), "change")

    def test_a_claim_about_another_repo_is_a_note_and_passes(self):
        self.stage("README.md", "The engine retries each batch.\n")
        _, args = self.check_launch()
        self.read(args, {"README.md": ("PROSE", [(1, "The engine retries each batch.", "K1")])})
        self.judge(args, "README.md", "The engine retries each batch.", "UNSURE", evidence="the engine is not in this repo")
        self.assertEqual(self.stored()["status"], "complete")
        self.assertNotEqual(self.decision(self.git_commit()), "deny")

    def test_code_alone_judges_nothing_and_passes(self):
        self.stage("validator.py", VALIDATOR)
        _, args = self.check_launch()
        self.read(args, {"validator.py": ("CODE", [])})
        self.assertEqual(self.stored()["status"], "complete")
        self.assertNotEqual(self.decision(self.git_commit()), "deny")

    def test_a_removal_is_judged_as_the_sentence_now_reads(self):
        git(self.root, "commit", "-q", "--allow-empty", "-m", "base")
        (self.root / "README.md").write_text("The validator rejects lists\nonly when they come from admins.\n")
        git(self.root, "add", "README.md")
        git(self.root, "commit", "-q", "-m", "readme")
        self.stage("README.md", "The validator rejects lists\n")
        _, args = self.check_launch()
        [hunk] = args["readers"][0]["hunks"]
        self.assertEqual((hunk["removed"], hunk["added"]), (["only when they come from admins."], []))
        self.assertEqual(self.decision(self.read(args, {"README.md": ("PROSE", [(1, "The validator rejects lists", "K1")])})),
                         None)
        self.assertEqual(self.stored()["status"], "judging")

    def test_a_comment_next_to_code_is_judged_and_the_code_is_not(self):
        self.stage("validator.py", "# check refuses an empty list\ndef check(items):\n    return True\n")
        _, args = self.check_launch()
        self.read(args, {"validator.py": ("MIXED", [(1, "check refuses an empty list", "K1")])})
        self.assertEqual([c["quote"] for c in self.stored()["claims"].values()], ["check refuses an empty list"])

    def test_the_check_runs_with_no_pr_open(self):
        self.env["GH_OPEN_PR"] = ""
        self.stage("README.md", FALSE)
        self.assertEqual(self.decision(self.git_commit()), "deny")

    def test_a_commit_that_stages_or_shares_its_command_is_refused(self):
        self.stage("README.md", FALSE)
        for command in (f"cd {self.root} && git add -A && git commit -q -m x", f"git -C {self.root} commit -qam x"):
            self.assertIn("`git commit` alone", self.reason(self.git_commit(command)), command)

    def test_an_empty_or_concluding_commit_is_not_checked(self):
        self.assertNotEqual(self.decision(self.git_commit(f"git -C {self.root} commit -q --allow-empty -m e")), "deny")
        self.stage("README.md", FALSE)
        Path(git(self.root, "rev-parse", "--absolute-git-dir"), "MERGE_HEAD").write_text(git(self.root, "rev-parse", "HEAD"))
        pre = self.hook("PreToolUse", "Bash", {"command": f"git -C {self.root} commit -q -m merge"})
        self.assertNotEqual(self.decision(pre), "deny")

    def test_in_log_the_refusal_is_recorded_and_the_review_gate_still_enforces(self):
        self.env["ALQ_REVIEW_CLAIM_CHECKS"] = "log"
        self.stage("README.md", FALSE)
        self.assertNotEqual(self.decision(self.git_commit()), "deny")
        self.assertIn("would_deny", [e["decision"] for e in self.gate_log() if e["action"] == "commit"])


class ClaimCheckLaunch(ClaimGate):
    def test_unstaged_tracked_changes_refuse_the_launch(self):
        self.stage("README.md", FALSE)
        (self.root / "b.py").write_text("edited\n")
        out, args = self.check_launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("b.py", self.reason(out))

    def test_a_launch_injects_the_work_and_opens_the_check(self):
        self.stage("validator.py", VALIDATOR)
        self.stage("README.md", FALSE)
        out, args = self.check_launch()
        self.assertEqual(self.decision(out), "allow")
        self.assertEqual(args["check_ref"], f"acme/demo#tree:{git(self.root, 'write-tree')}")
        self.assertEqual([h["file"] for h in args["readers"][0]["hunks"]], ["README.md", "validator.py"])
        self.assertEqual((args["reader_type"], args["judge_type"]), (READER, JUDGE))
        for part in ("prompt", "schema"):
            self.assertIn(part, args["readers"][0])
            self.assertIn(part, args["judge"])
        self.assertIn(str(self.root), args["judge"]["prompt"])
        self.assertEqual(self.stored()["status"], "reading")

    def test_nothing_staged_is_nothing_to_check(self):
        out, _ = self.check_launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("nothing", self.reason(out).lower())

    def test_a_tree_already_checked_is_not_checked_again(self):
        self.wrong_readme()
        out, _ = self.check_launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("already", self.reason(out))


class ClaimCheckOutputs(ClaimGate):
    def test_reader_output_is_validated_before_it_is_recorded(self):
        self.stage("README.md", FALSE)
        _, args = self.check_launch()
        rejected = self.read(args, {"README.md": ("PROSE", [(1, "The validator rejects every list.", "K1")])})
        self.assertEqual(self.decision(rejected), "deny")
        self.assertIn("README.md:1", self.reason(rejected))
        self.assertEqual(self.stored()["status"], "reading")
        self.read(args, {"README.md": ("PROSE", [(1, FALSE.strip(), "K1")])})
        self.assertEqual(self.stored()["status"], "judging")

    def test_a_check_ref_with_no_check_is_rejected(self):
        body = {"check_ref": f"acme/demo#tree:{'c' * 40}", "batch": 0, "hunks": []}
        self.assertEqual(self.decision(self.output(READER, body)), "deny")

    def test_a_verdict_completes_the_check_and_unfinished_checks_refuse_as_failures(self):
        self.stage("validator.py", VALIDATOR)
        self.stage("README.md", FALSE)
        _, args = self.check_launch()
        self.read(args, {"README.md": ("PROSE", [(1, FALSE.strip(), "K1")]), "validator.py": ("CODE", [])})
        unfinished = self.git_commit()
        self.assertIn("not that a claim is wrong", self.reason(unfinished))
        bad = self.judge(args, "README.md", FALSE.strip(), evidence="notes/elsewhere.py:3")
        self.assertEqual(self.decision(bad), "deny")
        self.judge(args, "README.md", FALSE.strip())
        self.assertEqual(self.stored()["status"], "complete")

    def test_a_fault_in_the_gate_refuses_the_output_instead_of_passing_it(self):
        self.stage("README.md", FALSE)
        _, args = self.check_launch()
        for field in ("root", "batches"):
            with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
                with ledger.open_claims("acme/demo") as claims:
                    broken = claims.check(git(self.root, "write-tree"))
                    saved = broken.pop(field)
                    claims.save_check(broken)
            out = self.read(args, {"README.md": ("PROSE", [(1, FALSE.strip(), "K1")])})
            self.assertEqual(self.decision(out), "deny", field)
            self.assertIn("crashed", self.reason(out))
            with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
                with ledger.open_claims("acme/demo") as claims:
                    claims.save_check(dict(broken, **{field: saved}))

    def test_a_fault_in_a_stored_hunk_refuses_the_output_instead_of_passing_it(self):
        self.stage("README.md", FALSE)
        _, args = self.check_launch()
        for field in ("new_start", "file"):
            with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
                with ledger.open_claims("acme/demo") as claims:
                    broken = claims.check(git(self.root, "write-tree"))
                    saved = broken["hunks"][0].pop(field)
                    claims.save_check(broken)
            out = self.read(args, {"README.md": ("PROSE", [(1, FALSE.strip(), "K1")])})
            self.assertEqual(self.decision(out), "deny", field)
            self.assertIn("crashed", self.reason(out))
            broken["hunks"][0][field] = saved
            with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
                with ledger.open_claims("acme/demo") as claims:
                    claims.save_check(broken)

    def test_an_ill_shaped_output_is_left_to_the_schema_and_logged(self):
        self.stage("README.md", FALSE)
        _, args = self.check_launch()
        out = self.output(READER, {"check_ref": args["check_ref"], "hunks": []})
        self.assertNotEqual(self.decision(out), "deny")
        self.assertEqual([(e["action"], e["decision"]) for e in self.gate_log()][-1], ("claim-output", "ill-shaped"))


class ClaimCheckCommitHook(ClaimGate):
    def hook_script(self, script):
        hooks = Path(git(self.root, "rev-parse", "--absolute-git-dir"), "hooks")
        hooks.mkdir(exist_ok=True)
        (hooks / "pre-commit").write_text(f"#!/bin/sh\n{script}\n")
        (hooks / "pre-commit").chmod(0o755)

    def test_what_the_commit_hook_changes_is_not_checked_again(self):
        self.hook_script("sed -i 's/reads/skips/' README.md && git add README.md")
        self.stage("README.md", "The checker reads the staged tree.\n")
        _, args = self.check_launch()
        self.read(args, {"README.md": ("PROSE", [(1, "The checker reads the staged tree.", "K1")])})
        self.judge(args, "README.md", "The checker reads the staged tree.", "CORRECT", evidence="README.md:1")
        self.assertNotEqual(self.decision(self.git_commit()), "deny")
        self.assertIn("skips", git(self.root, "show", "HEAD:README.md"))
        push = self.hook("PreToolUse", "Bash", {"command": f"git -C {self.root} push -q origin HEAD"})
        self.assertNotEqual(self.decision(push), "deny")
        out, _ = self.check_launch()
        self.assertIn("Nothing is staged", self.reason(out))


class ClaimCheckRepair(ClaimGate):
    def test_only_the_changed_hunk_is_read_again_and_a_correct_claim_is_not_judged_again(self):
        self.stage("validator.py", VALIDATOR)
        self.stage("docs/guide.md", "The validator returns True.\n")
        args = self.wrong_readme_with_guide()
        self.stage("README.md", "The validator accepts an empty list.\n")
        _, again = self.check_launch()
        self.assertEqual([h["file"] for r in again["readers"] for h in r["hunks"]], ["README.md"])
        self.assertEqual(again["claims"], [])
        self.assertNotEqual(args["check_ref"], again["check_ref"])

    def test_a_check_left_judging_is_relaunched_for_the_missing_verdict_only(self):
        self.stage("validator.py", VALIDATOR)
        self.stage("docs/guide.md", "The validator returns True.\n")
        self.stage("README.md", TRUE)
        _, args = self.check_launch()
        self.read(args, {"README.md": ("PROSE", [(1, TRUE.strip(), "K1")]), "validator.py": ("CODE", []),
                         "docs/guide.md": ("PROSE", [(1, "The validator returns True.", "K1")])})
        self.judge(args, "docs/guide.md", "The validator returns True.", "CORRECT")
        self.assertEqual(self.stored()["status"], "judging")
        out, again = self.check_launch()
        self.assertEqual(self.decision(out), "allow")
        self.assertEqual((again["readers"], [c["quote"] for c in again["claims"]]), ([], [TRUE.strip()]))
        self.judge(again, "README.md", TRUE.strip(), "CORRECT")
        self.assertNotEqual(self.decision(self.git_commit()), "deny")

    def test_a_check_left_reading_is_relaunched_and_read(self):
        self.stage("README.md", TRUE)
        self.check_launch()
        out, again = self.check_launch()
        self.assertEqual(self.decision(out), "allow")
        self.assertEqual([h["file"] for r in again["readers"] for h in r["hunks"]], ["README.md"])
        self.read(again, {"README.md": ("PROSE", [(1, TRUE.strip(), "K1")])})
        self.judge(again, "README.md", TRUE.strip(), "CORRECT", evidence="README.md:1")
        self.assertNotEqual(self.decision(self.git_commit()), "deny")

    def wrong_readme_with_guide(self):
        self.stage("README.md", FALSE)
        _, args = self.check_launch()
        self.read(args, {"README.md": ("PROSE", [(1, FALSE.strip(), "K1")]), "validator.py": ("CODE", []),
                         "docs/guide.md": ("PROSE", [(1, "The validator returns True.", "K1")])})
        self.judge(args, "README.md", FALSE.strip())
        self.judge(args, "docs/guide.md", "The validator returns True.", "CORRECT")
        return args

    def test_a_repeated_commit_against_one_check_counts_once(self):
        self.wrong_readme()
        self.git_commit()
        self.git_commit()
        self.assertEqual([h["refusals"] for h in self.holds()], [1])

    def test_the_third_refusal_of_one_hunk_asks_the_user_and_the_user_releases_it(self):
        self.stage("validator.py", VALIDATOR)
        third = "Empty lists are rejected by the validator."
        for n, text in enumerate(("The validator rejects an empty list.", "The validator refuses an empty list.", third)):
            self.stage("README.md", text + "\n")
            _, args = self.check_launch()
            labels = {"README.md": ("PROSE", [(1, text, "K1")])}
            if n == 0:
                labels["validator.py"] = ("CODE", [])
            self.read(args, labels)
            self.judge(args, "README.md", text)
        self.assertEqual([h["refusals"] for h in self.holds()], [3])
        asked = self.git_commit()
        self.assertEqual(self.decision(asked), "deny")
        claim = claimcheck.claim_id("README.md", third)
        self.assertIn(f"unlock claim-{claim}", self.reason(asked))
        self.stage("README.md", "A fourth try.\n")
        self.assertIn(f"unlock claim-{claim}", self.reason(self.check_launch()[0]))
        self.stage("README.md", third + "\n")

        released = self.hook("UserPromptSubmit", prompt=f"unlock claim-{claim}")
        self.assertIn("released", json.dumps(released))
        self.stage("docs/other.md", "The validator returns True.\n")
        _, args = self.check_launch()
        self.assertEqual([h["file"] for r in args["readers"] for h in r["hunks"]], ["docs/other.md"])
        self.read(args, {"docs/other.md": ("PROSE", [(1, "The validator returns True.", "K1")])})
        self.judge(args, "docs/other.md", "The validator returns True.", "CORRECT")
        self.judge(args, "README.md", third)
        self.assertEqual(self.holds("docs/other.md"), [])
        self.assertNotEqual(self.decision(self.git_commit()), "deny")

    def test_an_agent_cannot_release_a_hold(self):
        refused = self.hook("PreToolUse", "Bash", {"command": "python3 /p/alq-review/scripts/ledger.py unlock --worktree /w "
                                                             "--reason x"})
        self.assertEqual(self.decision(refused), "deny")

    def test_a_wrong_claim_is_judged_again_when_any_staged_file_changes(self):
        self.wrong_readme()
        self.stage("validator.py", "def check(items):\n    return bool(items)\n")
        _, args = self.check_launch()
        self.assertEqual(args["readers"][0]["hunks"][0]["file"], "validator.py")
        self.assertEqual([c["quote"] for c in args["claims"]], [FALSE.strip()])


class ClaimCheckContest(ClaimGate):
    def test_a_contest_with_evidence_is_judged_by_a_fresh_judge(self):
        self.wrong_readme()
        cid = claimcheck.claim_id("README.md", FALSE.strip())
        out, args = self.check_launch(contests=[{"claim": f"claim-{cid}", "evidence": "https://docs.example/validator"}])
        self.assertEqual(self.decision(out), "allow")
        [job] = args["contests"]
        self.assertEqual(args["contest_type"], CONTEST)
        for part in (FALSE.strip(), "check([]) returns True", "https://docs.example/validator"):
            self.assertIn(part, job["prompt"])

        allowed = self.hook("PreToolUse", "WebFetch", {"url": "https://docs.example/other", "prompt": "p"},
                            agent_id="c1", agent_type=CONTEST)
        self.assertNotEqual(self.decision(allowed), "deny")
        refused = self.hook("PreToolUse", "WebFetch", {"url": "https://elsewhere.example/", "prompt": "p"},
                            agent_id="c1", agent_type=CONTEST)
        self.assertEqual(self.decision(refused), "deny")
        mine = self.hook("PreToolUse", "WebFetch", {"url": "https://elsewhere.example/", "prompt": "p"})
        self.assertNotEqual(self.decision(mine), "deny")

        self.judge(args, "README.md", FALSE.strip(), "CORRECT", evidence="https://docs.example/validator",
                   agent_type=CONTEST)
        self.assertNotEqual(self.decision(self.git_commit()), "deny")

    def test_a_rejected_contest_is_a_refusal(self):
        self.wrong_readme()
        cid = claimcheck.claim_id("README.md", FALSE.strip())
        _, args = self.check_launch(contests=[{"claim": f"claim-{cid}", "evidence": "validator.py:1"}])
        self.judge(args, "README.md", FALSE.strip(), agent_type=CONTEST)
        self.assertEqual([h["refusals"] for h in self.holds()], [2])
        self.assertEqual(self.decision(self.git_commit()), "deny")

    def test_a_contest_without_evidence_is_refused_before_any_agent(self):
        self.wrong_readme()
        cid = claimcheck.claim_id("README.md", FALSE.strip())
        out, _ = self.check_launch(contests=[{"claim": f"claim-{cid}", "evidence": "I am sure it rejects them"}])
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("evidence", self.reason(out))

    def test_a_contest_names_its_claim_as_the_gate_prints_it(self):
        self.wrong_readme()
        cid = claimcheck.claim_id("README.md", FALSE.strip())
        refusal = self.reason(self.git_commit())
        self.assertIn(f"(claim-{cid})", refusal)
        self.assertIn("contests: [{claim: 'claim-<id>'", refusal)
        out, _ = self.check_launch(contests=[{"claim": cid, "evidence": "validator.py:1"}])
        self.assertEqual(self.decision(out), "deny")
        said = self.reason(out)
        self.assertIn(f"{cid!r} is not a claim id of this check", said)
        self.assertIn(f"its WRONG claims: claim-{cid}", said)
        self.assertNotIn("staged tree", said)

    def test_a_contest_of_a_claim_that_is_not_wrong_names_its_verdict(self):
        self.stage("validator.py", VALIDATOR)
        self.stage("README.md", FALSE)
        self.stage("docs/guide.md", "The validator returns True.\n")
        _, args = self.check_launch()
        self.read(args, {"README.md": ("PROSE", [(1, FALSE.strip(), "K1")]), "validator.py": ("CODE", []),
                         "docs/guide.md": ("PROSE", [(1, "The validator returns True.", "K1")])})
        self.judge(args, "README.md", FALSE.strip())
        self.judge(args, "docs/guide.md", "The validator returns True.", "CORRECT")
        cid = claimcheck.claim_id("docs/guide.md", "The validator returns True.")
        out, _ = self.check_launch(contests=[{"claim": f"claim-{cid}", "evidence": "validator.py:1"}])
        self.assertEqual(self.decision(out), "deny")
        self.assertIn(f"claim-{cid} is CORRECT, not WRONG", self.reason(out))


@unittest.skipUnless(shutil.which("node"), "node runs the workflow script")
class ClaimCheckWorkflow(ClaimGate):
    def run_workflow(self, args, answers):
        done = subprocess.run(["node", str(HARNESS), str(WORKFLOW)], input=json.dumps({"args": args, "answers": answers}),
                              capture_output=True, text=True, check=True)
        return json.loads(done.stdout)

    def test_each_k1_claim_gets_its_own_judge_pinned_to_it(self):
        self.stage("validator.py", VALIDATOR)
        self.stage("README.md", FALSE + "\nSee the guide.\n")
        _, args = self.check_launch()
        wrong = {"verdict": "WRONG", "basis": "b", "failing_case": "check([]) returns True",
                 "assertions": [{"text": "a", "confirmed": False, "evidence": "validator.py:2"}]}
        ran = self.run_workflow(args, {READER: {"README.md": {"kind": "PROSE", "claims": [
            {"line": 1, "quote": FALSE.strip(), "category": "K1"}, {"line": 3, "quote": "See the guide.", "category": "K7"}]},
                                                "validator.py": {"kind": "CODE", "claims": []}}, JUDGE: wrong})
        judges = [c for c in ran["calls"] if c["agentType"] == JUDGE]
        self.assertEqual([(j["schema"]["properties"]["file"], j["schema"]["properties"]["quote"]) for j in judges],
                         [({"enum": ["README.md"]}, {"enum": [FALSE.strip()]})])
        self.assertIn(f"Claim: {FALSE.strip()}", judges[0]["prompt"])
        result = ran["result"]
        self.assertEqual((result["status"], result["judged"], result["agents"]), ("COMPLETE", 1, 2))
        self.assertEqual(result["wrong"][0]["evidence"], ["validator.py:2"])
        self.assertEqual(result["not_judged_categories"], {"K7": 1})

    def test_a_contest_is_labelled_and_reported_by_its_printed_id(self):
        self.wrong_readme()
        cid = claimcheck.claim_id("README.md", FALSE.strip())
        _, args = self.check_launch(contests=[{"claim": f"claim-{cid}", "evidence": "validator.py:1"}])
        upheld = {"verdict": "CORRECT", "basis": "b", "assertions": [{"text": "a", "confirmed": True, "evidence": "validator.py:1"}]}
        ran = self.run_workflow(args, {CONTEST: upheld})
        self.assertEqual([c["label"] for c in ran["calls"]], [f"contest claim-{cid}"])
        self.assertEqual([c["claim_id"] for c in ran["result"]["contests"]], [f"claim-{cid}"])

    def test_an_agent_that_does_not_report_leaves_the_check_incomplete(self):
        self.stage("README.md", FALSE)
        _, args = self.check_launch()
        result = self.run_workflow(args, {READER: None})["result"]
        self.assertEqual((result["status"], result["did_not_report"]), ("INCOMPLETE", ["reader of batch 0"]))

    def test_more_claims_than_the_threshold_warn_and_still_run(self):
        self.stage("README.md", FALSE)
        _, args = self.check_launch()
        correct = {"verdict": "CORRECT", "basis": "b", "assertions": [{"text": "a", "confirmed": True, "evidence": "README.md:1"}]}
        result = self.run_workflow(dict(args, warn_over=0), {READER: {"README.md": {"kind": "PROSE", "claims": [
            {"line": 1, "quote": FALSE.strip(), "category": "K1"}]}}, JUDGE: correct})["result"]
        self.assertEqual(result["status"], "COMPLETE")
        self.assertIn("1 claims", result["warning"])


class ClaimCheckCost(ClaimGate):
    def test_the_large_commit_threshold_is_injected_and_the_check_is_logged(self):
        self.stage("validator.py", VALIDATOR)
        self.stage("README.md", FALSE)
        _, args = self.check_launch()
        self.assertEqual(args["warn_over"], 20)
        self.read(args, {"README.md": ("PROSE", [(1, FALSE.strip(), "K1")]), "validator.py": ("CODE", [])})
        self.judge(args, "README.md", FALSE.strip())
        self.git_commit()
        logged = [e for e in self.gate_log() if e["action"] == "claim-check"]
        self.assertTrue(any("1 judged" in e["reason"] and "1 WRONG" in e["reason"] for e in logged), logged)
        self.assertTrue(any(e["action"] == "commit" and e["decision"] == "deny" for e in self.gate_log()))


if __name__ == "__main__":
    unittest.main()
