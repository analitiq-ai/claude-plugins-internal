"""Drives scripts/gate.py the way Claude Code does: one JSON payload on stdin per hook event."""
import ast
import io
import json
import os
import re
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest import mock

from paths import PLUGIN

from test_worktree_facts import Repo, git

import briefs
import gate
import helpers
import hookio
import ledger
import policy
import test_policy

SCRIPTS = PLUGIN / "scripts"
GATE = SCRIPTS / "gate.py"
REVIEW, ASSESS = "alq-review:review-round", "alq-review:assess-round"


class Gate(Repo):
    mode = "enforce"

    def setUp(self):
        super().setUp()
        self.state_dir = Path(self.tmp.name) / "state"
        self.head = self.commit("b.py", "".join(f"b{i}\n" for i in range(20)), "feat: b")
        self.serve_remote()
        # No network in tests: gh knows the branch's open PR ("<number> <base>", PR 7 by default; empty for none),
        # and, when GH_ISSUE_STATE is set, every issue's state; every other lookup sees a gh that cannot answer.
        stub = Path(self.tmp.name) / "bin"
        stub.mkdir()
        (stub / "gh").write_text('#!/bin/sh\necho "$*" >> "$GH_LOG"\ncase "$*" in\n  "pr list"*) echo "$GH_OPEN_PR" ;;\n'
                                 '  "issue view"*) [ -n "$GH_ISSUE_STATE" ] && echo "$GH_ISSUE_STATE" || exit 1 ;;\n'
                                 '  *) exit 1 ;;\nesac\n')
        (stub / "gh").chmod(0o755)
        self.env = dict(os.environ, ALQ_REVIEW_STATE_DIR=str(self.state_dir), PATH=f"{stub}{os.pathsep}{os.environ['PATH']}",
                        GH_OPEN_PR="7 main", GH_LOG=str(Path(self.tmp.name) / "gh.log"),
                        # The claim and shim checks have their own tests (test_claim_gate.py, test_shim_gate.py); here a
                        # commit is judged by the review alone.
                        ALQ_REVIEW_CLAIM_CHECKS="log", ALQ_REVIEW_SHIM_CHECKS="log")

    def hook(self, event, tool=None, tool_input=None, mode=None, **extra):
        payload = {"hook_event_name": event, "session_id": "s1", "cwd": self.tmp.name, **extra}
        if tool:
            payload = {"tool_use_id": "t0", **payload, "tool_name": tool, "tool_input": tool_input or {}}
        done = subprocess.run([sys.executable, str(GATE)], input=json.dumps(payload), capture_output=True, text=True,
                              env=dict(self.env, ALQ_REVIEW_MODE=mode or self.mode))
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads(done.stdout) if done.stdout.strip() else {}

    def saved(self, repo="acme/demo"):
        """The ledger of the branch's open PR; an empty one when it has none."""
        pr = int(self.env["GH_OPEN_PR"].split()[0]) if self.env["GH_OPEN_PR"] else None
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            return next((s for s in ledger.all_states() if (s["repo"], s["pr"]) == (repo, pr)),
                        ledger.new_state(repo, "feat/1-demo"))

    def decision(self, out):
        return out.get("hookSpecificOutput", {}).get("permissionDecision")

    def reason(self, out):
        return out.get("hookSpecificOutput", {}).get("permissionDecisionReason", "")

    def edit(self, name="b.py", **kw):
        return self.hook("PreToolUse", "Edit", {"file_path": str(self.root / name)}, **kw)

    def launch(self, name=REVIEW, **args):
        if name == REVIEW:
            args = {"spec": None, **args}  # most tests are not about the spec: their PR needs none
        out = self.hook("PreToolUse", "Workflow", {"name": name, "args": {"worktree": str(self.root), **args}})
        return out, out.get("hookSpecificOutput", {}).get("updatedInput", {}).get("args")

    def report(self, reviewer, findings, ref):
        body = {"round_ref": ref, "findings": findings}
        pre = self.hook("PreToolUse", "StructuredOutput", body, agent_id="a1", agent_type=reviewer["type"])
        if self.decision(pre) != "deny":
            self.hook("PostToolUse", "StructuredOutput", body, agent_id="a1", agent_type=reviewer["type"])
        return pre

    def run_reviewers(self, args, findings_for_first):
        reviewers = [r for wave in args["waves"] for r in wave]
        for i, reviewer in enumerate(reviewers):
            self.report(reviewer, findings_for_first if i == 0 else [], args["round_ref"])
        return reviewers

    def assessment(self, ref, ids, verdict="PATCH"):
        brief = subprocess.run([sys.executable, str(SCRIPTS / "briefs.py"), "--ref", ref], env=self.env,
                               capture_output=True, text=True, check=True)
        return {"round_ref": ref, "brief_token": json.loads(brief.stdout)["brief_token"], "round_verdict": verdict,
                "rationale": "x", "next_step": "y",
                "findings": [{"id": i, "verdict": "FIX", "kind": "defect", "spec_ref": "n/a", "mechanism": "m",
                              "reason": "r"} for i in ids]}

    def submit_assessment(self, body):
        pre = self.hook("PreToolUse", "StructuredOutput", body, agent_id="a9", agent_type="alq-review:assessor")
        if self.decision(pre) != "deny":
            self.hook("PostToolUse", "StructuredOutput", body, agent_id="a9", agent_type="alq-review:assessor")
        return pre

    def bash(self, command, session="s1", meanwhile=None):
        """One Bash call as Claude Code makes it: PreToolUse, the command, PostToolUse. `meanwhile` runs while
        the command does, standing for whatever else changes files at that moment."""
        pre = self.hook("PreToolUse", "Bash", {"command": command}, tool_use_id="t1", session_id=session)
        if self.decision(pre) == "deny":
            return pre
        subprocess.run(command, shell=True, cwd=self.tmp.name, check=True)
        if meanwhile:
            meanwhile()
        return self.hook("PostToolUse", "Bash", {"command": command}, tool_use_id="t1", session_id=session,
                         tool_response={})


class InternalRound(Gate):
    def test_whole_round_from_launch_to_unlocked_edit(self):
        out, args = self.launch()
        self.assertEqual(self.decision(out), "allow")
        self.assertEqual([r["type"] for r in args["waves"][0]], briefs.INTERNAL_REVIEWERS)
        self.assertIn(str(self.root), args["waves"][0][0]["prompt"])

        self.assertEqual(self.decision(self.edit()), "deny")

        first = args["waves"][0][0]
        found = [{"id": f"{first['short']}-1", "title": "t", "file": "b.py", "line": 3, "severity": "HIGH", "detail": "d"}]
        self.run_reviewers(args, found)
        blocked = self.edit()
        self.assertEqual(self.decision(blocked), "deny")
        self.assertIn(ASSESS, self.reason(blocked))

        incomplete = self.submit_assessment(self.assessment(args["round_ref"], []))
        self.assertEqual(self.decision(incomplete), "deny")
        unread = dict(self.assessment(args["round_ref"], [found[0]["id"]]), brief_token="guessed")
        self.assertIn("brief", self.reason(self.submit_assessment(unread)))
        self.assertEqual(self.decision(self.edit()), "deny")

        self.submit_assessment(self.assessment(args["round_ref"], [found[0]["id"]]))
        self.assertEqual(self.edit(), {})

    def test_clean_round_never_blocks_and_allows_marking_ready(self):
        _, args = self.launch()
        self.run_reviewers(args, [])
        self.assertEqual(self.edit(), {})
        ready = self.hook("PreToolUse", "Bash", {"command": f"cd {self.root} && gh pr ready"})
        self.assertEqual(ready, {})

    def test_marking_ready_without_a_clean_round_is_refused(self):
        ready = self.hook("PreToolUse", "Bash", {"command": f"cd {self.root} && gh pr ready"})
        self.assertEqual(self.decision(ready), "deny")

    def test_the_internal_review_is_attested_only_once_it_is_clean_at_head(self):
        attest = {"command": f"cd {self.root} && gh pr comment --body '<!-- analitiq-internal-review --> Internal review clean.'"}
        opened = {"command": f"cd {self.root} && gh pr create --title t --body b"}
        self.assertEqual(self.decision(self.hook("PreToolUse", "Bash", attest)), "deny")
        self.assertEqual(self.decision(self.hook("PreToolUse", "Bash", opened)), "deny")
        _, args = self.launch()
        self.run_reviewers(args, [])
        self.assertEqual(self.hook("PreToolUse", "Bash", attest), {})
        self.assertEqual(self.hook("PreToolUse", "Bash", opened), {})

    def test_second_round_is_delta_scoped_and_told_what_was_adjudicated(self):
        _, args = self.launch()
        first = args["waves"][0][0]
        found = [{"id": f"{first['short']}-1", "title": "unchecked None", "file": "b.py", "line": 3,
                  "severity": "HIGH", "detail": "d"}]
        self.run_reviewers(args, found)
        self.submit_assessment(self.assessment(args["round_ref"], [found[0]["id"]]))

        same_head, _ = self.launch()
        self.assertEqual(self.decision(same_head), "deny")

        self.commit("b.py", "fixed\n", "fix: b")
        _, second = self.launch()
        prompt = second["waves"][0][0]["prompt"]
        self.assertIn(f"git diff {self.head}", prompt)
        self.assertIn("unchecked None", prompt)
        self.assertTrue(second["round_ref"].endswith("internal-0.2"))

    def test_a_round_is_measured_from_the_branch_the_pr_merges_into(self):
        git(self.root, "checkout", "-q", "-b", "dev", "main")
        dev = self.commit("d.py", "d\n", "dev work")
        git(self.root, "push", "-q", "origin", "dev")
        git(self.root, "checkout", "-q", "feat/1-demo")
        git(self.root, "merge", "-q", "--no-edit", "dev")
        self.env["GH_OPEN_PR"] = "12 dev"
        _, args = self.launch()
        self.assertIn(f"git diff {dev}...HEAD", args["waves"][0][0]["prompt"])

    def test_a_round_records_the_open_pr_so_its_ledger_knows_it_before_the_poller_does(self):
        self.env["GH_OPEN_PR"] = "12 main"
        _, args = self.launch()
        self.assertEqual(self.saved()["pr"], 12)

    def test_no_round_opens_when_github_cannot_say_which_branch_the_pr_merges_into(self):
        (Path(self.tmp.name) / "bin" / "gh").write_text("#!/bin/sh\nexit 1\n")
        out, _ = self.launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("merges into", self.reason(out))

    def test_in_log_mode_a_launch_whose_round_cannot_open_is_still_denied(self):
        """Log mode lets a launch past a rule it breaks; a launch with no PR, no base or no round to assess has
        nothing to run against, and letting it through would start the workflow without its round."""
        gh = Path(self.tmp.name) / "bin" / "gh"
        stub = gh.read_text()
        cases = {
            "no PR": (REVIEW, lambda: gh.write_text("#!/bin/sh\nexit 1\n"), "merges into"),
            "no base": (REVIEW, lambda: self.env.update(GH_OPEN_PR="7 nosuch"), "nosuch"),
            "nothing to assess": (ASSESS, lambda: None, "awaiting assessment"),
            # A GitHub round is opened by the poller, so its base is first read when its assessment is launched.
            "no base to assess against": (ASSESS, lambda: (
                self.env.update(GH_OPEN_PR="7 nosuch"),
                KeyedByPr.drop(self, 7, "feat/1-demo", "https://github.com/acme/demo/pull/7#discussion_r1")), "nosuch"),
        }
        for case, (name, breaks, named) in cases.items():
            with self.subTest(case):
                gh.write_text(stub)
                self.env["GH_OPEN_PR"] = "7 main"
                breaks()
                out = self.hook("PreToolUse", "Workflow", {"name": name, "args": {"worktree": str(self.root),
                                                                                  "spec": None}}, mode="log")
                self.assertEqual(self.decision(out), "deny")
                self.assertIn(named, self.reason(out))

    def test_launch_without_a_worktree_is_refused_with_the_exact_call(self):
        out = self.hook("PreToolUse", "Workflow", {"name": REVIEW})
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("worktree", self.reason(out))

    def test_reviewer_output_with_duplicate_ids_is_sent_back(self):
        _, args = self.launch()
        first = args["waves"][0][0]
        dup = [{"id": f"{first['short']}-1", "title": "t", "file": "b.py", "severity": "LOW", "detail": "d"}] * 2
        self.assertEqual(self.decision(self.report(first, dup, args["round_ref"])), "deny")

    def test_a_report_naming_another_pr_is_told_its_round_and_writes_no_ledger(self):
        _, args = self.launch()
        reviewer = args["waves"][0][0]
        out = self.report(reviewer, [], "acme/demo#6:internal-0.1")
        self.assertEqual(self.decision(out), "deny")
        self.assertIn(f"round_ref must be {args['round_ref']}", self.reason(out))
        self.assertNotIn("crashed", self.reason(out))
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            self.assertEqual([s["pr"] for s in ledger.all_states()], [7])
        self.assertEqual(self.decision(self.report(reviewer, [], args["round_ref"])), None)

    def test_an_assessment_naming_a_round_that_does_not_exist_is_told_the_round_it_assesses(self):
        _, args = self.launch()
        first = args["waves"][0][0]
        found = [{"id": f"{first['short']}-1", "title": "t", "file": "b.py", "line": 3, "severity": "HIGH", "detail": "d"}]
        self.run_reviewers(args, found)
        body = dict(self.assessment(args["round_ref"], [found[0]["id"]]), round_ref="acme/demo#7:internal-0.3")
        out = self.submit_assessment(body)
        self.assertEqual(self.decision(out), "deny")
        self.assertIn(f"round_ref must be {args['round_ref']}", self.reason(out))
        self.assertNotIn("crashed", self.reason(out))

    def test_a_report_to_a_round_that_no_longer_awaits_it_is_told_the_round_that_does(self):
        _, args = self.launch()
        self.run_reviewers(args, [])
        self.commit("b.py", "changed\n", "fix: b")
        _, second = self.launch()
        out = self.report(second["waves"][0][0], [], args["round_ref"])
        self.assertEqual(self.decision(out), "deny")
        self.assertIn(f"round_ref must be {second['round_ref']}", self.reason(out))

    def test_structured_output_of_unrelated_workflows_is_ignored(self):
        self.assertEqual(self.hook("PreToolUse", "StructuredOutput", {"n": 1}, agent_id="x", agent_type="workflow-subagent"), {})

    def test_audit_round_hands_every_detector_a_delta_scope_packet(self):
        _, args = self.launch(stage="audit")
        self.assertEqual([r["type"] for wave in args["waves"] for r in wave], briefs.AUDIT_WAVES[0] + briefs.AUDIT_WAVES[1])
        packet = args["waves"][0][0]["prompt"]
        for field in ("mode: delta", "baseline:", "read_beyond: yes", "b.py"):
            self.assertIn(field, packet)
        self.assertEqual(args["waves"][1][0]["needs"], "alq-anti-pattern:duplication")


DEMO_STORIES = {1: "Print (Priority: P1)", 2: "Reset (Priority: P2)"}


def demo_spec(lines, stories=(1, 2)):
    """The demo spec.md: what b.py prints, then the headings of `stories`."""
    return f"# Demo\n\nb.py prints {lines} lines.\n" + "".join(
        f"\n### User Story {n} - {DEMO_STORIES[n]}\n\nIt does part {n}.\n" for n in stories)


class SpecArgument(Gate):
    """A review-round launch names the spec folder its PR is reviewed against, or null. The first launch that opens a
    round binds the PR to that value and to its spec.md as HEAD records it; every later launch is held to both."""
    FOLDER, OTHER = "dev/demo/specs/001-demo", "dev/demo/specs/002-other"
    STORY = 2
    SPEC, CHANGED = demo_spec(20), demo_spec(21)
    OTHER_SPEC = "# Another feature\n\n### User Story 2 - Elsewhere (Priority: P1)\n"
    UNBOUND_CALL = ("Workflow(name='alq-review:review-round', args={worktree: '<absolute worktree path>', stage: '%s', "
                    "spec: '<spec folder>', story: <N> | spec: null})")
    GIT_FAILURE = "fatal: simulated: the object store cannot be read"

    def setUp(self):
        super().setUp()
        self.head = self.commit_files({f"{self.FOLDER}/spec.md": self.SPEC, f"{self.OTHER}/spec.md": self.OTHER_SPEC})
        self.bound = self.blob(self.FOLDER)

    def commit_files(self, files, message="docs: spec"):
        for name, text in files.items():
            (self.root / name).parent.mkdir(parents=True, exist_ok=True)
            (self.root / name).write_text(text)
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", message)
        return git(self.root, "rev-parse", "HEAD")

    def blob(self, folder):
        return git(self.root, "rev-parse", f"HEAD:{folder}/spec.md")

    def args_for(self, spec):
        """A launch's arguments for `spec`: the story beside a folder, none beside null."""
        return {"spec": spec} if spec is None else {"spec": spec, "story": self.STORY}

    def launch_with(self, **args):
        """A review-round launch with exactly `args` beside the worktree."""
        out = self.hook("PreToolUse", "Workflow", {"name": REVIEW, "args": {"worktree": str(self.root), **args}})
        return out, out.get("hookSpecificOutput", {}).get("updatedInput", {}).get("args")

    def without_spec(self, stage="internal"):
        return self.hook("PreToolUse", "Workflow", {"name": REVIEW, "args": {"worktree": str(self.root), "stage": stage}})

    def on_pr(self, pr):
        self.env["GH_OPEN_PR"] = f"{pr} main"

    def clean_round(self, spec):
        _, args = self.launch(**self.args_for(spec))
        self.run_reviewers(args, [])
        return args

    def held(self):
        """A PR bound to FOLDER whose spec.md HEAD has since changed; the launch that finds it."""
        self.clean_round(self.FOLDER)
        self.commit_files({f"{self.FOLDER}/spec.md": self.CHANGED}, "docs: change the spec")
        return self.launch(**self.args_for(self.FOLDER))[0]

    def say(self, prompt):
        return HeldBranch.say(self, prompt)

    def graded(self, folder=None, story=None):
        """What an internal reviewer's prompt says of story `story` of the spec `folder`, STORY of FOLDER by default."""
        story = story or self.STORY
        return (f"\n\nThis change implements User Story {story} of the spec in {folder or self.FOLDER}/spec.md of "
                f"{self.root}. Read the whole spec.md, and grade the change against the acceptance scenarios under the "
                f"story's heading, `### User Story {story}`, and every requirement, edge case and success criterion "
                "that applies to that story. Every acceptance scenario of that story that the change does not meet is "
                "a finding: quote the scenario in its title. So is every such requirement, edge case and success "
                "criterion the change does not meet. What the spec excludes bounds what you may ask for. Raise nothing "
                "that only another story of the spec delivers.")

    @staticmethod
    def prompts(out):
        return [r["prompt"] for r in out["hookSpecificOutput"]["updatedInput"]["args"]["waves"][0]]

    def failing_git(self, word):
        """git as the gate runs it, except that any command naming `word` fails as a broken repository would."""
        wrap = Path(self.tmp.name) / "wrap"
        wrap.mkdir(exist_ok=True)
        (wrap / "git").write_text(f'#!/bin/sh\ncase " $* " in *"{word}"*) echo "{self.GIT_FAILURE}" >&2; exit 128 ;; esac\n'
                                  f'exec "{shutil.which("git")}" "$@"\n')
        (wrap / "git").chmod(0o755)
        if not self.env["PATH"].startswith(str(wrap)):
            self.env["PATH"] = f"{wrap}{os.pathsep}{self.env['PATH']}"

    def assertRefused(self, out, *words):
        self.assertEqual(self.decision(out), "deny")
        for word in words:
            self.assertIn(word, self.reason(out))

    def assertNothingBound(self):
        state = self.saved()
        self.assertNotIn("spec", state)
        self.assertNotIn("spec_blob", state)
        self.assertEqual(state["rounds"], [])

    def assertHeldWithTheDiff(self, out):
        self.assertRefused(out, "-b.py prints 20 lines.", "+b.py prints 21 lines.", "`unlock #7`")

    # --- refusals, in the order the gate checks them --------------------------------------------------

    def test_a_launch_with_no_spec_is_refused_naming_the_argument_and_the_full_call(self):
        for stage in ("internal", "audit"):
            with self.subTest(stage=stage):
                out = self.without_spec(stage)
                self.assertRefused(out, "spec", "missing", self.UNBOUND_CALL % stage)
                self.assertNothingBound()

    def test_the_call_given_to_a_bound_pr_names_its_bound_value(self):
        for pr, value, written in ((7, self.FOLDER, f"spec: '{self.FOLDER}', story: {self.STORY}}})"),
                                   (8, None, "spec: null})")):
            with self.subTest(spec=value):
                self.on_pr(pr)
                self.launch(**self.args_for(value))
                out = self.without_spec()
                self.assertRefused(out, written)
                self.assertNotIn("<spec folder>", self.reason(out))

    def test_a_spec_that_is_neither_null_nor_a_folder_path_is_refused_with_the_call(self):
        for value in ("", "  \n", 19, False, [self.FOLDER], {"spec": self.FOLDER}):
            with self.subTest(value=value):
                out, _ = self.launch(spec=value)
                self.assertRefused(out, self.UNBOUND_CALL % "internal")
                self.assertNothingBound()

    def test_a_folder_of_the_wrong_shape_is_refused_naming_the_shape_step_and_its_rule(self):
        cases = {str(self.root / self.FOLDER): "relative", "dev/demo/specs/../specs/001-demo": "..",
                 "dev/demo/plans/001-demo": "specs", "none": "specs"}
        for value, rule in cases.items():
            with self.subTest(value=value):
                out, _ = self.launch(spec=value)
                self.assertRefused(out, "shape", rule)
                self.assertNothingBound()

    def test_a_folder_with_no_spec_md_in_head_is_refused_naming_the_path(self):
        self.commit_files({"dev/demo/specs/003-plan-only/plan.md": "# Plan\n", "dev/demo/specs/004-empty/spec.md": ""})
        (self.root / "dev/demo/specs/005-loose").mkdir()
        (self.root / "dev/demo/specs/005-loose/spec.md").write_text(self.SPEC)
        for folder in ("dev/demo/specs/003-plan-only", "dev/demo/specs/004-empty", "dev/demo/specs/005-loose"):
            with self.subTest(folder=folder):
                out, _ = self.launch(**self.args_for(folder))
                self.assertRefused(out, "spec.md", f"{folder}/spec.md")
                self.assertNothingBound()

    def test_git_failing_while_reading_spec_md_is_a_refusal_naming_the_step_and_gits_error(self):
        self.failing_git("spec.md")
        out, _ = self.launch(**self.args_for(self.FOLDER))
        self.assertRefused(out, "spec.md", self.GIT_FAILURE)
        self.assertNotIn("crashed", self.reason(out))
        self.assertNothingBound()

    def test_a_changed_spec_md_git_cannot_diff_is_held_with_gits_error_until_the_user_unlocks_it(self):
        """The blob ids already show spec.md changed: the diff only shows how, so its failure is still a hold."""
        self.clean_round(self.FOLDER)
        self.commit_files({f"{self.FOLDER}/spec.md": self.CHANGED})
        path = self.env["PATH"]
        self.failing_git(self.bound)
        out, _ = self.launch(**self.args_for(self.FOLDER))
        self.assertRefused(out, self.GIT_FAILURE, "`unlock #7`")
        self.assertNotIn("crashed", self.reason(out))
        state = self.saved()
        self.assertEqual(len(state["rounds"]), 1)
        self.assertEqual({k: state.get("spec_held", {}).get(k) for k in ("bound", "head")},
                         {"bound": self.bound, "head": self.blob(self.FOLDER)})
        self.assertRefused(self.edit(), "`unlock #7`")
        self.env["PATH"] = path
        self.unlock_since_the_hold()
        self.assertEqual(self.decision(self.launch(**self.args_for(self.FOLDER))[0]), "allow")
        self.assertEqual(self.saved()["spec_blob"], self.blob(self.FOLDER))

    def test_a_changed_spec_md_that_is_not_utf8_is_held_with_its_diff_and_binds_once_unlocked(self):
        self.clean_round(self.FOLDER)
        (self.root / self.FOLDER / "spec.md").write_bytes(b"# Demo\n\ncaf\xe9\n\n### User Story 2 - Reset\n")
        git(self.root, "commit", "-qam", "docs: a Latin-1 spec")
        out, _ = self.launch(**self.args_for(self.FOLDER))
        self.assertRefused(out, "+caf\udce9", "`unlock #7`")
        self.assertEqual(self.saved().get("spec_held", {}).get("head"), self.blob(self.FOLDER))
        self.unlock_since_the_hold()
        self.assertEqual(self.decision(self.launch(**self.args_for(self.FOLDER))[0]), "allow")
        self.assertEqual(self.saved()["spec_blob"], self.blob(self.FOLDER))

    def test_a_value_other_than_the_bound_one_is_refused_for_the_binding_before_its_spec_md_is_read(self):
        """The binding is the fault: a refusal for the other folder's spec.md would tell the agent to commit one."""
        gone = "dev/demo/specs/009-gone"
        for pr, bound in enumerate((self.FOLDER, None), 7):
            with self.subTest(bound=bound):
                self.on_pr(pr)
                self.launch(**self.args_for(bound))
                out, _ = self.launch(**self.args_for(gone))
                self.assertRefused(out, bound or "null", gone, "never changes")
                self.assertNotIn('Step "spec.md"', self.reason(out))

    def test_a_value_other_than_the_bound_one_is_refused_naming_both_and_the_binding_stays(self):
        for pr, (bound, given) in enumerate(((self.FOLDER, self.OTHER), (self.FOLDER, None), (None, self.FOLDER)), 7):
            with self.subTest(bound=bound, given=given):
                self.on_pr(pr)
                self.launch(**self.args_for(bound))
                out, _ = self.launch(**self.args_for(given))
                self.assertRefused(out, bound or "null", given or "null", "never changes")
                self.assertEqual(self.saved()["spec"], bound)
                self.assertEqual(len(self.saved()["rounds"]), 1)

    def test_a_misspelled_bound_folder_is_refused_for_its_shape_not_the_binding(self):
        self.launch(**self.args_for(self.FOLDER))
        out, _ = self.launch(**self.args_for(f"./{self.FOLDER}"))
        self.assertRefused(out, 'Step "shape"', f"write it as {self.FOLDER}")
        self.assertNotIn("never changes", self.reason(out))

    # --- the story (spec 81) -------------------------------------------------------------------------

    UNBOUND = "spec: '<spec folder>', story: <N> | spec: null"

    def test_a_folder_and_a_story_its_spec_md_has_open_the_round_and_bind_all_three(self):
        """Scenario 1."""
        out, _ = self.launch_with(spec=self.FOLDER, story=2)
        self.assertEqual(self.decision(out), "allow")
        state = self.saved()
        self.assertEqual((state["spec"], state["story"], state["spec_blob"]), (self.FOLDER, 2, self.bound))

    def test_each_row_of_the_arguments_table_has_its_outcome(self):
        """Scenario 2: the spec's arguments table, row by row, each on a PR no launch has bound."""
        rows = (({"spec": self.FOLDER, "story": 2}, None),
                ({"spec": self.FOLDER}, "a spec folder needs a story"),
                ({"spec": self.FOLDER, "story": None}, "a spec folder needs a story"),
                ({"spec": self.FOLDER, "story": 0}, "the story is 1 or more"),
                ({"spec": self.FOLDER, "story": -1}, "the story is 1 or more"),
                ({"spec": self.FOLDER, "story": "2"}, "the story is a JSON integer"),
                ({"spec": self.FOLDER, "story": 2.5}, "the story is a JSON integer"),
                ({"spec": self.FOLDER, "story": True}, "the story is a JSON integer"),
                ({"spec": None}, None),
                ({"spec": None, "story": None}, "no spec has no story"),
                ({"spec": None, "story": 2}, "no spec has no story"),
                ({"story": 2}, "args.spec is missing"),
                ({"spec": "dev/demo/plans/001-demo"}, 'Step "shape"'))
        for pr, (args, refusal) in enumerate(rows, 40):
            with self.subTest(args=args):
                self.on_pr(pr)
                out, _ = self.launch_with(**args)
                if refusal is None:
                    self.assertEqual(self.decision(out), "allow")
                    continue
                self.assertRefused(out, refusal, self.UNBOUND_CALL % "internal")
                self.assertNothingBound()

    def test_beside_null_a_story_is_refused_for_being_there_before_its_form_or_the_binding_is_judged(self):
        """The null rule wins over the story's form, and the story is checked before the binding."""
        for story in (None, 2, "2", 0, True, 2.5):
            with self.subTest(story=story):
                out, _ = self.launch_with(spec=None, story=story)
                self.assertRefused(out, "no spec has no story")
                for other in ("JSON integer", "1 or more", "never changes"):
                    self.assertNotIn(other, self.reason(out))
        self.launch_with(spec=self.FOLDER, story=2)
        out, _ = self.launch_with(spec=None, story="2")
        self.assertRefused(out, "no spec has no story", f"spec: '{self.FOLDER}', story: 2}})")
        self.assertNotIn("never changes", self.reason(out))

    def test_a_story_with_no_heading_in_spec_md_is_refused_naming_the_heading_it_looked_for(self):
        """Scenario 3, on a review round."""
        out, _ = self.launch_with(spec=self.FOLDER, story=3)
        self.assertRefused(out, 'Step "story"', f"{self.FOLDER}/spec.md", "`### User Story 3`",
                           self.UNBOUND_CALL % "internal")
        self.assertNothingBound()

    def test_the_story_number_ends_at_a_word_boundary(self):
        """Scenario 3: `### User Story 12` is no heading for 1; `### User Story 1: Sign in` is one."""
        twelve, colon = "dev/demo/specs/003-twelve", "dev/demo/specs/004-colon"
        self.commit_files({f"{twelve}/spec.md": "# Twelve\n\n### User Story 12 - Late (Priority: P3)\n",
                           f"{colon}/spec.md": "# Colon\n\n### User Story 1: Sign in\n"})
        out, _ = self.launch_with(spec=twelve, story=1)
        self.assertRefused(out, 'Step "story"', "`### User Story 1`")
        self.assertNothingBound()
        self.on_pr(8)
        self.assertEqual(self.decision(self.launch_with(spec=colon, story=1)[0]), "allow")

    def test_a_heading_inside_a_fenced_code_block_counts(self):
        """Edge case: the gate does not parse Markdown."""
        fenced = "dev/demo/specs/003-fenced"
        self.commit_files({f"{fenced}/spec.md": "# Fenced\n\n```markdown\n### User Story 1 - Quoted\n```\n"})
        self.assertEqual(self.decision(self.launch_with(spec=fenced, story=1)[0]), "allow")
        self.assertEqual(self.saved()["story"], 1)

    def test_a_launch_with_arguments_other_than_the_bound_ones_is_refused_naming_the_bound_launch(self):
        """Scenarios 4 and 11: the refusal names the bound arguments, as the launch to make."""
        cases = (({"spec": self.FOLDER, "story": 2}, {"spec": self.FOLDER, "story": 1},
                  f"spec: '{self.FOLDER}', story: 2}})"),
                 ({"spec": self.FOLDER, "story": 2}, {"spec": self.OTHER, "story": 2},
                  f"spec: '{self.FOLDER}', story: 2}})"),
                 ({"spec": self.FOLDER, "story": 2}, {"spec": None}, f"spec: '{self.FOLDER}', story: 2}})"),
                 ({"spec": None}, {"spec": self.FOLDER, "story": 2}, "spec: null})"))
        for pr, (bound, given, call) in enumerate(cases, 7):
            with self.subTest(bound=bound, given=given):
                self.on_pr(pr)
                self.assertEqual(self.decision(self.launch_with(**bound)[0]), "allow")
                out, _ = self.launch_with(**given)
                self.assertRefused(out, "never changes", call)
                self.assertNotIn("<spec folder>", self.reason(out))
                self.assertEqual(self.saved()["spec"], bound["spec"])
                self.assertEqual(self.saved().get("story"), bound.get("story"))
                self.assertEqual(len(self.saved()["rounds"]), 1)

    def test_a_bound_folder_launched_with_no_story_is_refused_naming_the_bound_launch(self):
        """Scenario 11: the story is checked before the binding, and its refusal names the bound launch."""
        self.launch_with(spec=self.FOLDER, story=2)
        out, _ = self.launch_with(spec=self.FOLDER)
        self.assertRefused(out, "a spec folder needs a story", f"spec: '{self.FOLDER}', story: 2}})")

    def test_internal_reviewers_are_named_the_bound_story_and_no_other(self):
        """Scenario 6 and SC-002: the prompt names `### User Story 2` and no other story of a spec.md that has two,
        and tells the reviewer to read the whole spec.md and grade what applies to that story."""
        _, args = self.launch_with(spec=self.FOLDER, story=2)
        for reviewer in args["waves"][0]:
            with self.subTest(reviewer=reviewer["type"]):
                prompt = reviewer["prompt"]
                self.assertIn(self.graded(story=2), prompt)
                self.assertEqual(set(re.findall(r"User Story (\d+)", prompt)), {"2"})

    def test_an_audit_launch_names_spec_and_story_and_is_checked_like_a_review_round(self):
        """Edge case: the audit's reviewers still get no spec."""
        for args, refusal in (({"spec": self.FOLDER}, "a spec folder needs a story"),
                              ({"spec": self.FOLDER, "story": 3}, "`### User Story 3`"),
                              ({"spec": None, "story": 2}, "no spec has no story")):
            with self.subTest(args=args):
                out, _ = self.launch_with(stage="audit", **args)
                self.assertRefused(out, refusal, self.UNBOUND_CALL % "audit")
                self.assertNothingBound()
        out, args = self.launch_with(stage="audit", spec=self.FOLDER, story=2)
        self.assertEqual(self.decision(out), "allow")
        self.assertEqual(self.saved()["story"], 2)
        for prompt in (r["prompt"] for wave in args["waves"] for r in wave):
            self.assertNotIn("User Story", prompt)

    def test_the_assessor_brief_of_an_unbound_pr_gives_no_folder_and_no_story(self):
        """Scenario 7, not yet bound: only a launch refused in log mode opens a round on an unbound PR."""
        self.mode = "log"
        out = self.without_spec()
        args = out["hookSpecificOutput"]["updatedInput"]["args"]
        first = args["waves"][0][0]
        self.run_reviewers(args, [{"id": f"{first['short']}-1", "title": "t", "file": "b.py", "line": 3,
                                   "severity": "HIGH", "detail": "d"}])
        self.assertEqual(self.decision(self.launch(ASSESS)[0]), "allow")
        brief = self.brief(args["round_ref"])
        self.assertEqual((brief["spec_folder"], brief["user_story"]), (None, None))

    def test_a_held_launch_and_a_held_edit_name_the_spec_md_the_story_and_the_change(self):
        """Scenario 8."""
        out = self.held()
        self.assertHeldWithTheDiff(out)
        self.assertRefused(out, f"{self.FOLDER}/spec.md", "User Story 2")
        edit = self.edit()
        self.assertRefused(edit, f"{self.FOLDER}/spec.md", "User Story 2", f"git diff {self.bound} {self.blob(self.FOLDER)}")

    def without_the_story_heading(self):
        """A PR bound to story 2 of FOLDER whose spec.md change also removed that story's heading."""
        self.clean_round(self.FOLDER)
        self.commit_files({f"{self.FOLDER}/spec.md": demo_spec(21, stories=(1,))}, "docs: drop story 2")
        return self.launch_with(spec=self.FOLDER, story=2)[0]

    def test_a_change_that_removed_the_heading_is_held_for_the_change_not_refused_for_the_heading(self):
        """Scenario 9: the user sees the change, and which story's spec it is."""
        out = self.without_the_story_heading()
        self.assertHeldWithTheDiff(out)
        # Named before the diff, which also shows the heading it removed.
        self.assertIn("User Story 2", self.reason(out).splitlines()[0])
        self.assertIn("-### User Story 2 - Reset (Priority: P2)", self.reason(out))
        self.assertNotIn('Step "story"', self.reason(out))
        self.assertIn("spec_held", self.saved())

    def test_after_the_unlock_the_heading_committed_back_opens_the_round_with_no_second_unlock(self):
        """Scenario 10: a launch refused for the heading in between keeps the hold's release, and binds nothing."""
        self.without_the_story_heading()
        self.unlock_since_the_hold()
        held = self.saved()["spec_held"]
        out, _ = self.launch_with(spec=self.FOLDER, story=2)
        self.assertRefused(out, 'Step "story"', "`### User Story 2`", f"spec: '{self.FOLDER}', story: 2}})")
        self.assertEqual(self.saved()["spec_held"], held)
        self.assertEqual(self.saved()["spec_blob"], self.bound)
        self.commit_files({f"{self.FOLDER}/spec.md": demo_spec(21)}, "docs: put story 2 back")
        out, _ = self.launch_with(spec=self.FOLDER, story=2)
        self.assertEqual(self.decision(out), "allow")
        state = self.saved()
        self.assertNotIn("spec_held", state)
        self.assertEqual((state["spec_blob"], state["story"]), (self.blob(self.FOLDER), 2))

    def test_an_assess_launch_checks_the_bound_storys_heading_after_the_hold(self):
        """Scenario 3 on an assess round: the bound story's heading, at the commit it checks, after the hold."""
        args = self.awaiting_assessment(self.FOLDER)
        self.commit_files({f"{self.FOLDER}/spec.md": demo_spec(21, stories=(1,))}, "docs: drop story 2")
        out, _ = self.launch(ASSESS)
        self.assertHeldWithTheDiff(out)
        self.assertNotIn('Step "story"', self.reason(out))
        self.unlock_since_the_hold()
        out, _ = self.launch(ASSESS)
        # A round awaiting assessment lets no agent commit, so the refusal cannot tell the agent to commit the heading.
        self.assertRefused(out, 'Step "story"', f"{self.FOLDER}/spec.md", "`### User Story 2`", "stop and ask the user")
        self.assertEqual(ledger.current_round(self.saved())["ref"], args["round_ref"])

    def test_an_assess_launch_of_a_pr_bound_to_null_checks_no_heading(self):
        self.awaiting_assessment(None)
        self.assertEqual(self.decision(self.launch(ASSESS)[0]), "allow")

    def test_in_log_mode_a_story_refusal_is_logged_the_round_opens_and_nothing_is_bound(self):
        self.mode = "log"
        cases = {"no story": ({"spec": self.FOLDER}, ["a spec folder needs a story"]),
                 "not an integer": ({"spec": self.FOLDER, "story": "2"}, ["the story is a JSON integer"]),
                 "no heading": ({"spec": self.FOLDER, "story": 3}, ["`### User Story 3`"]),
                 "story beside null": ({"spec": None, "story": 2}, ["no spec has no story"])}
        for pr, (name, (args, words)) in enumerate(cases.items(), 31):
            with self.subTest(name):
                self.on_pr(pr)
                out = self.refused_in_log_mode(lambda: self.launch_with(**args)[0], words + [self.UNBOUND_CALL % "internal"])
                self.assertNotIn("spec", self.saved())
                for prompt in self.prompts(out):
                    self.assertNotIn("User Story", prompt)

    def test_in_log_mode_a_missing_heading_after_an_unlock_keeps_the_binding_and_the_hold(self):
        self.without_the_story_heading()
        self.unlock_since_the_hold()
        held = self.saved()["spec_held"]
        self.mode = "log"
        self.refused_in_log_mode(lambda: self.launch_with(spec=self.FOLDER, story=2)[0], ["`### User Story 2`"])
        state = self.saved()
        self.assertEqual((state["spec_blob"], state["story"], state["spec_held"]), (self.bound, 2, held))

    # --- the binding ---------------------------------------------------------------------------------

    def test_a_branch_whose_name_holds_no_issue_number_binds_the_folder_it_is_given(self):
        git(self.root, "checkout", "-q", "-b", "chore/tidy")
        self.on_pr(30)
        out, args = self.launch(**self.args_for(self.FOLDER))
        self.assertEqual(self.decision(out), "allow")
        self.assertEqual((self.saved()["spec"], self.saved()["spec_blob"]), (self.FOLDER, self.bound))
        self.assertIn(self.graded(), args["waves"][0][0]["prompt"])

    def test_the_first_launch_that_opens_a_round_binds_the_folder_and_its_spec_md(self):
        out, _ = self.launch(spec=f"  {self.FOLDER}\n", story=self.STORY)
        self.assertEqual(self.decision(out), "allow")
        self.assertEqual((self.saved()["spec"], self.saved()["story"], self.saved()["spec_blob"]),
                         (self.FOLDER, self.STORY, self.bound))

    def test_a_first_launch_refused_by_another_rule_binds_nothing(self):
        (self.root / "b.py").write_text("uncommitted\n")
        out, _ = self.launch(**self.args_for(self.FOLDER))
        self.assertRefused(out, "uncommitted")
        self.assertNothingBound()
        git(self.root, "checkout", "--", "b.py")
        self.assertEqual(self.decision(self.launch(**self.args_for(self.OTHER))[0]), "allow")
        self.assertEqual(self.saved()["spec"], self.OTHER)

    def test_a_launch_reads_nothing_from_the_issue(self):
        self.assertEqual(self.decision(self.launch(**self.args_for(self.FOLDER))[0]), "allow")
        asked = Path(self.env["GH_LOG"]).read_text()
        self.assertNotIn("issue", asked)
        self.assertNotIn("comments", asked)
        # The caller gives the story; the PR body's `Implements:` line is not read for it (ADR-0019, decision 1).
        self.assertNotIn("body", asked)
        self.assertNotIn("pr view", asked)

    def logging_git(self):
        """git as the gate runs it, each command's arguments appended to the returned log."""
        log, wrap = Path(self.tmp.name) / "git.log", Path(self.tmp.name) / "logged"
        wrap.mkdir()
        (wrap / "git").write_text(f'#!/bin/sh\necho "$*" >> "{log}"\nexec "{shutil.which("git")}" "$@"\n')
        (wrap / "git").chmod(0o755)
        self.env["PATH"] = f"{wrap}{os.pathsep}{self.env['PATH']}"
        return log

    def test_a_launch_reads_spec_md_at_its_rounds_head_and_never_reads_the_bound_text(self):
        log = self.logging_git()
        self.clean_round(self.FOLDER)
        self.commit("b.py", "fixed\n", "fix: b")
        self.assertEqual(self.decision(self.launch(**self.args_for(self.FOLDER))[0]), "allow")
        ran = log.read_text().splitlines()
        for rnd in self.saved()["rounds"]:
            self.assertTrue([line for line in ran if rnd["head_sha"] in line and f"{self.FOLDER}/spec.md" in line], ran)
        self.assertEqual([line for line in ran if "spec.md" in line and "HEAD" in line], [])
        self.assertNotIn(self.bound, "\n".join(ran))

    def test_the_same_value_again_opens_the_next_round_graded_against_the_bound_spec(self):
        self.clean_round(self.FOLDER)
        self.commit("b.py", "fixed\n", "fix: b")
        out, args = self.launch(**self.args_for(self.FOLDER))
        self.assertEqual(self.decision(out), "allow")
        self.assertTrue(args["round_ref"].endswith("internal-0.2"))
        for reviewer in args["waves"][0]:
            with self.subTest(reviewer=reviewer["type"]):
                self.assertIn(self.graded(), reviewer["prompt"])

    def test_the_same_value_with_spec_md_since_deleted_in_head_is_refused_naming_it(self):
        self.clean_round(self.FOLDER)
        git(self.root, "rm", "-q", f"{self.FOLDER}/spec.md")
        git(self.root, "commit", "-q", "-m", "docs: drop the spec")
        out, _ = self.launch(**self.args_for(self.FOLDER))
        self.assertRefused(out, "spec.md", f"{self.FOLDER}/spec.md")
        self.assertEqual(len(self.saved()["rounds"]), 1)

    def test_two_prs_on_one_issue_are_each_reviewed_against_their_own_folder(self):
        _, first = self.launch(**self.args_for(self.FOLDER))
        git(self.root, "checkout", "-q", "-b", "feat/1-second", "main")
        self.commit_files({f"{self.OTHER}/spec.md": self.OTHER_SPEC})
        self.on_pr(8)
        _, second = self.launch(**self.args_for(self.OTHER))
        self.assertIn(f"{self.FOLDER}/spec.md", first["waves"][0][0]["prompt"])
        self.assertIn(f"{self.OTHER}/spec.md", second["waves"][0][0]["prompt"])
        self.assertNotIn(self.FOLDER, second["waves"][0][0]["prompt"])
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            bound = {s["pr"]: s["spec"] for s in ledger.all_states()}
        self.assertEqual(bound, {7: self.FOLDER, 8: self.OTHER})

    def expected_prompt(self, reviewer, graded):
        main = git(self.root, "rev-parse", "main")
        return (f"Review branch feat/1-demo of acme/demo.\nIn {self.root}, run: git diff {main}...HEAD\n"
                "That is the whole change under review.\n\n"
                "Report only what must change before this merges: a defect, a broken contract, a violated project "
                "rule. No style preferences, no praise, no summary. An empty findings list is a normal and expected "
                f"answer.{graded}\n\nAnswer through StructuredOutput, numbering findings {reviewer}-1, {reviewer}-2, ...")

    def test_null_opens_a_round_with_no_spec_and_binds_null(self):
        out, args = self.launch(spec=None)
        self.assertEqual(self.decision(out), "allow")
        no_spec = ("\n\nThe caller says this change needs no spec. Raise no finding about an unmet requirement of a "
                   "spec.")
        self.assertEqual([r["prompt"] for r in args["waves"][0]],
                         [self.expected_prompt(r["short"], no_spec) for r in args["waves"][0]])
        self.assertEqual((self.saved()["spec"], self.saved()["spec_blob"]), (None, None))
        self.assertNotIn("story", self.saved())

    # --- a changed spec.md holds the PR -------------------------------------------------------------

    def test_a_changed_spec_md_refuses_the_launch_with_the_diff_and_records_the_hold(self):
        out = self.held()
        self.assertHeldWithTheDiff(out)
        state = self.saved()
        self.assertEqual({k: state["spec_held"][k] for k in ("bound", "head")},
                         {"bound": self.bound, "head": self.blob(self.FOLDER)})
        self.assertIsInstance(state["spec_held"]["at"], str)
        self.assertEqual(state["spec_blob"], self.bound)
        self.assertEqual(len(state["rounds"]), 1)

    def test_the_diff_a_hold_shows_is_the_one_git_makes_whatever_the_users_diff_config(self):
        for key, value in (("color.ui", "always"), ("diff.external", "echo rewritten"), ("diff.context", "0"),
                           ("diff.suppressBlankEmpty", "true")):
            git(self.root, "config", key, value)
        out = self.held()
        self.assertHeldWithTheDiff(out)
        self.assertIn("\n # Demo\n \n-b.py prints 20 lines.\n", self.reason(out))
        self.assertNotIn("\x1b", self.reason(out))

    def test_a_held_pr_refuses_edits_and_git_moves_with_the_lock_reason(self):
        self.held()
        edit = self.edit()
        self.assertRefused(edit, "`unlock #7`", self.FOLDER)
        commit = self.hook("PreToolUse", "Bash", {"command": "git commit -qam x"}, cwd=str(self.root))
        self.assertRefused(commit, "`unlock #7`")

    def test_a_launch_while_held_is_refused_again_and_keeps_the_first_hold(self):
        self.held()
        first = self.saved()["spec_held"]
        self.commit_files({f"{self.FOLDER}/spec.md": demo_spec(22)}, "docs: change it again")
        out, _ = self.launch(**self.args_for(self.FOLDER))
        self.assertRefused(out, "+b.py prints 22 lines.", "`unlock #7`")
        self.assertEqual(self.saved()["spec_held"], first)

    def unlock_since_the_hold(self):
        # Ledger stamps are to the second: the hold is dated earlier, so the unlock comes after it as a user's would.
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_ledger("acme/demo", 7) as state:
                state["spec_held"]["at"] = ledger.stamp(helpers.T0)
        self.assertIn("The user unlocked acme/demo#7", self.say("unlock #7"))

    def test_an_unlock_lets_the_next_launch_open_and_bind_heads_spec_md_whatever_it_is_then(self):
        self.held()
        self.unlock_since_the_hold()
        self.commit_files({f"{self.FOLDER}/spec.md": demo_spec(22)}, "docs: change it again")
        out, _ = self.launch(**self.args_for(self.FOLDER))
        self.assertEqual(self.decision(out), "allow")
        state = self.saved()
        self.assertEqual(state["spec_blob"], self.blob(self.FOLDER))
        self.assertNotIn("spec_held", state)

    def test_a_change_after_the_unlocked_one_is_held_again(self):
        self.held()
        self.unlock_since_the_hold()
        self.run_reviewers(self.launch(**self.args_for(self.FOLDER))[1], [])
        self.commit_files({f"{self.FOLDER}/spec.md": demo_spec(22)})
        out, _ = self.launch(**self.args_for(self.FOLDER))
        self.assertRefused(out, "-b.py prints 21 lines.", "+b.py prints 22 lines.", "`unlock #7`")

    def test_a_rescope_after_a_reshape_spec_unlock_needs_its_own_unlock(self):
        _, args = self.launch(**self.args_for(self.FOLDER))
        first = args["waves"][0][0]
        self.run_reviewers(args, [{"id": f"{first['short']}-1", "title": "t", "file": "b.py", "line": 3,
                                   "severity": "HIGH", "detail": "d"}])
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_ledger("acme/demo", 7) as state:
                helpers.assess(state, "RESHAPE_SPEC")
        self.assertIn("The user unlocked acme/demo#7", self.say("unlock #7"))
        self.commit_files({f"{self.FOLDER}/spec.md": self.CHANGED}, "docs: rescope")
        out, _ = self.launch(**self.args_for(self.FOLDER))
        self.assertHeldWithTheDiff(out)
        self.assertIn("spec_held", self.saved())

    # --- what reviewers and the assessor are given ----------------------------------------------------

    def test_every_internal_reviewer_is_given_the_path_of_spec_md_and_none_of_its_text(self):
        """The whole prompt is pinned: it quotes nothing of spec.md and names no heading of it but the story's."""
        _, args = self.launch(**self.args_for(self.FOLDER))
        self.assertEqual([[r["type"] for r in wave] for wave in args["waves"]], [briefs.INTERNAL_REVIEWERS])
        self.assertEqual([r["prompt"] for r in args["waves"][0]],
                         [self.expected_prompt(r["short"], self.graded()) for r in args["waves"][0]])

    def test_audit_reviewers_are_not_pointed_at_the_spec(self):
        _, args = self.launch(**self.args_for(self.FOLDER), stage="audit")
        prompts = [r["prompt"] for wave in args["waves"] for r in wave]
        self.assertEqual(len(prompts), sum(len(wave) for wave in briefs.AUDIT_WAVES))
        for prompt in prompts:
            self.assertNotIn("This change implements the spec", prompt)

    def awaiting_assessment(self, spec):
        _, args = self.launch(**self.args_for(spec))
        first = args["waves"][0][0]
        self.run_reviewers(args, [{"id": f"{first['short']}-1", "title": "t", "file": "b.py", "line": 3,
                                   "severity": "HIGH", "detail": "d"}])
        return args

    def brief(self, ref):
        done = subprocess.run([sys.executable, str(SCRIPTS / "briefs.py"), "--ref", ref], env=self.env,
                              capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads(done.stdout)

    def test_the_assessor_brief_gives_the_bound_folder_and_quotes_nothing_with_no_spec_argument_on_the_assess_launch(self):
        args = self.awaiting_assessment(self.FOLDER)
        out, _ = self.launch(ASSESS)
        self.assertEqual(self.decision(out), "allow")
        brief = self.brief(args["round_ref"])
        self.assertEqual((brief["spec_folder"], brief["user_story"]), (self.FOLDER, self.STORY))
        self.assertNotIn("b.py prints 20 lines.", json.dumps(brief))

    def test_a_second_assess_launch_after_spec_md_changed_is_refused_with_the_diff_and_holds_the_pr(self):
        args = self.awaiting_assessment(self.FOLDER)
        self.assertEqual(self.decision(self.launch(ASSESS)[0]), "allow")
        self.commit_files({f"{self.FOLDER}/spec.md": self.CHANGED}, "docs: change the spec")
        out, _ = self.launch(ASSESS)
        self.assertHeldWithTheDiff(out)
        state = self.saved()
        self.assertEqual({k: state.get("spec_held", {}).get(k) for k in ("bound", "head")},
                         {"bound": self.bound, "head": self.blob(self.FOLDER)})
        self.assertEqual(state["spec_blob"], self.bound)
        self.assertEqual(ledger.current_round(state)["ref"], args["round_ref"])

    def test_a_github_round_assess_launch_after_spec_md_changed_is_held_until_an_unlock_binds_heads_text(self):
        self.clean_round(self.FOLDER)
        self.commit_files({f"{self.FOLDER}/spec.md": self.CHANGED}, "docs: change the spec")
        KeyedByPr.drop(self, 7, "feat/1-demo", "https://github.com/acme/demo/pull/7#discussion_r1")
        out, _ = self.launch(ASSESS)
        self.assertHeldWithTheDiff(out)
        self.assertEqual(self.saved().get("spec_held", {}).get("head"), self.blob(self.FOLDER))
        self.unlock_since_the_hold()
        self.assertEqual(self.decision(self.launch(ASSESS)[0]), "allow")
        self.assertEqual(self.saved()["spec_blob"], self.blob(self.FOLDER))

    def test_the_unlock_an_assess_launch_binds_with_is_spent_so_a_later_change_is_held_again(self):
        self.clean_round(self.FOLDER)
        self.commit_files({f"{self.FOLDER}/spec.md": self.CHANGED}, "docs: change the spec")
        KeyedByPr.drop(self, 7, "feat/1-demo", "https://github.com/acme/demo/pull/7#discussion_r1")
        self.launch(ASSESS)
        self.unlock_since_the_hold()
        self.assertEqual(self.decision(self.launch(ASSESS)[0]), "allow")
        self.assertNotIn("spec_held", self.saved())
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_ledger("acme/demo", 7) as state:
                helpers.assess(state, "PATCH")
        self.commit_files({f"{self.FOLDER}/spec.md": demo_spec(22)}, "docs: change it again")
        out, _ = self.launch(**self.args_for(self.FOLDER))
        self.assertRefused(out, "-b.py prints 21 lines.", "+b.py prints 22 lines.", "`unlock #7`")

    def test_an_assess_launch_after_an_unlock_with_spec_md_back_to_the_bound_text_clears_the_hold(self):
        """Else the released hold outlives the launch, and the next change binds with no hold."""
        self.clean_round(self.FOLDER)
        self.commit_files({f"{self.FOLDER}/spec.md": self.CHANGED}, "docs: change the spec")
        KeyedByPr.drop(self, 7, "feat/1-demo", "https://github.com/acme/demo/pull/7#discussion_r1")
        self.launch(ASSESS)
        self.unlock_since_the_hold()
        self.commit_files({f"{self.FOLDER}/spec.md": self.SPEC}, "docs: put the spec back")
        self.assertEqual(self.decision(self.launch(ASSESS)[0]), "allow")
        self.assertNotIn("spec_held", self.saved())
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_ledger("acme/demo", 7) as state:
                helpers.assess(state, "PATCH")
        self.commit_files({f"{self.FOLDER}/spec.md": self.CHANGED}, "docs: change it again")
        self.assertHeldWithTheDiff(self.launch(**self.args_for(self.FOLDER))[0])

    def test_an_assess_launch_whose_bound_spec_md_is_gone_or_unreadable_is_refused_and_sent_to_the_user(self):
        """A round awaiting assessment lets no agent commit, so the refusal cannot tell the agent to commit it."""
        self.awaiting_assessment(self.FOLDER)
        path = self.env["PATH"]
        self.failing_git("spec.md")
        out, _ = self.launch(ASSESS)
        self.assertRefused(out, 'Step "spec.md"', self.GIT_FAILURE)
        self.env["PATH"] = path
        git(self.root, "rm", "-q", f"{self.FOLDER}/spec.md")
        git(self.root, "commit", "-q", "-m", "docs: drop the spec")
        out, _ = self.launch(ASSESS)
        self.assertRefused(out, 'Step "spec.md"', f"{self.FOLDER}/spec.md", "the user")
        self.assertNotIn("commit it", self.reason(out))

    def test_in_log_mode_an_assess_launch_after_spec_md_changed_is_logged_and_holds_nothing(self):
        self.awaiting_assessment(self.FOLDER)
        self.commit_files({f"{self.FOLDER}/spec.md": self.CHANGED}, "docs: change the spec")
        self.mode = "log"
        log = self.state_dir / "gate.log"
        seen = len(log.read_text().splitlines())
        self.assertEqual(self.decision(self.launch(ASSESS)[0]), "allow")
        logged = [json.loads(line) for line in log.read_text().splitlines()[seen:]]
        refused = [e for e in logged if e["decision"] == "would_deny"]
        self.assertTrue(refused, logged)
        self.assertIn("+b.py prints 21 lines.", refused[0]["reason"])
        state = self.saved()
        self.assertNotIn("spec_held", state)
        self.assertEqual(state["spec_blob"], self.bound)

    def test_the_assessor_brief_of_a_pr_bound_to_null_gives_no_spec_folder(self):
        args = self.awaiting_assessment(None)
        self.assertEqual(self.decision(self.launch(ASSESS)[0]), "allow")
        brief = self.brief(args["round_ref"])
        self.assertEqual((brief["spec_folder"], brief["user_story"]), (None, None))

    # --- log mode ---------------------------------------------------------------------------------------

    def refused_in_log_mode(self, launch, words):
        log = self.state_dir / "gate.log"
        seen = len(log.read_text().splitlines()) if log.exists() else 0
        out = launch()
        self.assertEqual(self.decision(out), "allow")
        self.assertNotIn("failed open", json.dumps(out))
        logged = [json.loads(line) for line in log.read_text().splitlines()[seen:]]
        refused = [e for e in logged if (e["action"], e["decision"]) == ("launch", "would_deny")]
        self.assertTrue(refused, logged)
        for word in words:
            self.assertIn(word, refused[0]["reason"])
        return out

    def test_in_log_mode_each_refusal_is_logged_and_the_round_opens(self):
        self.mode = "log"
        cases = {"no spec": (self.without_spec, ["missing", self.UNBOUND_CALL % "internal"]),
                 "not a string": (lambda: self.launch(spec=19)[0], [self.UNBOUND_CALL % "internal"]),
                 "shape": (lambda: self.launch(spec="dev/demo/plans/001-demo")[0], ["shape"]),
                 "spec.md": (lambda: self.launch(**self.args_for("dev/demo/specs/009-gone"))[0], ["dev/demo/specs/009-gone/spec.md"])}
        for pr, (name, (launch, words)) in enumerate(cases.items(), 21):
            with self.subTest(name):
                self.on_pr(pr)
                # The PR is left unbound, so its reviewers are pointed at no spec, least of all the refused one.
                for prompt in self.prompts(self.refused_in_log_mode(launch, words)):
                    self.assertNotIn("This change implements the spec", prompt)

    def test_a_pr_whose_first_round_opened_unbound_in_log_mode_binds_at_its_next_launch(self):
        """Only a launch refused in log mode opens a round on a PR it leaves unbound; that round's reviewers are
        told nothing of a spec, and the next launch that names one binds it."""
        self.mode = "log"
        out = self.without_spec()
        self.assertEqual(self.decision(out), "allow")
        args = out["hookSpecificOutput"]["updatedInput"]["args"]
        self.assertNotIn("spec", self.saved())
        for reviewer in args["waves"][0]:
            for said in ("This change implements the spec", "needs no spec", "spec.md"):
                with self.subTest(reviewer=reviewer["type"], said=said):
                    self.assertNotIn(said, reviewer["prompt"])
        self.run_reviewers(args, [])
        self.commit("b.py", "fixed\n", "fix: b")
        self.mode = "enforce"
        self.assertEqual(self.decision(self.launch(**self.args_for(self.FOLDER))[0]), "allow")
        self.assertEqual((self.saved()["spec"], self.saved()["story"], self.saved()["spec_blob"]),
                         (self.FOLDER, self.STORY, self.bound))

    def test_in_log_mode_a_different_value_is_logged_and_the_binding_stays(self):
        self.mode = "log"
        self.launch(**self.args_for(self.FOLDER))
        out = self.refused_in_log_mode(lambda: self.launch(**self.args_for(self.OTHER))[0], [self.FOLDER, self.OTHER, "never changes"])
        self.assertEqual(self.saved()["spec"], self.FOLDER)
        for prompt in self.prompts(out):
            self.assertIn(self.graded(), prompt)
            self.assertNotIn(self.OTHER, prompt)

    def test_in_log_mode_a_changed_spec_md_is_logged_with_the_diff_holds_nothing_and_keeps_the_binding(self):
        self.clean_round(self.FOLDER)
        self.commit_files({f"{self.FOLDER}/spec.md": self.CHANGED})
        self.mode = "log"
        self.refused_in_log_mode(lambda: self.launch(**self.args_for(self.FOLDER))[0], ["+b.py prints 21 lines.", "`unlock #7`"])
        state = self.saved()
        self.assertNotIn("spec_held", state)
        self.assertEqual((state["spec"], state["spec_blob"]), (self.FOLDER, self.bound))
        self.assertEqual(len(state["rounds"]), 2)

    def test_in_log_mode_a_changed_spec_md_holds_nothing_when_another_rule_blocks_the_launch(self):
        self.clean_round(self.FOLDER)
        self.commit_files({f"{self.FOLDER}/spec.md": self.CHANGED})
        self.mode = "log"
        self.env["GH_OPEN_PR"] = "7 nosuch"
        out, _ = self.launch(**self.args_for(self.FOLDER))
        self.assertRefused(out, "nosuch")
        self.assertNotIn("spec_held", self.saved())

    def test_a_launch_let_through_in_log_mode_leaves_a_hold_recorded_before_it(self):
        """Log mode records refusals and blocks nothing: it neither puts a hold on the PR nor takes one off."""
        self.held()
        first = self.saved()["spec_held"]
        self.mode = "log"
        self.launch(**self.args_for(self.FOLDER))
        self.assertEqual(self.saved().get("spec_held"), first)


class ReleaseReady(Gate):
    """pr-gate passes a version-only release PR without review; the gate lets it out of draft on that alone."""

    def github_runs(self, *runs):
        """The head's `internal-review` check runs as the API returns them, filtered by real jq when gh is given --jq."""
        path = Path(self.tmp.name) / "runs.json"
        path.write_text(json.dumps({"total_count": len(runs), "check_runs": list(runs)}))
        (Path(self.tmp.name) / "bin" / "gh").write_text(
            f'#!/bin/sh\ncase "$*" in *commits/{self.head}/check-runs?check_name=internal-review*) ;; *) exit 1 ;; esac\n'
            f'while [ $# -gt 0 ]; do [ "$1" = --jq ] && exec jq -c "$2" {path}; shift; done\ncat {path}\n')

    def gate_run(self, title="version-only release: 1.0.0 → 1.0.1", app="analitiq-pr-gate", conclusion="success",
            started="2026-10-01T10:00:00Z", run_id=1):
        return {"id": run_id, "name": "internal-review", "app": {"slug": app}, "started_at": started,
                "status": "completed" if conclusion else "in_progress", "conclusion": conclusion,
                "output": {"title": title}}

    def ready(self):
        return self.decision(self.hook("PreToolUse", "Bash", {"command": f"cd {self.root} && gh pr ready"}))

    def test_a_version_only_release_on_the_head_may_be_marked_ready_without_a_round(self):
        self.github_runs(self.gate_run())
        self.assertIsNone(self.ready())

    def test_the_same_words_from_any_other_app_are_not_trusted(self):
        self.github_runs(self.gate_run(app="github-actions"))
        self.assertEqual(self.ready(), "deny")

    def test_an_unfinished_run_is_not_a_release(self):
        self.github_runs(self.gate_run(conclusion=None))
        self.assertEqual(self.ready(), "deny")

    def test_the_newest_run_by_start_counts_wherever_the_api_lists_it(self):
        demoted = self.gate_run(title="Waiting for an internal review", conclusion=None, started="2026-10-01T11:00:00Z",
                           run_id=2)
        self.github_runs(self.gate_run(), demoted)
        self.assertEqual(self.ready(), "deny")
        self.github_runs(demoted | {"started_at": "2026-10-01T09:00:00Z"}, self.gate_run())
        self.assertIsNone(self.ready())

    def test_runs_started_together_are_ordered_by_id(self):
        self.github_runs(self.gate_run(title="Waiting for an internal review", conclusion=None, run_id=2), self.gate_run(run_id=1))
        self.assertEqual(self.ready(), "deny")

    def test_an_ordinary_clean_internal_review_is_not_a_release(self):
        self.github_runs(self.gate_run(title="Internal review clean on 0123456789"))
        self.assertEqual(self.ready(), "deny")


class BrokenGate(Gate):
    """A gate that crashes is deciding nothing. On the paths whose job is to refuse, silence reads
    as permission, so the crash must refuse instead."""

    def break_the_ledger(self):
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_ledger("acme/demo", 7) as state:
                state["branch"] = "feat/1-demo"
        with closing(sqlite3.connect(self.state_dir / "ledger.db")) as conn, conn:
            conn.execute("UPDATE ledgers SET doc = '{ this is not json'")

    def test_a_crash_while_deciding_an_edit_refuses_it(self):
        self.break_the_ledger()
        out = self.edit()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("ALQ_REVIEW_MODE=log", self.reason(out))

    def test_a_crash_whose_trace_cannot_be_logged_still_refuses_and_says_so(self):
        self.break_the_ledger()
        (self.state_dir / "errors.log").mkdir()
        out = self.edit()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("not written to errors.log: IsADirectoryError", self.reason(out))

    def test_a_log_that_fails_in_any_way_still_leaves_the_crash_refused(self):
        """A raise from the log would end the hook in an error, and Claude Code runs a call whose hook errs."""
        payload = {"hook_event_name": "PreToolUse", "tool_name": "Edit", "tool_input": {}}
        with mock.patch.object(gate, "handle", side_effect=RuntimeError("broken")), \
                mock.patch.object(gate, "log_error", side_effect=ValueError("no log")), \
                mock.patch.object(gate, "mode", return_value="enforce"), \
                mock.patch("sys.stdin", io.StringIO(json.dumps(payload))), \
                mock.patch("sys.stdout", new_callable=io.StringIO) as out, \
                mock.patch("sys.stderr", new_callable=io.StringIO):
            gate.main()
        self.assertEqual(self.decision(json.loads(out.getvalue())), "deny")
        self.assertIn("not written to errors.log: ValueError: no log", self.reason(json.loads(out.getvalue())))

    def test_a_crash_that_fails_open_says_where_its_trace_is(self):
        self.break_the_ledger()
        out = self.edit(mode="log")
        self.assertIn(f"The trace is in {self.state_dir / 'errors.log'}.", out.get("systemMessage", ""))

    def test_a_crash_that_fails_open_and_cannot_be_logged_says_so(self):
        self.break_the_ledger()
        (self.state_dir / "errors.log").mkdir()
        out = self.edit(mode="log")
        self.assertIn("not written to errors.log: IsADirectoryError", out.get("systemMessage", ""))

    def crash(self, tool, tool_input, agent_type=None, **settings):
        """The answer of a gate that crashes deciding this call, under these settings (enforce where unnamed)."""
        payload = {"hook_event_name": "PreToolUse", "session_id": "s1", "tool_name": tool, "tool_input": tool_input,
                   "agent_type": agent_type}
        env = {"ALQ_REVIEW_STATE_DIR": str(self.state_dir), "ALQ_REVIEW_MODE": "enforce",
               "ALQ_REVIEW_CLAIM_CHECKS": "enforce", "ALQ_REVIEW_SHIM_CHECKS": "enforce", **settings}
        with mock.patch.object(gate, "handle", side_effect=RuntimeError("broken")), \
                mock.patch.dict(os.environ, env), \
                mock.patch("sys.stdin", io.StringIO(json.dumps(payload))), \
                mock.patch("sys.stdout", new_callable=io.StringIO) as out, \
                mock.patch("sys.stderr", new_callable=io.StringIO):
            gate.main()
        return json.loads(out.getvalue())

    def test_a_crash_deciding_a_round_launch_refuses_it_in_log_mode_too(self):
        """Log mode lets no round start without the arguments the gate gives it, so a crash is no permission."""
        for name in (REVIEW, ASSESS):
            with self.subTest(name=name):
                out = self.crash("Workflow", {"name": name, "args": {"worktree": str(self.root)}},
                                 ALQ_REVIEW_MODE="log")
                self.assertEqual(self.decision(out), "deny")
                self.assertIn("log mode too", self.reason(out))
                self.assertNotIn("ALQ_REVIEW_MODE=log", self.reason(out))

    def test_a_crash_deciding_a_report_refuses_it_in_log_mode_too(self):
        """An output that fails its check is sent back in every mode, so one never checked is sent back too."""
        _, args = self.launch()
        reviewer = args["waves"][0][0]
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_ledger("acme/demo", 7) as state:
                ledger.current_round(state)["expected"] = None
        out = self.hook("PreToolUse", "StructuredOutput", {"round_ref": args["round_ref"], "findings": []},
                        mode="log", agent_id="a1", agent_type=reviewer["type"])
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("crashed", self.reason(out))

    def test_a_crash_deciding_a_claim_or_shim_check_output_refuses_it_in_log_mode_too(self):
        """Each is an output the gate checks, sent back in every mode when it fails, so one never checked is too."""
        for agent_type in (gate.briefs.CLAIM_READER, gate.briefs.CLAIM_JUDGE, gate.briefs.CLAIM_CONTEST_JUDGE,
                           gate.briefs.SHIM_SWEEPER, gate.briefs.SHIM_SITE_JUDGE):
            with self.subTest(agent_type=agent_type):
                out = self.crash("StructuredOutput", {"check_ref": "c1"}, agent_type, ALQ_REVIEW_MODE="log")
                self.assertEqual(self.decision(out), "deny")
                self.assertIn("log mode too", self.reason(out))

    def test_a_crash_deciding_what_only_a_check_judges_lets_it_through_when_either_of_its_settings_logs(self):
        """The claim and shim checks each have a setting, so either can be rolled back alone, and log mode rolls back
        every check: a crash deciding a call only that check judges answers to both."""
        calls = {"claim judge's fetch": ("WebFetch", {"url": "https://example.com"}, gate.briefs.CLAIM_CONTEST_JUDGE,
                                         "ALQ_REVIEW_CLAIM_CHECKS"),
                 "claim check": ("Workflow", {"name": gate.claimgate.CHECK}, None, "ALQ_REVIEW_CLAIM_CHECKS"),
                 "shim check": ("Workflow", {"name": gate.shimgate.CHECK}, None, "ALQ_REVIEW_SHIM_CHECKS")}
        for call, (tool, tool_input, agent_type, own_setting) in calls.items():
            with self.subTest(call=call):
                self.assertEqual(self.decision(self.crash(tool, tool_input, agent_type)), "deny")
            for setting in (own_setting, "ALQ_REVIEW_MODE"):
                with self.subTest(call=call, logging=setting):
                    out = self.crash(tool, tool_input, agent_type, **{setting: "log"})
                    self.assertNotEqual(self.decision(out), "deny")
                    self.assertIn("failed open", out.get("systemMessage", ""))

    def test_a_crash_while_deciding_is_permission_in_log_mode(self):
        self.break_the_ledger()
        out = self.edit(mode="log")
        self.assertNotEqual(self.decision(out), "deny")
        self.assertIn("failed open", out.get("systemMessage", ""))

    def test_a_gate_that_cannot_read_its_own_mode_refuses(self):
        """Whether to refuse is itself read from the mode, so an unreadable one cannot mean 'log'."""
        self.break_the_ledger()
        out = self.edit(mode="nonsense")
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("ALQ_REVIEW_MODE=log", self.reason(out))

    def test_a_fault_in_the_round_refuses_a_report(self):
        _, args = self.launch()
        reviewer = args["waves"][0][0]
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_ledger("acme/demo", 7) as state:
                ledger.current_round(state)["expected"] = None
        out = self.report(reviewer, [], args["round_ref"])
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("crashed", self.reason(out))

    def test_an_ill_shaped_report_is_left_to_the_schema_and_logged(self):
        _, args = self.launch()
        reviewer = args["waves"][0][0]
        out = self.hook("PreToolUse", "StructuredOutput", {"round_ref": args["round_ref"], "findings": [{}]},
                        agent_id="a1", agent_type=reviewer["type"])
        self.assertNotEqual(self.decision(out), "deny")
        logged = [json.loads(line) for line in (self.state_dir / "gate.log").read_text().splitlines()]
        self.assertEqual((logged[-1]["action"], logged[-1]["decision"]), ("output", "ill-shaped"))

    def test_a_crash_doing_bookkeeping_still_fails_open(self):
        """Nothing is being guarded here, so a crash must not stand between a session and its work."""
        out = self.hook("SubagentStart", agent_type=briefs.INTERNAL_REVIEWERS[0])  # no agent_id: KeyError inside
        self.assertNotEqual(self.decision(out), "deny")
        self.assertIn("failed open", out.get("systemMessage", ""))



class ErrorsLog(unittest.TestCase):
    def test_text_git_wrote_that_is_not_utf8_is_logged(self):
        """A crash's trace can quote git: failing on its bytes would lose the trace of the crash it was written for."""
        with tempfile.TemporaryDirectory() as state, mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": state}):
            hookio.log_error("git failed on caf\udce9.py")
            self.assertIn("git failed on caf\\udce9.py", (Path(state) / "errors.log").read_text())


ODD_BLANKS = ("\u00a0", "\u2028", "\x0b", "\u3000")


class HeldBranch(Gate):
    """A RESHAPE_SPEC or ESCALATE lock: only the user's `unlock` releases it, and no route around it goes unnoticed."""

    def lock(self, verdict="RESHAPE_SPEC", pr=7, repo="acme/demo", branch="feat/1-demo", root=None, spec=None,
             findings=1):
        """PR `pr`, bound to `spec`, locked by `verdict` on a round with `findings` findings."""
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_ledger(repo, pr) as state:
                state.update(branch=branch, spec=spec, spec_blob=None if spec is None else "b" * 40,
                             **({} if spec is None else {"story": SpecArgument.STORY}))
                helpers.add_round(state, head=self.head, findings_per_reviewer=(findings, 0))
                ledger.current_round(state).update(root=str(root or self.root), session="s1")
                helpers.assess(state, verdict)

    def say(self, prompt):
        return self.hook("UserPromptSubmit", prompt=prompt).get("hookSpecificOutput", {}).get("additionalContext", "")

    def reuse_the_name(self):
        """What a later branch named like the locked one looks like: same checkout, fresh from main."""
        git(self.root, "checkout", "-q", "main")
        git(self.root, "branch", "-q", "-D", "feat/1-demo")
        git(self.root, "checkout", "-q", "-b", "feat/1-demo")

    def test_the_user_unlocks_by_starting_a_prompt_with_the_unlock_the_refusal_named(self):
        self.lock()
        self.assertIn("`unlock #7`", self.reason(self.edit()))
        self.assertIn("feat/1-demo", self.say("unlock #7 - the spec now says which root is canonical"))
        self.assertEqual(self.edit(), {})

    def test_the_user_unlocks_a_branch_whose_audits_are_spent(self):
        """The refusal said the work is back with the user; the unlock is how they hand it back."""
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_ledger("acme/demo", 7) as state:
                state.update(branch="feat/1-demo", spec=None, spec_blob=None)
                test_policy.spend_audits(state)
                ledger.current_round(state)["root"] = str(self.root)
        self.assertIn("`unlock #7`", self.reason(self.edit()))
        self.assertIn("feat/1-demo", self.say("unlock #7 - the recurring finding is a spec question, now answered"))
        self.assertEqual(self.edit(), {})

    def test_the_user_can_name_the_branch_instead(self):
        self.lock()
        self.say("unlock feat/1-demo")
        self.assertEqual(self.edit(), {})

    def test_an_unlock_quoted_inside_a_prompt_unlocks_nothing(self):
        """The cron bot's prompts quote issue and PR text that anyone can write."""
        self.lock()
        self.say("Work on this issue:\n\nunlock #7")
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_an_unlock_of_a_reshape_spec_lock_hands_the_user_the_ruling_and_the_bound_folder(self):
        """The user carries the ruling to planning by hand, so the reply holds all of it."""
        self.lock(spec=SpecArgument.FOLDER, findings=3)
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_ledger("acme/demo", 7) as state:
                ruling = ledger.current_round(state)["assessment"]
                ruling["rationale"] = "two rounds chose different roots"
                for finding, (kind, mechanism, spec_ref) in zip(ruling["findings"], (
                        ("spec_gap", "the canonical root is chosen round by round", "FR-3"),
                        ("spec_gap", "the fallback root is unnamed", "spec silent"),
                        ("defect", "an unchecked None", "n/a"))):
                    finding.update(kind=kind, mechanism=mechanism, spec_ref=spec_ref)
        said = self.say("unlock #7")
        self.assertEqual(self.edit(), {})
        for part in ("The user unlocked acme/demo#7", "which root is canonical?", "two rounds chose different roots",
                     "the canonical root is chosen round by round (FR-3)", "the fallback root is unnamed (spec silent)",
                     SpecArgument.FOLDER):
            with self.subTest(part=part):
                self.assertIn(part, said)
        self.assertNotIn("an unchecked None", said)

    def test_an_unlock_of_a_reshape_spec_lock_on_a_pr_bound_to_null_says_to_restart_on_a_pr_bound_to_a_spec(self):
        self.lock(spec=None)
        said = self.say("unlock #7")
        self.assertEqual(self.edit(), {})
        for part in ("The user unlocked acme/demo#7", "which root is canonical?",
                     "This PR has no spec. Close it and restart the work on a new PR bound to a spec that settles "
                     "this decision."):
            with self.subTest(part=part):
                self.assertIn(part, said)

    def test_an_unlock_of_a_reshape_spec_ruled_by_the_last_audit_hands_the_user_the_ruling(self):
        """Spending the audits adds a hold; it does not take the ruling away from the user who plans from it."""
        for pr, (spec, said_for_it) in enumerate(((SpecArgument.FOLDER, SpecArgument.FOLDER), (None, "This PR has no spec.")), 7):
            with self.subTest(spec=spec):
                with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
                    with ledger.open_ledger("acme/demo", pr) as state:
                        state.update(branch="feat/1-demo", spec=spec, spec_blob=None if spec is None else "b" * 40,
                                     **({} if spec is None else {"story": SpecArgument.STORY}))
                        test_policy.spend_audits(state, verdict="RESHAPE_SPEC")
                        ledger.current_round(state)["root"] = str(self.root)
                said = self.say(f"unlock #{pr}")
                for part in (f"The user unlocked acme/demo#{pr}", "which root is canonical?", said_for_it):
                    self.assertIn(part, said)

    def test_a_rescope_releases_nothing_and_is_answered_as_any_other_prompt(self):
        self.lock(spec=SpecArgument.FOLDER)
        for prompt in ("/alq-plan:issue-spec rescope dev/x/specs/001-demo #7", "/alq-review:alq-spec rescope #7",
                       "/alq-spec rescope #7"):
            with self.subTest(prompt=prompt):
                self.assertEqual(self.hook("UserPromptSubmit", prompt=prompt), {})
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_an_unlock_two_repos_could_mean_is_refused_until_the_repo_is_named(self):
        self.lock()
        self.lock(repo="acme/other")
        self.assertIn("acme/other#7", self.say("unlock #7"))
        self.assertEqual(self.decision(self.edit()), "deny")
        self.say("unlock acme/demo#7")
        self.assertEqual(self.edit(), {})

    def test_an_unlock_parted_by_anything_but_a_blank_releases_nothing(self):
        """A no-break space, a line separator, a vertical tab and an ideographic space: none is typed or seen as a
        blank, so none starts a command or parts its words."""
        self.lock()
        for odd in ODD_BLANKS:
            for prompt in (f"{odd}unlock #7", f"unlock{odd}#7"):
                with self.subTest(prompt=prompt):
                    self.assertEqual(self.say(prompt), "")
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_a_word_that_only_starts_like_a_commands_word_is_not_it(self):
        self.lock()
        for prompt in ("unlocked #7", "unlock#7", "Unlock #7"):
            with self.subTest(prompt=prompt):
                self.assertEqual(self.say(prompt), "")
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_a_prompt_with_too_few_words_for_a_command_is_not_answered(self):
        self.lock()
        for prompt in ("", " \r\n\t", "unlock", "unlock \n", "override"):
            with self.subTest(prompt=prompt):
                self.assertEqual(self.hook("UserPromptSubmit", prompt=prompt), {})
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_blanks_before_and_between_the_words_of_an_unlock_are_passed_over(self):
        self.lock()
        self.assertIn("The user unlocked acme/demo#7", self.say(" \r\n\tunlock \t\r\n#7\nand carry on"))
        self.assertEqual(self.edit(), {})

    def test_the_word_after_unlock_is_read_whole(self):
        """Each of these was once read as the PR whose number it starts with: the pattern stopped where it stopped
        understanding, and what it stopped at was judged by nothing. Each word has a locked PR of its own to
        release, so one that does release it fails alone."""
        words = ("#{n},", "#{n}.", "#0{n}", "#{wide}", "#{n}​", "#{n}​1", "acme/demo#{n}.", "acme/demo#0{n}",
                 "acme/demo#{wide}", "acme/demo#{n}​1", "acme/demo #{n}")
        for n, form in enumerate(words, start=11):
            self.lock(pr=n)
            word = form.format(n=n, wide="".join(chr(0xFF10 + int(digit)) for digit in str(n)))
            with self.subTest(word=word):
                self.assertIn("names no locked PR, so nothing was unlocked", self.say(f"unlock {word}"))
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            held = sorted(state["pr"] for state in ledger.all_states() if policy.locked(state))
        self.assertEqual(held, list(range(11, 11 + len(words))))

    def test_a_prs_name_unlocks_whatever_its_capitals(self):
        self.lock()
        self.lock(repo="Acme/Other", pr=9)
        self.assertIn("The user unlocked acme/demo#7", self.say("unlock Acme/Demo#7"))
        self.assertIn("The user unlocked Acme/Other#9", self.say("unlock acme/other#9"))

    def test_a_word_that_is_no_name_does_not_unlock_a_pr_whose_repo_is_no_name(self):
        """Neither reads as a PR's name, and two texts that are both no name are not the same name."""
        self.lock(repo="acmé/demo")
        for word in ("junk", "acmé/demo#7", "acme/demo#7"):
            with self.subTest(word=word):
                self.assertIn("names no locked PR, so nothing was unlocked", self.say(f"unlock {word}"))
        self.assertIn("The user unlocked acmé/demo#7", self.say("unlock #7"))

    def test_an_answer_names_the_command_by_its_words(self):
        self.lock()
        self.assertIn("`unlock #8` names no locked PR", self.say("unlock \t #8\nand more"))

    def test_writing_a_held_branch_through_bash_is_caught_wherever_the_command_runs(self):
        self.lock()
        out = self.bash(f"cd {self.root} && echo changed >> b.py")
        self.assertEqual(out.get("decision"), "block")
        self.assertIn("b.py", out["reason"])
        self.assertIn("`unlock #7`", out["reason"])

    def test_a_held_checkout_with_a_path_that_is_not_utf8_is_still_watched(self):
        name = os.fsdecode(b"caf\xe9.py")
        (self.root / name).write_text("x\n")
        self.lock()
        out = self.bash(f"cd {self.root} && printf y >> \"$(printf 'caf\\351.py')\"")
        self.assertEqual(out.get("decision"), "block")
        self.assertIn(name, out["reason"])

    def test_putting_a_held_branch_back_is_not_caught(self):
        self.lock()
        self.bash(f"echo changed >> {self.root}/b.py")
        self.assertEqual(self.bash(f"git -C {self.root} checkout -- b.py"), {})

    def test_moving_a_held_branch_without_git_commit_is_caught(self):
        self.lock()
        (self.root / "c.py").write_text("c\n")
        git(self.root, "add", "c.py")
        out = self.bash(f"git -C {self.root} -c alias.save=commit save -qm sneak")
        self.assertEqual(out.get("decision"), "block")
        self.assertIn("its tip was", out["reason"])

    def test_the_watch_follows_the_session_that_launched_the_round(self):
        _, args = self.launch()
        first = args["waves"][0][0]
        self.run_reviewers(args, [{"id": f"{first['short']}-1", "title": "t", "file": "b.py", "severity": "HIGH", "detail": "d"}])
        self.assertEqual(self.bash(f"echo changed >> {self.root}/b.py").get("decision"), "block")

    def test_another_sessions_command_is_not_blamed_for_a_change_to_a_held_checkout(self):
        """Session s2 works elsewhere; meanwhile the user edits the held checkout, which is theirs to do."""
        self.lock()
        elsewhere = Path(self.tmp.name) / "elsewhere"
        elsewhere.mkdir()
        out = self.bash(f"touch {elsewhere}/x", session="s2",
                        meanwhile=lambda: (self.root / "b.py").write_text("the user's own edit\n"))
        self.assertEqual(out, {})

    def test_a_checkout_that_now_holds_another_branch_is_not_held(self):
        self.lock()
        git(self.root, "checkout", "-q", "-b", "feat/3-next", "main")
        self.assertEqual(self.bash(f"echo x >> {self.root}/a.py"), {})

    def test_a_branch_reusing_the_name_of_one_whose_pr_merged_starts_over(self):
        self.lock()
        self.env["GH_OPEN_PR"] = ""
        self.reuse_the_name()
        self.assertEqual(self.edit("a.py"), {})
        self.assertEqual(self.saved()["rounds"], [])

    def test_a_reused_name_is_watched_by_bash_no_longer(self):
        self.lock()
        self.env["GH_OPEN_PR"] = ""
        self.reuse_the_name()
        self.assertEqual(self.bash(f"echo x >> {self.root}/a.py"), {})

    def test_a_reused_name_launches_its_first_round(self):
        self.lock()
        self.env["GH_OPEN_PR"] = "9 main"
        self.reuse_the_name()
        self.commit("n.py", "n\n", "feat: new work")
        out, args = self.launch()
        self.assertEqual(self.decision(out), "allow")
        self.assertTrue(args["round_ref"].endswith("internal-0.1"))
        self.assertEqual(self.saved()["pr"], 9)

    def test_a_poll_for_the_new_pr_on_a_reused_name_does_not_carry_the_lock_over(self):
        self.lock()
        self.env["GH_OPEN_PR"] = "9 main"
        self.reuse_the_name()
        inbox = self.state_dir / "inbox"
        inbox.mkdir(parents=True, exist_ok=True)
        (inbox / "acme__demo__9.json").write_text(json.dumps(
            {"repo": "acme/demo", "pr": 9, "head_ref": "feat/1-demo", "head_sha": git(self.root, "rev-parse", "HEAD"), "status": "clean"}))
        self.assertEqual(self.edit("a.py"), {})
        self.assertEqual(self.saved()["pr"], 9)

    def test_a_merged_prs_ledger_is_kept_under_its_pr(self):
        self.lock()
        self.env["GH_OPEN_PR"] = ""
        self.reuse_the_name()
        self.assertEqual(self.edit("a.py"), {})
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            released = next(s for s in ledger.all_states() if s["pr"] == 7)
        self.assertEqual(released["rounds"][-1]["assessment"]["round_verdict"], "RESHAPE_SPEC")

    def test_a_pr_named_from_outside_any_checkout_keeps_its_lock(self):
        self.lock()
        self.env["GH_OPEN_PR"] = ""
        self.reuse_the_name()
        out = self.hook("PreToolUse", "Bash", {"command": "gh pr comment 7 --repo acme/demo --body '@codex review'"})
        self.assertEqual(self.decision(out), "deny")

    def test_a_command_that_commits_and_then_leaves_the_branch_is_caught(self):
        self.lock()
        script = Path(self.tmp.name) / "sneak.sh"
        script.write_text(f"cd {self.root} && echo x >> b.py && git commit -qam x && git checkout -q main\n")
        out = self.bash(f"sh {script}")
        self.assertEqual(out.get("decision"), "block")
        self.assertIn("feat/1-demo", out["reason"])

    def test_leaving_a_held_branch_without_moving_it_is_not_caught(self):
        self.lock()
        self.assertEqual(self.bash(f"git -C {self.root} checkout -q main && touch {self.root}/scratch.txt"), {})

    def test_a_checkout_git_cannot_read_is_reported_before_the_command(self):
        self.lock()
        (self.root / ".git" / "index").write_bytes(b"not an index")
        out = self.hook("PreToolUse", "Bash", {"command": "true"}, tool_use_id="t1")
        self.assertNotEqual(self.decision(out), "deny")
        self.assertIn(f"cannot verify {self.root}", out.get("systemMessage", ""))

    def unreadable(self, name="z.py"):
        (self.root / name).write_text("x")
        (self.root / name).chmod(0)

    def unverified_message(self, name="z.py"):
        return (f"alq-review cannot verify {name} in {self.root}; the branch tip and every other change there are "
                "still watched.")

    def test_an_unreadable_file_is_reported_before_the_command_not_refused(self):
        self.lock()
        self.unreadable()
        out = self.hook("PreToolUse", "Bash", {"command": "true"}, tool_use_id="t1")
        self.assertNotEqual(self.decision(out), "deny")
        self.assertEqual(out.get("systemMessage"), self.unverified_message())

    def test_an_unreadable_directory_git_names_in_bytes_that_are_not_utf8_is_reported_not_refused(self):
        """git names it in its complaint, not in its listing."""
        name = os.fsdecode(b"caf\xe9")
        (self.root / name).mkdir()
        (self.root / name / "x.py").write_text("x")
        self.lock()
        (self.root / name).chmod(0)
        self.addCleanup((self.root / name).chmod, 0o755)
        out = self.hook("PreToolUse", "Bash", {"command": "true"}, tool_use_id="t1")
        self.assertNotEqual(self.decision(out), "deny")
        self.assertEqual(out.get("systemMessage"), self.unverified_message(f"{name}/"))

    def test_an_unreadable_file_is_reported_after_a_command_that_moved_nothing(self):
        self.lock()
        self.unreadable()
        self.assertEqual(self.bash("true"), {"systemMessage": self.unverified_message()})

    def test_a_file_becoming_readable_or_unreadable_is_reported_not_blocked(self):
        self.lock()
        (self.root / "z.py").write_text("x")
        for mode in ("000", "644"):
            with self.subTest(chmod=mode):
                self.assertEqual(self.bash(f"chmod {mode} {self.root}/z.py"), {"systemMessage": self.unverified_message()})

    def test_a_commit_next_to_an_unreadable_file_is_caught(self):
        self.lock()
        script = Path(self.tmp.name) / "sneak.sh"
        script.write_text(f"cd {self.root} && echo x >> b.py && git commit -qam x && touch z.py && chmod 000 z.py\n")
        out = self.bash(f"sh {script}")
        self.assertEqual(out.get("decision"), "block")
        self.assertIn("tip", out["reason"])

    def test_git_status_complaining_of_something_unnamed_leaves_the_tip_watched(self):
        self.lock()
        wrap = Path(self.tmp.name) / "wrap"
        wrap.mkdir()
        (wrap / "git").write_text(f'#!/bin/sh\n"{shutil.which("git")}" "$@"\nrc=$?\n'
                                  'case " $* " in *" status "*) echo "warning: something odd" >&2 ;; esac\nexit $rc\n')
        (wrap / "git").chmod(0o755)
        self.env["PATH"] = f"{wrap}{os.pathsep}{self.env['PATH']}"
        script = Path(self.tmp.name) / "sneak.sh"
        script.write_text(f"cd {self.root} && echo x >> b.py && git commit -qam x\n")
        out = self.bash(f"sh {script}")
        self.assertEqual(out.get("decision"), "block")
        self.assertIn("tip", out["reason"])
        self.assertIn(f"cannot verify files in {self.root}: warning: something odd", out.get("systemMessage", ""))

    def test_a_checkout_the_command_removed_is_reported_not_blamed(self):
        """The branch did not move; the watch just cannot look any more, and says so."""
        self.lock()
        out = self.bash(f"rm -rf {self.root}")
        self.assertNotIn("decision", out)
        self.assertIn(f"cannot verify {self.root}", out.get("systemMessage", ""))

    def test_a_bash_command_writes_no_ledger_and_asks_github_at_most_once(self):
        self.lock()
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            before = ledger.all_states()
            self.bash(f"git -C {self.root} status && ls {self.root}")
            self.assertEqual(ledger.all_states(), before)
        self.assertEqual(Path(self.env["GH_LOG"]).read_text().count("pr list"), 1)

    def test_another_pr_named_from_a_held_checkout_is_judged_on_its_own_ledger(self):
        self.lock()
        out = self.hook("PreToolUse", "Bash", {"command": 'gh pr comment 8 --repo acme/demo --body "@codex review"'},
                        cwd=str(self.root))
        self.assertEqual(out, {})
        self.assertEqual(self.decision(self.hook("PreToolUse", "Bash", {"command": 'gh pr comment 7 --repo acme/demo '
                                                 '--body "@codex review"'}, cwd=str(self.root))), "deny")

    def test_a_refused_bash_command_is_logged_with_its_branch(self):
        self.lock()
        self.assertEqual(self.decision(self.hook("PreToolUse", "Bash", {"command": "git commit -qam x"},
                                                 cwd=str(self.root))), "deny")
        logged = json.loads((self.state_dir / "gate.log").read_text().splitlines()[-1])
        self.assertEqual((logged["action"], logged["branch"], logged["pr"]), ("commit", "feat/1-demo", 7))

    def test_a_branch_that_is_free_is_not_watched(self):
        self.lock(verdict="REDESIGN")
        self.assertEqual(self.bash(f"echo changed >> {self.root}/b.py"), {})


class KeyedByPr(Gate):
    """Each ledger belongs to one PR; a checkout means its branch's open PR on GitHub."""

    say = HeldBranch.say
    reuse_the_name = HeldBranch.reuse_the_name

    def setUp(self):
        super().setUp()
        state_dir = mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)})
        state_dir.start()
        self.addCleanup(state_dir.stop)

    def ledger_for(self, pr, repo="acme/demo", branch="feat/1-demo", verdict=None):
        """PR `pr`'s ledger, whose head branch is `branch`, locked by `verdict` when given one."""
        with ledger.open_ledger(repo, pr) as state:
            state["branch"] = branch
        if verdict:
            with ledger.open_ledger(repo, pr) as state:
                state.update(spec=None, spec_blob=None)  # what the launch of the round it was ruled in bound
                helpers.add_round(state, head=self.head)
                ledger.current_round(state).update(root=str(self.root), session="s1")
                helpers.assess(state, verdict)

    def doc(self, pr, repo="acme/demo"):
        with ledger.open_ledger(repo, pr) as state:
            return state

    def drop(self, pr, head_ref, url):
        inbox = self.state_dir / "inbox"
        inbox.mkdir(parents=True, exist_ok=True)
        path = inbox / f"acme__demo__{pr}.json"
        path.write_text(json.dumps({
            "repo": "acme/demo", "pr": pr, "status": "findings", "at": "2026-09-18T12:00:00Z",
            "head_ref": head_ref, "head_sha": self.head, "failing_checks": [], "gate_comments": [],
            "threads": [{"by": "codex", "path": "b.py", "line": 3, "url": url, "gist": "g", "severity": "P1",
                         "outdated": False, "at": "2026-09-18T11:59:00Z"}]}))
        return path

    def locked(self):
        return sorted((s["repo"], s["pr"]) for s in ledger.all_states() if policy.locked(s))

    def test_a_merged_prs_lock_does_not_reach_a_new_pr_on_the_same_name(self):
        self.ledger_for(7, verdict="RESHAPE_SPEC")
        self.env["GH_OPEN_PR"] = "9 main"
        self.reuse_the_name()
        self.commit("n.py", "n\n", "feat: new work")
        out, args = self.launch()
        self.assertEqual(self.decision(out), "allow")
        self.assertEqual(args["round_ref"], "acme/demo#9:internal-0.1")
        self.run_reviewers(args, [])
        self.assertEqual(self.edit("n.py"), {})
        self.assertEqual(self.locked(), [("acme/demo", 7)])

    def test_a_drop_lands_in_its_prs_ledger_while_another_branch_is_checked_out(self):
        url = "https://github.com/acme/demo/pull/7#discussion_r1"
        dropped = self.drop(7, "feat/1-demo", url)
        git(self.root, "checkout", "-q", "-b", "feat/3-next", "main")
        self.assertEqual(self.edit("a.py"), {})
        self.assertFalse(dropped.exists())
        self.assertEqual([f["id"] for f in ledger.current_round(self.doc(7))["findings"]], [url])

    def test_an_unbound_branch_is_judged_on_an_empty_ledger_that_is_never_saved(self):
        self.assertEqual(self.edit(), {})
        self.assertEqual(list(ledger.all_states()), [])

    def test_a_round_needs_an_open_pr(self):
        self.env["GH_OPEN_PR"] = ""
        out, _ = self.launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertEqual(list(ledger.all_states()), [])

    def test_a_round_is_refused_with_githubs_error_when_it_cannot_say_which_pr_is_open(self):
        """An unanswered question is not the answer "no open PR"."""
        (Path(self.tmp.name) / "bin" / "gh").write_text("#!/bin/sh\necho 'error connecting to api.github.com' >&2\nexit 1\n")
        out, _ = self.launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("error connecting to api.github.com", self.reason(out))
        self.assertEqual(list(ledger.all_states()), [])

    def test_a_drop_for_another_pr_on_a_locked_branch_is_kept_under_its_pr(self):
        self.ledger_for(7, verdict="RESHAPE_SPEC")
        url = "https://github.com/acme/demo/pull/9#discussion_r1"
        dropped = self.drop(9, "feat/1-demo", url)
        self.assertEqual(self.decision(self.edit()), "deny")
        self.assertFalse(dropped.exists())
        self.assertEqual([f["id"] for f in ledger.current_round(self.doc(9))["findings"]], [url])

    def test_the_assessors_brief_is_found_by_its_round_ref(self):
        with ledger.open_ledger("acme/demo", 7) as state:
            # What the launch this round stands in for would have bound.
            state.update(branch="feat/1-demo", spec=None, spec_blob=None)
            rnd = helpers.add_round(state, head=self.head)
            rnd.update(root=str(self.root), session="s1", base_sha=git(self.root, "rev-parse", "main"))
        brief = subprocess.run([sys.executable, str(SCRIPTS / "briefs.py"), "--ref", "acme/demo#7:internal-0.1"],
                               env=self.env, capture_output=True, text=True)
        self.assertEqual(brief.returncode, 0, brief.stderr)
        self.assertEqual(json.loads(brief.stdout)["brief_token"], briefs.brief_token(rnd))

    def test_unlock_naming_the_repo_and_pr_unlocks_that_ledger_only(self):
        self.ledger_for(7, verdict="RESHAPE_SPEC")
        self.ledger_for(7, repo="acme/other", verdict="RESHAPE_SPEC")
        self.ledger_for(8, branch="feat/2-more", verdict="RESHAPE_SPEC")
        self.say("unlock acme/demo#7")
        self.assertEqual(self.locked(), [("acme/demo", 8), ("acme/other", 7)])

    def test_unlock_naming_the_pr_unlocks_that_ledger_only(self):
        self.ledger_for(7, verdict="RESHAPE_SPEC")
        self.ledger_for(8, branch="feat/2-more", verdict="RESHAPE_SPEC")
        self.say("unlock #8")
        self.assertEqual(self.locked(), [("acme/demo", 7)])

    def test_status_of_a_branch_with_no_pr_under_review_says_so(self):
        done = subprocess.run([sys.executable, str(SCRIPTS / "ledger.py"), "status", "--worktree", str(self.root)],
                              env=self.env, capture_output=True, text=True)
        self.assertEqual(done.returncode, 1)
        self.assertIn("no PR under review for feat/1-demo", done.stderr)


class RoundRefs(unittest.TestCase):
    def output(self, ref):
        return gate._round_output({"tool_input": {"round_ref": ref}, "agent_type": "alq-review:assessor"})

    def test_a_ref_naming_its_pr_is_a_round_output(self):
        self.assertEqual(self.output("acme/demo#7:internal-0.1"), ("acme/demo#7:internal-0.1", "alq-review:assessor"))

    def test_anything_else_is_not(self):
        for ref in ("acme/demo:feat/1-demo:internal-0.1", "acme/demo#7", "acme/demo#seven:internal-0.1"):
            with self.subTest(ref=ref):
                self.assertIsNone(self.output(ref))


class OtherGates(Gate):
    def test_direct_reviewer_dispatch_from_the_main_thread_is_refused_with_the_full_call(self):
        call = {"subagent_type": "pr-review-toolkit:code-reviewer", "prompt": "review"}
        agent = self.hook("PreToolUse", "Agent", call)
        self.assertEqual(self.decision(agent), "deny")
        self.assertIn(SpecArgument.UNBOUND_CALL % "internal", self.reason(agent))
        self.assertEqual(self.hook("PreToolUse", "Agent", call, agent_id="sub", agent_type="general-purpose"), {})
        self.assertEqual(self.hook("PreToolUse", "Agent", {"subagent_type": "Explore", "prompt": "x"}), {})
        skill = self.hook("PreToolUse", "Skill", {"skill": "pr-review-toolkit:review-pr"})
        self.assertEqual(self.decision(skill), "deny")
        self.assertIn(SpecArgument.UNBOUND_CALL % "internal", self.reason(skill))

    def test_the_pr_audit_skill_is_refused_toward_the_ledgers_audit_round(self):
        audit = self.hook("PreToolUse", "Skill", {"skill": "alq-anti-pattern:pr-audit"})
        self.assertEqual(self.decision(audit), "deny")
        self.assertIn(SpecArgument.UNBOUND_CALL % "audit", self.reason(audit))
        self.assertEqual(self.hook("PreToolUse", "Skill", {"skill": "alq-anti-pattern:codebase-audit"}), {})

    def test_no_edits_while_directly_dispatched_detectors_are_running(self):
        self.hook("SubagentStart", agent_id="d1", agent_type="alq-anti-pattern:code-shape")
        self.hook("SubagentStart", agent_id="d2", agent_type="alq-anti-pattern:duplication")
        self.hook("SubagentStop", agent_id="d1", agent_type="alq-anti-pattern:code-shape")
        self.assertEqual(self.decision(self.edit()), "deny")
        self.hook("SubagentStop", agent_id="d2", agent_type="alq-anti-pattern:duplication")
        self.assertEqual(self.edit(), {})

    def test_an_agent_that_writes_code_is_not_a_reviewer_in_flight(self):
        simplifier = {"agent_id": "w1", "agent_type": "pr-review-toolkit:code-simplifier"}
        self.hook("SubagentStart", **simplifier)
        self.assertEqual(self.edit(**simplifier), {})

    def test_a_pr_named_that_has_no_ledger_gets_none(self):
        self.hook("PreToolUse", "Bash", {"command": 'gh pr comment 99999 --repo acme/demo --body "@codex review"'})
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            self.assertNotIn(99999, [s["pr"] for s in ledger.all_states()])

    def test_the_ledger_store_makes_no_policy_decisions(self):
        imported = {alias.name for node in ast.walk(ast.parse((SCRIPTS / "ledger.py").read_text()))
                    if isinstance(node, (ast.Import, ast.ImportFrom)) for alias in node.names}
        self.assertNotIn("policy", imported)

    def test_commit_is_the_backstop_for_edits_made_through_the_shell(self):
        self.launch()
        commit = self.hook("PreToolUse", "Bash", {"command": f"git -C {self.root} commit -am wip"})
        self.assertEqual(self.decision(commit), "deny")
        self.assertEqual(self.hook("PreToolUse", "Bash", {"command": f"git -C {self.root} status"}), {})

    def test_ignored_and_foreign_files_stay_editable(self):
        self.launch()
        self.assertEqual(self.edit("notes/task.md"), {})
        self.assertEqual(self.hook("PreToolUse", "Edit", {"file_path": self.tmp.name + "/scratch.md"}), {})

    def test_agent_may_not_unlock_or_rewrite_the_gate_state(self):
        unlock = self.hook("PreToolUse", "Bash", {"command": f"python3 {GATE.parent}/ledger.py unlock --worktree {self.root} --reason x"})
        self.assertEqual(self.decision(unlock), "deny")
        write = self.hook("PreToolUse", "Write", {"file_path": str(self.state_dir / "acme__demo" / "x" / "state.json")})
        self.assertEqual(self.decision(write), "deny")

    def test_log_mode_blocks_nothing_and_records_what_it_would_have_blocked(self):
        self.mode = "log"
        _, args = self.launch()
        self.assertIsNotNone(args)
        self.assertEqual(self.edit(), {})
        entries = [json.loads(line) for line in (self.state_dir / "gate.log").read_text().splitlines()]
        self.assertTrue(any(e["decision"] == "would_deny" and e["action"] == "edit" for e in entries))

    def test_gate_failure_is_loud_and_refuses_what_it_was_deciding(self):
        """Even with nowhere to write the trace: the refusal is carried by the answer itself."""
        self.state_dir.parent.mkdir(exist_ok=True)
        self.state_dir.write_text("not a directory")
        out = self.edit()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("alq-review", self.reason(out))


class GithubRound(Gate):
    def drop(self, urls):
        inbox = self.state_dir / "inbox"
        inbox.mkdir(parents=True, exist_ok=True)
        (inbox / "acme__demo__7.json").write_text(json.dumps({
            "repo": "acme/demo", "pr": 7, "status": "findings", "at": "2026-09-18T12:00:00Z",
            "head_ref": "feat/1-demo", "head_sha": self.head, "failing_checks": [], "gate_comments": [],
            "threads": [{"by": "codex", "path": "b.py", "line": 3, "url": u, "gist": "g", "severity": "P1",
                         "outdated": False, "at": "2026-09-18T11:59:00Z"} for u in urls]}))

    def test_polled_findings_block_until_assessed(self):
        urls = ["https://github.com/acme/demo/pull/7#discussion_r1"]
        self.drop(urls)
        blocked = self.edit()
        self.assertEqual(self.decision(blocked), "deny")
        self.assertIn(ASSESS, self.reason(blocked))
        rerequest = self.hook("PreToolUse", "Bash", {"command": 'gh pr comment 7 --repo acme/demo --body "@codex review"'})
        self.assertEqual(self.decision(rerequest), "deny")

        out, args = self.launch(ASSESS)
        self.assertEqual(self.decision(out), "allow")
        self.assertEqual([f["id"] for f in args["findings"]], urls)
        self.submit_assessment(self.assessment(args["round_ref"], urls))
        self.assertEqual(self.edit(), {})
        self.assertEqual(self.hook("PreToolUse", "Bash", {"command": 'gh pr comment 7 --repo acme/demo --body "@codex review"'}), {})

    def test_findings_polled_before_a_rerequest_from_outside_any_checkout_block_it(self):
        self.drop(["https://github.com/acme/demo/pull/7#discussion_r1"])
        out = self.hook("PreToolUse", "Bash", {"command": 'gh pr comment 7 --repo acme/demo --body "@codex review"'})
        self.assertEqual(self.decision(out), "deny")

    def test_findings_polled_before_a_round_launch_block_it(self):
        self.drop(["https://github.com/acme/demo/pull/7#discussion_r1"])
        out, _ = self.launch(REVIEW)
        self.assertEqual(self.decision(out), "deny")

    def test_a_github_round_is_briefed_on_the_change_since_the_branch_the_pr_merges_into(self):
        self.drop(["https://github.com/acme/demo/pull/7#discussion_r1"])
        _, args = self.launch(ASSESS)
        brief = subprocess.run([sys.executable, str(SCRIPTS / "briefs.py"), "--ref", args["round_ref"]], env=self.env,
                               capture_output=True, text=True, check=True)
        main = git(self.root, "rev-parse", "main")
        self.assertTrue(json.loads(brief.stdout)["change_under_review"].endswith(f"diff {main}...HEAD"))

    def test_assess_with_nothing_to_assess_is_refused(self):
        out, _ = self.launch(ASSESS)
        self.assertEqual(self.decision(out), "deny")


class OpenPrOnGithub(Gate):
    """The PR a checkout means is its branch's open PR on GitHub; nothing local decides it. Every lock here is
    made through the hooks, the way a real session makes one."""

    def lock_through_a_round(self, verdict="RESHAPE_SPEC"):
        _, args = self.launch()
        first = args["waves"][0][0]
        found = [{"id": f"{first['short']}-1", "title": "t", "file": "b.py", "line": 3, "severity": "HIGH", "detail": "d"}]
        self.run_reviewers(args, found)
        body = self.assessment(args["round_ref"], [found[0]["id"]], verdict)
        if verdict == "RESHAPE_SPEC":
            body.update(user_decision="which root is canonical?")
            body["findings"][0]["kind"] = "spec_gap"
        else:
            body.update(invariant="one structure")
        self.assertNotEqual(self.decision(self.submit_assessment(body)), "deny")
        self.assertEqual(self.decision(self.edit()), "deny" if verdict == "RESHAPE_SPEC" else None)
        return args

    def asked(self, question):
        log = Path(self.env["GH_LOG"])
        return log.read_text().count(question) if log.exists() else 0

    def test_a_pr_closed_unmerged_holds_nothing_over_the_next_pr_on_its_branch(self):
        """Closing a PR is no way out of review: the new PR has its own ledger and goes through its own rounds."""
        self.lock_through_a_round()
        self.env["GH_OPEN_PR"] = "9 main"
        self.commit("n.py", "n\n", "feat: after the close")
        self.assertEqual(self.edit("n.py"), {})
        out, args = self.launch()
        self.assertEqual(self.decision(out), "allow")
        self.assertEqual(args["round_ref"], "acme/demo#9:internal-0.1")

    def test_a_merged_prs_lock_ends_at_the_next_commit(self):
        """GitHub's answer is kept per commit: the merge is seen once the branch moves on."""
        self.lock_through_a_round()
        self.env["GH_OPEN_PR"] = ""
        self.assertEqual(self.decision(self.edit()), "deny")
        self.commit("n.py", "n\n", "feat: after the merge")
        self.assertEqual(self.edit("n.py"), {})

    def test_a_pr_opened_at_a_commit_already_seen_without_one_holds_its_round(self):
        """Opening a PR does not move the branch, so 'no open PR' is never kept for a commit."""
        self.lock_through_a_round()
        self.env["GH_OPEN_PR"] = ""
        self.commit("n.py", "n\n", "feat: after the merge")
        self.assertEqual(self.edit("n.py"), {})
        self.env["GH_OPEN_PR"] = "9 main"
        out, args = self.launch()
        self.assertEqual(args["round_ref"], "acme/demo#9:internal-0.1")
        self.assertEqual(self.decision(self.edit("n.py")), "deny")
        first = args["waves"][0][0]
        self.run_reviewers(args, [{"id": f"{first['short']}-1", "title": "t", "file": "n.py", "line": 1,
                                   "severity": "HIGH", "detail": "d"}])
        self.assertEqual(self.decision(self.edit("n.py")), "deny")

    def test_a_pr_opened_in_place_of_a_closed_one_at_the_same_commit_holds_its_round(self):
        """The launch records the PR GitHub names now; every later lookup at that commit agrees with it."""
        self.lock_through_a_round(verdict="REDESIGN")
        self.env["GH_OPEN_PR"] = "9 main"
        out, args = self.launch()
        self.assertEqual(args["round_ref"], "acme/demo#9:internal-0.1")
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_a_pr_polled_at_a_commit_already_seen_without_one_is_enforced_there(self):
        """'No open PR' is never kept for a commit: nothing but GitHub knows a PR was opened since."""
        self.lock_through_a_round(verdict="REDESIGN")
        self.env["GH_OPEN_PR"] = ""
        head = self.commit("n.py", "n\n", "feat: after the merge")
        self.assertEqual(self.edit("n.py"), {})
        self.env["GH_OPEN_PR"] = "9 main"
        inbox = self.state_dir / "inbox"
        inbox.mkdir(parents=True, exist_ok=True)
        (inbox / "acme__demo__9.json").write_text(json.dumps({
            "repo": "acme/demo", "pr": 9, "status": "findings", "at": "2026-09-18T12:00:00Z",
            "head_ref": "feat/1-demo", "head_sha": head, "failing_checks": [], "gate_comments": [],
            "threads": [{"by": "codex", "path": "n.py", "line": 1, "url": "https://github.com/acme/demo/pull/9#r1",
                         "gist": "g", "severity": "P1", "outdated": False, "at": "2026-09-18T11:59:00Z"}]}))
        self.assertEqual(self.decision(self.edit("n.py")), "deny")

    def test_a_held_checkout_stays_watched_while_github_cannot_say_its_pr(self):
        self.lock_through_a_round()
        self.commit("n.py", "n\n", "feat: the next commit")
        (Path(self.tmp.name) / "bin" / "gh").write_text("#!/bin/sh\necho 'error connecting to api.github.com' >&2\nexit 1\n")
        self.assertEqual(self.bash(f"cd {self.root} && echo x >> b.py").get("decision"), "block")

    def test_github_not_saying_which_pr_is_open_refuses_with_its_error(self):
        self.lock_through_a_round(verdict="REDESIGN")
        self.commit("n.py", "n\n", "feat: the next commit")
        (Path(self.tmp.name) / "bin" / "gh").write_text("#!/bin/sh\necho 'error connecting to api.github.com' >&2\nexit 1\n")
        out = self.edit("n.py")
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("error connecting to api.github.com", self.reason(out))
        self.assertNotIn("crashed", self.reason(out))

    def test_github_is_asked_which_pr_is_open_once_per_commit(self):
        self.lock_through_a_round(verdict="REDESIGN")
        self.commit("n.py", "n\n", "feat: the next commit")
        before = self.asked("pr list")
        self.edit("n.py")
        self.edit("n.py")
        self.assertEqual(self.asked("pr list") - before, 1)

    def test_a_branch_no_ledger_names_never_asks_github(self):
        git(self.root, "checkout", "-q", "-b", "feat/3-next", "main")
        self.assertEqual(self.edit("a.py"), {})
        self.assertEqual(self.asked("pr "), 0)


if __name__ == "__main__":
    unittest.main()
