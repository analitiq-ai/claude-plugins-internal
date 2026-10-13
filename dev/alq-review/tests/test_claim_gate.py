"""The claim check through the gate, as Claude Code drives it: hook payloads in, decisions out, with recorded reader
and judge outputs standing for the agents."""
import json
import os
import re
import shutil
import sqlite3
import subprocess
import unittest
from contextlib import closing
from pathlib import Path
from unittest import mock

from paths import PLUGIN

from test_gate import Gate, ThroughProcess
from test_worktree_facts import git

import claimcheck
import hookio
import ledger

HARNESS = Path(__file__).resolve().parent / "workflow_harness.mjs"
# The command a refusal gives for a missing diff library: the pip form, or the system package where pip is refused.
INSTALL_COMMAND = re.compile(r"`(?:\S+ -m pip install diff-match-patch|sudo apt install python3-diff-match-patch)`")
WORKFLOW = PLUGIN / "workflows" / "claim-check.js"
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

    def lineages(self, file="README.md", ended=False):
        """The branch's open lineages of `file` (with `ended`, every lineage the ledger keeps)."""
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with closing(sqlite3.connect(self.state_dir / "ledger.db")) as conn:
                rows = conn.execute("SELECT doc FROM claim_lineages WHERE branch = ? ORDER BY id, opened",
                                    (git(self.root, "branch", "--show-current"),)).fetchall()
        found = [json.loads(doc) for (doc,) in rows]
        return [item for item in found if item["file"] == file and (ended or item["state"] == "open")]

    def counts(self, file="README.md"):
        return sorted(claimcheck.count(item) for item in self.lineages(file))

    def ruling(self, claims, **judge):
        """Check the staged change as agents would: the reader quotes `claims` ({file: [(line, quote, ruling)]}) and the
        judge gives each its ruling. A staged `.py` file is code and has none."""
        _, args = self.check_launch()
        files = [h["file"] for r in args["readers"] for h in r["hunks"]]
        self.read(args, {f: ("CODE", []) if f.endswith(".py") else
                         ("PROSE", [(line, quote, "K1") for line, quote, _ in claims.get(f, [])]) for f in files})
        for file, quoted in claims.items():
            for _, quote, kind in quoted:
                self.judge(args, file, quote, kind, **judge)
        return args

    def wrong(self, text, file="README.md"):
        self.stage("validator.py", VALIDATOR)
        self.stage(file, text + "\n")
        return self.ruling({file: [(1, text, "WRONG")]})

    def unlock(self, lineage_id):
        return self.hook("UserPromptSubmit", prompt=f"unlock claim-{lineage_id}")

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
        self.assertEqual(set(args["judges"]), set(claimcheck.JUDGED))
        for part in ("prompt", "schema"):
            self.assertIn(part, args["readers"][0])
            for category in claimcheck.JUDGED:
                self.assertIn(part, args["judges"][category])
        for category in claimcheck.JUDGED:
            self.assertIn(str(self.root), args["judges"][category]["prompt"])
        self.assertEqual(self.stored()["status"], "reading")

    def test_the_k1_judge_prompt_is_unchanged_by_k9(self):
        self.stage("README.md", FALSE)
        _, args = self.check_launch()
        pinned = (Path(__file__).parent / "fixtures" / "k1_judge_prompt.txt").read_text()
        self.assertEqual(args["judges"]["K1"]["prompt"], pinned.replace("/work/demo", str(self.root)))

    def test_what_a_test_checks_is_judged_against_that_test_not_the_code(self):
        self.stage("README.md", FALSE)
        _, args = self.check_launch()
        k9 = args["judges"]["K9"]["prompt"]
        self.assertNotEqual(k9, args["judges"]["K1"]["prompt"])
        for part in ("{{file}}", "{{line}}", "{{claim}}", "its assertions and inputs", "code under test is not evidence"):
            self.assertIn(part, " ".join(k9.split()))
        reader = " ".join(args["readers"][0]["prompt"].split())
        self.assertIn("- K9: what a test checks", reader)
        self.assertIn("a test's name or failure message", reader)

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

    def test_an_ill_shaped_output_is_left_to_the_schema_and_logged(self):
        self.stage("README.md", FALSE)
        _, args = self.check_launch()
        # PreToolUse alone: the harness rejects this body on its schema and sends no PostToolUse for it.
        out = self.hook("PreToolUse", "StructuredOutput", {"check_ref": args["check_ref"], "hunks": []}, agent_id="r1",
                        agent_type=READER)
        self.assertNotEqual(self.decision(out), "deny")
        self.assertEqual([(e["action"], e["decision"]) for e in self.gate_log()][-1], ("claim-output", "ill-shaped"))


class ClaimCheckFaults(ThroughProcess, ClaimGate):
    """A gate that crashes checking an output has passed nothing: the crash refuses the output."""

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

    def test_a_correct_verdict_is_not_reused_for_the_claim_filed_under_another_category(self):
        message = "an empty list is rejected"
        self.stage("validator.py", VALIDATOR)
        self.stage("tests/test_validator.py", f"def test_empty():\n    assert check([]) is False, \"{message}\"\n")
        _, args = self.check_launch()
        self.read(args, {"tests/test_validator.py": ("MIXED", [(2, message, "K1")]), "validator.py": ("CODE", [])})
        self.judge(args, "tests/test_validator.py", message, "CORRECT", evidence="validator.py:2")
        self.stage("tests/test_validator.py", f"def test_an_empty_list():\n    assert check([]) is False, \"{message}\"\n")
        _, relabelled = self.check_launch()
        self.read(relabelled, {"tests/test_validator.py": ("MIXED", [(2, message, "K9")])})
        self.judge(relabelled, "tests/test_validator.py", message, evidence="tests/test_validator.py:2")
        self.stage("docs/guide.md", "Run the tests.\n")
        _, again = self.check_launch()
        self.assertEqual([c["quote"] for c in again["claims"]], [message])

    def test_a_read_made_under_another_reader_brief_is_read_again(self):
        self.stage("README.md", TRUE)
        _, args = self.check_launch()
        self.read(args, {"README.md": ("PROSE", [(1, TRUE.strip(), "K1")])})
        with closing(sqlite3.connect(self.state_dir / "ledger.db")) as conn, conn:
            for patch_id, doc in conn.execute("SELECT patch_id, doc FROM claim_reads").fetchall():
                conn.execute("UPDATE claim_reads SET doc = ? WHERE patch_id = ?",
                             (json.dumps({**json.loads(doc), "brief": "an-older-reader-brief"}), patch_id))
        self.stage("docs/guide.md", "Run the tests.\n")
        _, again = self.check_launch()
        self.assertEqual(sorted(h["file"] for r in again["readers"] for h in r["hunks"]), ["README.md", "docs/guide.md"])

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


V = ("The validator rejects an empty list.", "The validator refuses an empty list.",
     "Empty lists are rejected by the validator.", "An empty list never passes the validator.")


class ClaimLineages(ClaimGate):
    def test_a_reworded_wrong_claim_is_one_lineage_with_a_rising_count(self):  # C1
        self.wrong(V[0])
        self.wrong(V[1])
        [found] = self.lineages()
        self.assertEqual((found["id"], claimcheck.count(found)), (claimcheck.claim_id("README.md", V[0]), 2))
        self.assertEqual([item["words"] for item in found["chain"]], [V[0], V[1]])

    def commit_another_file(self):
        git(self.root, "reset", "-q", "--", "README.md")
        self.stage("docs/other.md", "The validator returns True.\n")
        self.ruling({"docs/other.md": [(1, "The validator returns True.", "CORRECT")]})
        self.assertNotEqual(self.decision(self.git_commit()), "deny")

    def test_a_commit_of_another_file_in_between_does_not_reset_the_count(self):  # C2 (#15)
        self.wrong(V[0])
        self.wrong(V[1])
        self.commit_another_file()
        self.assertEqual(self.counts(), [2])
        self.wrong(V[2])
        self.assertEqual(self.counts(), [3])
        asked = self.git_commit()
        self.assertEqual(self.decision(asked), "deny")
        self.assertIn(f"unlock claim-{claimcheck.claim_id('README.md', V[0])}", self.reason(asked))
        self.stage("README.md", V[3] + "\n")
        launched = self.check_launch()[0]
        self.assertEqual(self.decision(launched), "deny")
        self.assertIn("Stop and ask the user", self.reason(launched))

    def test_an_amend_does_not_reset_the_count(self):  # C3
        self.wrong(V[0])
        self.wrong(V[1])
        self.commit_another_file()
        self.assertNotEqual(self.decision(self.git_commit(f"git -C {self.root} commit -q --amend --no-edit")), "deny")
        self.wrong(V[2])
        self.assertEqual(self.counts(), [3])

    def test_the_completion_step_run_twice_counts_once(self):  # C9 (#16)
        self.wrong(V[0])
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_claims("acme/demo") as claims:
                again = claims.check(git(self.root, "write-tree"))
                again["status"] = "judging"
                again["verdicts"] = {}
                claims.save_check(again)
        self.judge({"check_ref": again["ref"]}, "README.md", V[0])
        self.assertEqual(self.stored()["status"], "complete")
        self.assertEqual(self.counts(), [1])

    def test_a_correct_ruling_ends_the_lineage_and_the_next_wrong_starts_at_one(self):  # C15
        self.wrong(V[0])
        self.wrong(V[1])
        self.stage("README.md", V[2] + "\n")
        self.ruling({"README.md": [(1, V[2], "CORRECT")]})
        [ended] = self.lineages(ended=True)
        self.assertEqual((ended["state"], ended["ended"]["by"]), ("ended", "correct"))
        self.assertEqual(self.lineages(), [])
        self.wrong(V[3])
        [fresh] = self.lineages()
        self.assertEqual((fresh["id"], claimcheck.count(fresh)), (claimcheck.claim_id("README.md", V[3]), 1))

    def test_a_file_with_a_unicode_line_break_above_a_claim_is_checked_like_any_other(self):  # C24
        self.stage("validator.py", VALIDATOR)
        self.stage("README.md", f"Intro\u2028still the intro\x0c\n{V[0]}\n")
        self.ruling({"README.md": [(2, V[0], "WRONG")]})
        [found] = self.lineages()
        self.assertEqual((found["id"], claimcheck.count(found)), (claimcheck.claim_id("README.md", V[0]), 1))
        self.assertEqual([found["places"][0]["claim"]], [claimcheck.claim_id("README.md", V[0])])

    def contest(self, text, kind):
        cid = claimcheck.claim_id("README.md", text)
        _, args = self.check_launch(contests=[{"claim": f"claim-{cid}", "evidence": "validator.py:1"}])
        self.judge(args, "README.md", text, kind, agent_type=CONTEST)

    def test_a_rejected_contest_is_one_more_wrong(self):  # C16
        self.wrong(V[0])
        self.contest(V[0], "WRONG")
        self.assertEqual(self.counts(), [2])
        self.assertEqual(self.decision(self.git_commit()), "deny")

    def test_an_upheld_contest_lowers_nothing_and_lets_the_commit_through(self):  # C17
        self.wrong(V[0])
        self.wrong(V[1])
        self.contest(V[1], "UNSURE")
        self.assertEqual(self.counts(), [2])
        self.assertNotEqual(self.decision(self.git_commit()), "deny")

    def test_an_upheld_contest_that_finds_the_claim_correct_ends_the_lineage(self):  # C17, FR-008
        self.wrong(V[0])
        self.wrong(V[1])
        self.contest(V[1], "CORRECT")
        [ended] = self.lineages(ended=True)
        self.assertEqual((ended["state"], ended["ended"]["by"]), ("ended", "correct"))
        self.wrong(V[2])
        self.assertEqual(self.counts(), [1])

    def test_reshaping_text_that_shares_a_hunk_keeps_each_claim_its_own_lineage(self):  # C10
        self.stage("validator.py", VALIDATOR)
        lines = [f"The validator rejects {word} lists." for word in ("empty", "short", "long")]
        for n, wrong in enumerate(lines):
            self.stage("README.md", "\n".join(lines) + f"\nRevision {n}.\n")
            self.ruling({"README.md": [(i + 1, line, "WRONG" if line == wrong else "UNSURE")
                                       for i, line in enumerate(lines)]})
        self.assertEqual(self.counts(), [1, 1, 1])
        self.assertEqual(self.reason(self.git_commit()).count("Stop and ask the user"), 0)


class ClaimRelease(ClaimGate):
    def held(self):
        for text in V[:3]:
            self.wrong(text)
        return claimcheck.claim_id("README.md", V[0])

    def test_the_user_releases_a_hold_and_one_more_wrong_brings_them_back(self):  # C8
        lid = self.held()
        self.assertEqual(self.decision(self.git_commit()), "deny")
        said = self.unlock(lid)["hookSpecificOutput"]["additionalContext"]
        self.assertIn("released", said)
        self.assertNotEqual(self.decision(self.git_commit()), "deny")
        self.assertEqual(git(self.root, "show", "HEAD:README.md"), V[2])
        self.wrong(V[3])
        self.assertEqual(self.counts(), [4])
        again = self.git_commit()
        for part in (V[0], V[1], V[2], V[3], f"unlock claim-{lid}"):
            self.assertIn(part, self.reason(again))

    def test_the_lineage_or_its_current_words_may_be_named_in_the_release(self):
        lid = self.held()
        current = claimcheck.claim_id("README.md", V[2])
        for named in (lid, current):
            with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
                with ledger.open_claims("acme/demo") as claims:
                    [found] = claims.open_lineages(git(self.root, "branch", "--show-current"))
                    found["released"] = None
                    claims.save_lineage(git(self.root, "branch", "--show-current"), found)
            self.assertIn("released", self.unlock(named)["hookSpecificOutput"]["additionalContext"], named)
            self.assertEqual(self.lineages()[0]["released"]["count"], 3)

    def test_an_unlock_naming_nothing_says_so_and_changes_nothing(self):
        self.held()
        other = "0" * 16
        said = self.unlock(other)["hookSpecificOutput"]["additionalContext"]
        self.assertEqual(said, f"[alq-review] `unlock claim-{other}` names no claim a check is holding, so nothing was released.")
        self.assertIsNone(self.lineages()[0]["released"])
        self.assertEqual(self.decision(self.git_commit()), "deny")

    def reworded(self, text):
        self.stage("README.md", f"Intro.\n{text}\nOutro.\n")
        self.ruling({"README.md": [(2, text, "WRONG")]})

    def test_an_unlock_changes_nothing_in_a_lineage_below_the_bound_or_already_released(self):  # C25
        self.stage("validator.py", VALIDATOR)
        lid = claimcheck.claim_id("README.md", V[0])
        self.reworded(V[0])
        self.reworded(V[1])
        below = self.lineages()
        self.assertEqual([claimcheck.count(item) for item in below], [2])
        self.unlock(lid)
        self.assertEqual(self.lineages(), below)
        self.reworded(V[2])
        self.unlock(lid)
        [released] = self.lineages()
        self.assertEqual(released["released"]["count"], 3)
        self.unlock(lid)
        self.assertEqual(self.lineages(), [released])

    def test_an_unlock_changes_nothing_in_a_lineage_that_ended_at_the_bound_unreleased(self):  # C25
        self.stage("validator.py", VALIDATOR)
        for text in V[:3]:
            self.reworded(text)
        self.stage("README.md", "Intro.\nOutro.\n")
        self.ruling({"README.md": []})
        [ended] = self.lineages(ended=True)
        self.assertEqual((claimcheck.count(ended), ended["state"], ended["ended"]["by"], ended["released"]),
                         (3, "ended", "deleted", None))
        self.unlock(claimcheck.claim_id("README.md", V[0]))
        self.assertEqual(self.lineages(ended=True), [ended])

    def test_a_reword_without_the_release_is_refused_at_launch(self):  # C18
        self.held()
        self.stage("README.md", V[3] + "\n")
        out = self.check_launch()[0]
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("Stop and ask the user", self.reason(out))

    def test_an_agent_cannot_release_a_hold(self):
        lid = self.held()
        self.assertEqual(self.decision(self.hook("PreToolUse", "Bash", {"command": f"python3 /p/alq-review/scripts/ledger.py unlock claim-{lid}"})), "deny")
        self.assertIsNone(self.lineages()[0]["released"])

    def test_a_released_lineage_merged_with_a_lower_one_is_held_by_the_next_wrong(self):  # C20
        self.stage("validator.py", VALIDATOR)
        first, second = "The tool is fast.", "It is safe."
        self.stage("README.md", f"{first}\n{second}\n")
        self.ruling({"README.md": [(1, first, "WRONG"), (2, second, "WRONG")]})
        for text in V[:2]:
            self.stage("README.md", f"{text}\n{second}\n")
            self.ruling({"README.md": [(1, text, "WRONG")]})
        self.assertEqual(self.counts(), [1, 3])
        [top] = [item for item in self.lineages() if claimcheck.count(item) == 3]
        self.unlock(top["id"])
        merged = "The validator refuses an empty list and it is safe."
        self.stage("README.md", merged + "\n")
        self.ruling({"README.md": [(1, merged, "WRONG")]})
        [survivor] = self.lineages()
        self.assertEqual((survivor["id"], claimcheck.count(survivor), claimcheck.held(survivor)), (top["id"], 4, True))


class ClaimReshaping(ClaimGate):
    def at_two(self, *lines):
        """README.md holds `lines` with the first reworded and ruled WRONG twice."""
        self.stage("validator.py", VALIDATOR)
        for text in V[:2]:
            self.stage("README.md", "\n".join((text, *lines)) + "\n")
            self.ruling({"README.md": [(1, text, "WRONG")]})
        return self.lineages()

    def test_a_split_in_place_keeps_both_halves_in_the_lineage(self):  # C4
        self.stage("validator.py", VALIDATOR)
        for verb in ("rejects", "refuses"):
            long = f"The validator {verb} an empty list and it logs the reason."
            self.stage("README.md", long + "\n")
            self.ruling({"README.md": [(1, long, "WRONG")]})
        halves = ("The validator refuses an empty list.", "It logs the reason.")
        self.stage("README.md", "\n".join(halves) + "\n")
        self.ruling({"README.md": [(1, halves[0], "UNSURE"), (2, halves[1], "UNSURE")]})
        [found] = self.lineages()
        self.assertEqual((claimcheck.count(found), len(found["places"])), (2, 2))

    def halves_ruled(self, first, second):
        """Two wrong rewordings of one sentence, then its halves ruled `first` and `second`."""
        self.stage("validator.py", VALIDATOR)
        for verb in ("rejects", "refuses"):
            long = f"The validator {verb} an empty list and it logs the reason."
            self.stage("README.md", long + "\n")
            self.ruling({"README.md": [(1, long, "WRONG")]})
        halves = ("The validator refuses an empty list.", "It logs the reason.")
        self.stage("README.md", "\n".join(halves) + "\n")
        self.ruling({"README.md": [(1, halves[0], first), (2, halves[1], second)]})

    def test_a_split_whose_first_half_is_correct_and_second_wrong_still_counts(self):  # C4, FR-003
        self.halves_ruled("CORRECT", "WRONG")
        self.assertEqual(self.counts(), [3])

    def test_a_split_whose_first_half_is_wrong_and_second_correct_still_counts(self):  # C4, FR-003
        self.halves_ruled("WRONG", "CORRECT")
        self.assertEqual(self.counts(), [3])

    def test_a_file_the_tree_lacks_ends_its_lineages(self):  # C6, FR-010
        self.commit("README.md", "Placeholder.\n", "docs: readme")
        self.at_two("Other text.")
        git(self.root, "rm", "-q", "-f", "README.md")
        self.check_launch()
        [ended] = self.lineages(ended=True)
        self.assertEqual((ended["state"], ended["ended"]["by"]), ("ended", "deleted"))

    def test_two_lineages_merged_into_one_sentence_continue_as_the_higher(self):  # C5
        self.stage("validator.py", VALIDATOR)
        second = "It is safe."
        self.stage("README.md", f"{V[0]}\n{second}\n")
        self.ruling({"README.md": [(1, V[0], "WRONG"), (2, second, "WRONG")]})
        self.stage("README.md", f"{V[1]}\n{second}\n")
        self.ruling({"README.md": [(1, V[1], "WRONG")]})
        merged = "The validator refuses an empty list and it is safe."
        self.stage("README.md", merged + "\n")
        self.ruling({"README.md": [(1, merged, "WRONG")]})
        [survivor] = self.lineages()
        self.assertEqual(claimcheck.count(survivor), 3)
        [loser] = [item for item in self.lineages(ended=True) if item["state"] == "ended"]
        self.assertEqual((loser["ended"]["by"], loser["ended"]["into"]), ("merged", survivor["id"]))

    def test_deleted_words_end_the_lineage(self):  # C6
        self.at_two("Other text.")
        self.stage("README.md", "Other text.\n")
        self.ruling({})
        [ended] = self.lineages(ended=True)
        self.assertEqual((ended["state"], ended["ended"]["by"]), ("ended", "deleted"))

    def test_words_moved_unchanged_in_the_file_keep_the_lineage(self):  # C7
        self.at_two("Other text.")
        self.stage("README.md", f"Other text.\n{V[1]}\n")
        self.ruling({"README.md": [(2, V[1], "WRONG")]})
        self.assertEqual(self.counts(), [3])
        self.assertEqual(len(self.lineages()), 1)

    def test_one_hunk_over_two_held_claims_continues_both(self):  # C11
        self.stage("validator.py", VALIDATOR)
        for n in range(3):
            first, second = f"The validator rejects an empty list ({n}).", f"The validator logs the reason ({n})."
            self.stage("README.md", f"{first}\n{second}\n")
            self.ruling({"README.md": [(1, first, "WRONG"), (2, second, "WRONG")]})
        held = self.reason(self.git_commit())
        for item in self.lineages():
            self.assertIn(f"unlock claim-{item['id']}", held)
            self.unlock(item["id"])
        first, second = "The validator refuses an empty list (3).", "The validator records the reason (3)."
        self.stage("README.md", f"{first}\n{second}\n")
        self.ruling({"README.md": [(1, first, "WRONG"), (2, second, "WRONG")]})
        self.assertEqual(self.counts(), [4, 4])

    def test_words_moved_and_reworded_in_one_step_are_a_new_claim(self):  # C12
        self.at_two("Other text.")
        self.stage("README.md", f"Other text.\n{V[2]}\n")
        self.ruling({"README.md": [(2, V[2], "WRONG")]})
        self.assertEqual(self.counts(), [1])
        [old] = [item for item in self.lineages(ended=True) if item["state"] == "ended"]
        self.assertEqual(old["ended"]["by"], "deleted")

    def test_a_moved_file_starts_again(self):  # C13
        self.at_two()
        git(self.root, "mv", "README.md", "GUIDE.md")
        self.ruling({"GUIDE.md": [(1, V[1], "WRONG")]})
        self.assertEqual((self.counts("GUIDE.md"), self.counts("README.md")), ([1], []))
        self.assertEqual([item["ended"]["by"] for item in self.lineages(ended=True)], ["deleted"])

    def test_a_never_committed_file_removed_from_disk_ends_its_lineages(self):  # C22, FR-010
        self.at_two()
        git(self.root, "rm", "-q", "-f", "README.md")
        self.check_launch()
        [ended] = self.lineages(ended=True)
        self.assertEqual((ended["state"], ended["ended"]["by"]), ("ended", "deleted"))

    def test_a_never_committed_file_unstaged_but_on_disk_keeps_its_lineages(self):  # C21, FR-002
        self.at_two()
        git(self.root, "rm", "-q", "--cached", "README.md")
        self.stage("docs/other.md", "The validator returns True.\n")
        self.ruling({"docs/other.md": [(1, "The validator returns True.", "CORRECT")]})
        self.assertEqual(self.counts(), [2])

    def test_a_reflow_with_the_words_unchanged_keeps_the_lineage(self):  # C14
        self.stage("validator.py", VALIDATOR)
        for text in ("The validator rejects\nan empty list.", "The validator refuses\nan empty list."):
            self.stage("README.md", text + "\n")
            self.ruling({"README.md": [(1, text.replace("\n", " "), "WRONG")]})
        self.stage("README.md", "The validator refuses an\nempty list.\n")
        self.ruling({"README.md": [(1, V[1], "UNSURE")]})
        self.assertEqual(self.counts(), [2])
        self.assertEqual(len(self.lineages()), 1)

    def test_a_split_whose_second_half_is_placed_elsewhere_inherits_only_the_first(self):  # C19
        self.at_two("Other text.")
        first, second = "The validator refuses an empty list.", "It logs the reason."
        self.stage("README.md", f"{first}\nOther text.\n{second}\n")
        self.ruling({"README.md": [(1, first, "UNSURE"), (3, second, "WRONG")]})
        self.assertEqual(self.counts(), [1, 2])

    def test_a_held_claim_moved_unchanged_is_held_before_any_reader_runs(self):  # C23, FR-011
        self.stage("validator.py", VALIDATOR)
        for text in V[:3]:
            self.stage("README.md", f"Intro.\n{text}\nOutro.\n")
            self.ruling({"README.md": [(2, text, "WRONG")]})
        self.stage("README.md", f"Intro.\nOutro.\n{V[2]}\n")
        launched, args = self.check_launch()
        self.assertEqual(self.decision(launched), "deny")
        self.assertIsNone(args)
        for part in (*V[:3], f"unlock claim-{claimcheck.claim_id('README.md', V[0])}", "Stop and ask the user"):
            self.assertIn(part, self.reason(launched))


class ClaimLibraryMissing(ThroughProcess, ClaimGate):
    """The claim check's launch, and a commit that stages a change, refuse naming the install when the diff library
    cannot be imported (X1)."""

    def setUp(self):
        super().setUp()
        self.blocked = Path(self.tmp.name) / "blocked"
        self.blocked.mkdir()
        (self.blocked / "diff_match_patch.py").write_text("raise ImportError('blocked for the test')\n")

    def without_the_library(self):
        self.env["PYTHONPATH"] = str(self.blocked)

    def test_a_missing_library_refuses_the_launch_and_the_commit_and_names_the_install(self):  # X1
        self.stage("README.md", TRUE)
        self.without_the_library()
        for refused in (self.check_launch()[0], self.git_commit()):
            self.assertEqual(self.decision(refused), "deny")
            self.assertIn("could not run", self.reason(refused))
            self.assertRegex(self.reason(refused), INSTALL_COMMAND)

    def test_a_missing_library_is_only_recorded_in_log_mode(self):  # X1
        self.env["ALQ_REVIEW_CLAIM_CHECKS"] = "log"
        self.stage("README.md", TRUE)
        self.without_the_library()
        self.assertNotEqual(self.decision(self.check_launch()[0]), "deny")
        self.assertIn("would_deny", [e["decision"] for e in self.gate_log() if e["action"] == "claim-launch"])


class ClaimLibrary(ClaimGate):
    def test_a_staged_rewrite_past_the_budget_is_not_refused_and_keeps_the_count(self):  # X2
        filler = lambda tag: " ".join(f"{tag}{i}" for i in range(1700))
        self.stage("validator.py", VALIDATOR)
        self.stage("README.md", f"{V[0]} {filler('a')}\n")
        self.ruling({"README.md": [(1, V[0], "WRONG")]})
        [first] = self.lineages()
        self.stage("README.md", f"{V[1]} {filler('b')}\n")
        launched, args = self.check_launch()
        self.assertEqual(self.decision(launched), "allow")
        self.read(args, {"README.md": ("PROSE", [])})
        [kept] = self.lineages()
        self.assertEqual((kept["id"], claimcheck.count(kept)), (first["id"], 1))

    def test_a_rewrite_a_commit_already_holds_is_not_refused_and_keeps_the_count(self):  # C26
        filler = lambda tag: " ".join(f"{tag}{i}" for i in range(1700))
        self.stage("validator.py", VALIDATOR)
        self.stage("README.md", f"{V[0]} {filler('a')}\n")
        self.ruling({"README.md": [(1, V[0], "WRONG")]})
        [first] = self.lineages()
        self.stage("README.md", f"{V[1]} {filler('b')}\n")
        git(self.root, "commit", "-qm", "rewritten outside the gate")
        self.stage("README.md", f"{V[1]} {filler('b')}\nOne more line.\n")
        launched, args = self.check_launch()
        self.assertEqual(self.decision(launched), "allow")
        self.read(args, {"README.md": ("PROSE", [])})
        [kept] = self.lineages()
        self.assertEqual((kept["id"], claimcheck.count(kept)), (first["id"], 1))
        self.assertNotEqual(self.decision(self.git_commit()), "deny")

    def test_a_staged_file_with_a_space_in_its_name_is_followed_under_its_real_path(self):  # C27
        self.stage("validator.py", VALIDATOR)
        self.stage("my notes.md", FALSE)
        self.ruling({"my notes.md": [(1, FALSE.strip(), "WRONG")]})
        [item] = self.lineages("my notes.md")
        self.assertEqual(claimcheck.count(item), 1)

    def test_a_staged_gitlink_has_no_claims_and_the_check_completes(self):  # C28
        (self.root / "vendor" / "sub").mkdir(parents=True)
        head = git(self.root, "rev-parse", "HEAD").strip()
        git(self.root, "update-index", "--add", "--cacheinfo", f"160000,{head},vendor/sub")
        _, args = self.check_launch()
        self.read(args, {"vendor/sub": ("CODE", [])})
        self.assertEqual(self.stored()["status"], "complete")


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
        self.assertIn(f'its WRONG claims: README.md:1 "{FALSE.strip()}" (claim-{cid})', said)
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

    def test_a_contest_of_a_test_claim_is_judged_against_that_test(self):
        name = "test_an_empty_list_is_rejected"
        self.stage("validator.py", VALIDATOR)
        self.stage("tests/test_validator.py", f"def {name}():\n    assert check([]) is False\n")
        _, args = self.check_launch()
        self.read(args, {"tests/test_validator.py": ("MIXED", [(1, name, "K9")]), "validator.py": ("CODE", [])})
        self.judge(args, "tests/test_validator.py", name, evidence="tests/test_validator.py:2")
        cid = claimcheck.claim_id("tests/test_validator.py", name)
        _, contested = self.check_launch(contests=[{"claim": f"claim-{cid}", "evidence": "tests/test_validator.py:2"}])
        [job] = contested["contests"]
        filled = (contested["judges"]["K9"]["prompt"].replace("{{file}}", "tests/test_validator.py")
                  .replace("{{line}}", "1").replace("{{claim}}", name))
        self.assertTrue(job["prompt"].startswith(filled), job["prompt"][:300])


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

    def test_each_judged_category_gets_its_own_judge_prompt(self):
        name = "test_an_empty_list_is_rejected"
        self.stage("validator.py", VALIDATOR)
        self.stage("README.md", FALSE + "\nSee the guide.\n")
        self.stage("tests/test_validator.py", f"def {name}():\n    assert check([]) is False\n")
        _, args = self.check_launch()
        correct = {"verdict": "CORRECT", "basis": "b", "assertions": [{"text": "a", "confirmed": True, "evidence": "x:1"}]}
        ran = self.run_workflow(args, {READER: {
            "README.md": {"kind": "PROSE", "claims": [{"line": 1, "quote": FALSE.strip(), "category": "K1"},
                                                      {"line": 3, "quote": "See the guide.", "category": "K7"}]},
            "tests/test_validator.py": {"kind": "MIXED", "claims": [{"line": 1, "quote": name, "category": "K9"}]},
            "validator.py": {"kind": "CODE", "claims": []}}, JUDGE: correct})
        prompts = {j["schema"]["properties"]["file"]["enum"][0]: j["prompt"] for j in ran["calls"] if j["agentType"] == JUDGE}
        fill = (lambda category, file, line, quote: args["judges"][category]["prompt"].replace("{{file}}", file)
                .replace("{{line}}", str(line)).replace("{{claim}}", quote))
        self.assertEqual(prompts, {"README.md": fill("K1", "README.md", 1, FALSE.strip()),
                                   "tests/test_validator.py": fill("K9", "tests/test_validator.py", 1, name)})
        self.assertEqual(ran["result"]["not_judged_categories"], {"K7": 1})

    def test_the_workflow_names_no_category(self):
        self.assertNotRegex(WORKFLOW.read_text(), r"['\"`]K\d+['\"`]")

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
