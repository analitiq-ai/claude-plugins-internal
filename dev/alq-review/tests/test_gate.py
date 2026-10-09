"""Drives scripts/gate.py the way Claude Code does: one JSON payload on stdin per hook event."""
import ast
import json
import os
import shutil
import sqlite3
import subprocess
import sys
import unittest
from contextlib import closing
from pathlib import Path
from unittest import mock

from paths import PLUGIN

from test_worktree_facts import Repo, git

import briefs
import config
import gate
import helpers
import ledger
import policy
import speclocation
import test_policy
import test_settled_design

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
        # when GH_ISSUE_STATE is set, every issue's state, and an issue's comments as GH_ISSUE_COMMENTS (one by
        # default, set below; GH_COMMENTS_ERROR makes that read fail), and keeps what a write sends on stdin in
        # GH_POSTED; every other lookup sees a gh that cannot answer.
        stub = Path(self.tmp.name) / "bin"
        stub.mkdir()
        (stub / "gh").write_text('#!/bin/sh\necho "$*" >> "$GH_LOG"\ncase "$*" in\n  "pr list"*) echo "$GH_OPEN_PR" ;;\n'
                                 '  "issue view"*) [ -n "$GH_ISSUE_STATE" ] && echo "$GH_ISSUE_STATE" || exit 1 ;;\n'
                                 '  "api --paginate repos/"*/issues/*/comments*)\n'
                                 '    [ -n "$GH_COMMENTS_ERROR" ] && { echo "$GH_COMMENTS_ERROR" >&2; exit 1; }\n'
                                 '    printf "%s" "$GH_ISSUE_COMMENTS" ;;\n'
                                 '  "api -X "*) cat > "$GH_POSTED"; echo https://github.test/comment ;;\n'
                                 '  *) exit 1 ;;\nesac\n')
        (stub / "gh").chmod(0o755)
        self.env = dict(os.environ, ALQ_REVIEW_STATE_DIR=str(self.state_dir), PATH=f"{stub}{os.pathsep}{os.environ['PATH']}",
                        GH_OPEN_PR="7 main", GH_LOG=str(Path(self.tmp.name) / "gh.log"),
                        GH_POSTED=str(Path(self.tmp.name) / "gh.posted"),
                        # Most tests are not about the spec: their issue says it needs none.
                        GH_ISSUE_COMMENTS=json.dumps({"id": 100, "body": speclocation.render_none("a test fixture")}),
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


class IssueSpec(Gate):
    """Internal reviewers and the assessor grade a change against spec.md of the folder its issue's location comment
    names."""
    FOLDER = "dev/demo/specs/001-demo"
    SPEC = "# Demo\n\n## Acceptance\n- b.py prints 20 lines.\n"

    def setUp(self):
        super().setUp()
        self.env["ALQ_REVIEW_SPEC_CHECKS"] = "log"  # the settled-design check of a spec folder has its own tests
        (self.root / self.FOLDER).mkdir(parents=True)
        self.head = self.commit(f"{self.FOLDER}/spec.md", self.SPEC, "spec")
        self.comments("unrelated chatter", speclocation.render(self.FOLDER, "feat/1-demo"))

    def comments(self, *bodies):
        """What gh hands over for the issue's comments, one per line, ids from 101."""
        self.env["GH_ISSUE_COMMENTS"] = "\n".join(json.dumps({"id": 101 + i, "body": b}) for i, b in enumerate(bodies))

    def assertGradesAgainstSpec(self, args):
        self.assertEqual([[r["type"] for r in wave] for wave in args["waves"]], [briefs.INTERNAL_REVIEWERS])
        for reviewer in args["waves"][0]:
            self.assertIn(self.SPEC, reviewer["prompt"])
            self.assertIn(self.FOLDER, reviewer["prompt"])
            self.assertIn("Acceptance criterion the change does not meet is a finding", reviewer["prompt"])

    def reviewed(self):
        """A round every reviewer has reported on, one finding in it; its launch args."""
        _, args = self.launch()
        first = args["waves"][0][0]
        self.found = [{"id": f"{first['short']}-1", "title": "t", "file": "b.py", "line": 3, "severity": "HIGH",
                       "detail": "d"}]
        self.run_reviewers(args, self.found)
        return args

    def brief(self, ref):
        return subprocess.run([sys.executable, str(SCRIPTS / "briefs.py"), "--ref", ref], env=self.env,
                              capture_output=True, text=True)

    def test_every_reviewer_of_a_full_round_is_given_the_spec_and_its_folder(self):
        out, args = self.launch()
        self.assertEqual(self.decision(out), "allow")
        self.assertGradesAgainstSpec(args)

    def test_a_delta_round_carries_the_spec_too(self):
        args = self.reviewed()
        self.submit_assessment(self.assessment(args["round_ref"], [self.found[0]["id"]]))
        self.commit("b.py", "fixed\n", "fix: b")
        _, second = self.launch()
        self.assertIn(f"git diff {self.head}..HEAD", second["waves"][0][0]["prompt"])
        self.assertGradesAgainstSpec(second)

    def test_the_folder_the_comment_names_is_the_one_graded_against_whatever_the_branch_changed(self):
        (self.root / "dev/demo/specs/002-other").mkdir()
        self.commit("dev/demo/specs/002-other/spec.md", "# Another feature\n", "another spec")
        _, args = self.launch()
        self.assertGradesAgainstSpec(args)
        self.assertNotIn("Another feature", args["waves"][0][0]["prompt"])

    def expected_prompt(self, branch, reviewer, graded=""):
        main = git(self.root, "rev-parse", "main")
        return (f"Review branch {branch} of acme/demo.\nIn {self.root}, run: git diff {main}...HEAD\n"
                "That is the whole change under review.\n\n"
                "Report only what must change before this merges: a defect, a broken contract, a violated project "
                "rule. No style preferences, no praise, no summary. An empty findings list is a normal and expected "
                f"answer.{graded}\n\nAnswer through StructuredOutput, numbering findings {reviewer}-1, {reviewer}-2, ...")

    def test_an_issue_that_needs_no_spec_tells_the_reviewers_so_with_the_reason(self):
        self.comments(speclocation.render_none("docs only"))
        _, args = self.launch()
        for reviewer in args["waves"][0]:
            self.assertIn("needs no spec: docs only", reviewer["prompt"])
            self.assertNotIn("Acceptance criterion", reviewer["prompt"])

    def test_a_branch_naming_no_issue_is_reviewed_with_no_spec_and_reads_no_issue_comments(self):
        git(self.root, "branch", "-m", "chore/no-issue")
        out, args = self.launch()
        self.assertEqual(self.decision(out), "allow")
        self.assertEqual([r["prompt"] for r in args["waves"][0]],
                         [self.expected_prompt("chore/no-issue", r["short"]) for r in args["waves"][0]])
        self.assertNotIn("/comments", Path(self.env["GH_LOG"]).read_text())

    def assertRefused(self, out, *words):
        self.assertEqual(self.decision(out), "deny")
        for word in words:
            self.assertIn(word, self.reason(out))

    def test_a_launch_the_spec_cannot_be_found_for_is_refused_with_its_next_step_and_opens_no_round(self):
        states = {
            "no location comment": (["unrelated chatter"], ["/alq-review:alq-spec #1"]),
            "a folder the checkout does not hold": ([speclocation.render("dev/demo/specs/009-gone", "feat/1-elsewhere")],
                                                    ["dev/demo/specs/009-gone", "feat/1-elsewhere"]),
            "a whole spec in the comment": (["<!-- analitiq-spec -->\n" + self.SPEC], ["alq-spec"]),
            "a path out of the repo": (["<!-- analitiq-spec -->\nspec: ../specs/001-demo\nbranch: feat/1-demo\n"],
                                       ["spec: <folder"]),
            "two location comments": ([speclocation.render(self.FOLDER, "feat/1-demo")] * 2, ["101", "102"]),
        }
        for name, (bodies, words) in states.items():
            with self.subTest(name):
                self.comments(*bodies)
                out, _ = self.launch()
                self.assertRefused(out, *words)
                self.assertNotIn("gh auth status", self.reason(out))
                self.assertEqual(self.saved()["rounds"], [])

    def test_an_unreadable_issue_refuses_the_launch_in_ghs_words_and_opens_no_round(self):
        self.env["GH_COMMENTS_ERROR"] = "HTTP 502: Bad Gateway"
        out, _ = self.launch()
        self.assertRefused(out, "HTTP 502: Bad Gateway")
        self.assertNotIn("no location comment", self.reason(out))
        self.assertEqual(self.saved()["rounds"], [])

    def test_an_assessment_the_spec_cannot_be_found_for_is_refused_the_same_way(self):
        self.reviewed()
        self.comments("unrelated chatter")
        out, _ = self.launch(ASSESS)
        self.assertRefused(out, "/alq-review:alq-spec #1")
        self.env["GH_COMMENTS_ERROR"] = "HTTP 502: Bad Gateway"
        out, _ = self.launch(ASSESS)
        self.assertRefused(out, "HTTP 502: Bad Gateway")

    def test_audit_reviewers_are_not_given_the_spec_text(self):
        _, args = self.launch(stage="audit")
        prompts = [r["prompt"] for wave in args["waves"] for r in wave]
        self.assertEqual(len(prompts), sum(len(wave) for wave in briefs.AUDIT_WAVES))
        for prompt in prompts:
            self.assertNotIn(self.SPEC, prompt)

    def test_an_audit_launch_the_spec_cannot_be_found_for_is_refused_as_an_internal_one_is(self):
        self.comments("unrelated chatter")
        out, _ = self.launch(stage="audit")
        self.assertRefused(out, "/alq-review:alq-spec #1")
        self.assertEqual(self.saved()["rounds"], [])

    def test_the_assessor_brief_carries_the_spec_text_and_its_folder(self):
        args = self.reviewed()
        out, _ = self.launch(ASSESS)
        self.assertEqual(self.decision(out), "allow")
        brief = json.loads(self.brief(args["round_ref"]).stdout)
        self.assertEqual((brief["spec"], brief["spec_folder"]), (self.SPEC, self.FOLDER))

    def test_the_assessor_brief_says_why_there_is_no_spec(self):
        args = self.reviewed()
        self.comments(speclocation.render_none("docs only"))
        brief = json.loads(self.brief(args["round_ref"]).stdout)
        self.assertIn("docs only", brief["spec"])
        self.assertIsNone(brief["spec_folder"])

    def test_briefs_and_gate_name_neither_the_marker_nor_the_comment_lookup(self):
        for name in ("briefs.py", "gate.py"):
            source = (SCRIPTS / name).read_text()
            self.assertFalse("--jq" in source or "MARKER" in source or "issue_comments" in source, name)


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


ODD_BLANKS = ("\u00a0", "\u2028", "\x0b", "\u3000")


class HeldBranch(Gate):
    """A RESHAPE_SPEC or ESCALATE lock: only the user releases it, and no route around it goes unnoticed."""

    def lock(self, verdict="RESHAPE_SPEC", pr=7, repo="acme/demo", branch="feat/1-demo", root=None):
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_ledger(repo, pr) as state:
                state["branch"] = branch
                helpers.add_round(state, head=self.head)
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
        self.assertIn("feat/1-demo", self.say("unlock #7 - the spec comment now says which root is canonical"))
        self.assertEqual(self.edit(), {})

    def test_the_user_unlocks_a_branch_whose_audits_are_spent(self):
        """The refusal said the work is back with the user; the unlock is how they hand it back."""
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_ledger("acme/demo", 7) as state:
                state["branch"] = "feat/1-demo"
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

    def test_a_rescope_releases_a_reshape_spec_lock_and_hands_the_session_the_ruling(self):
        """The user starting the re-scope is the decision the lock waits for; the skill re-scopes from the ruling.
        The alq-spec skill parses this reply by its labels, so the whole of it is pinned."""
        self.lock()
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_ledger("acme/demo", 7) as state:
                ledger.current_round(state)["assessment"]["findings"][0].update(
                    kind="spec_gap", mechanism="the canonical root is chosen round by round")
        said = self.say("/alq-spec rescope #7")
        self.assertEqual(self.edit(), {})
        self.assertEqual(said, (
            "[alq-review] The user unlocked acme/demo#7 (feat/1-demo); its code may change again. "
            f"Re-scope its spec from this RESHAPE_SPEC ruling. Worktree: {self.root}. "
            "Open decision: which root is canonical? Why: because "
            "Spec gaps: the canonical root is chosen round by round (n/a)."))

    def test_the_plugin_qualified_rescope_releases_the_lock_as_the_bare_one_does(self):
        """Claude Code runs a plugin skill as `/alq-review:alq-spec`, and as `/alq-spec` only while no other
        command has that name."""
        self.lock()
        self.assertIn("The user unlocked acme/demo#7", self.say("/alq-review:alq-spec rescope #7"))
        self.assertEqual(self.edit(), {})

    def test_a_rescope_releases_nothing_but_a_reshape_spec_lock(self):
        """An ESCALATE lock asks a question a re-scope does not answer."""
        self.lock(verdict="ESCALATE")
        said = self.say("/alq-spec rescope #7")
        self.assertIn("`unlock #7`", said)
        self.assertIn("nothing was unlocked", said)
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_a_rescope_releases_no_spent_audit_lock_even_when_the_last_audit_ruled_reshape_spec(self):
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_ledger("acme/demo", 7) as state:
                state["branch"] = "feat/1-demo"
                test_policy.spend_audits(state, verdict="RESHAPE_SPEC")
                ledger.current_round(state)["root"] = str(self.root)
        said = self.say("/alq-spec rescope #7")
        self.assertIn("`unlock #7`", said)
        self.assertIn("nothing was unlocked", said)
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_a_rescope_quoted_inside_a_prompt_releases_nothing(self):
        self.lock()
        self.say("Work on this issue:\n\n/alq-spec rescope #7")
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_a_rescope_two_repos_could_mean_releases_nothing(self):
        self.lock()
        self.lock(repo="acme/other")
        self.assertIn("nothing was unlocked", self.say("/alq-spec rescope #7"))
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_a_rescope_naming_no_locked_pr_releases_nothing(self):
        self.lock()
        self.assertIn("nothing was unlocked", self.say("/alq-spec rescope #8"))
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_an_unlock_two_repos_could_mean_is_refused_until_the_repo_is_named(self):
        self.lock()
        self.lock(repo="acme/other")
        self.assertIn("acme/other#7", self.say("unlock #7"))
        self.assertEqual(self.decision(self.edit()), "deny")
        self.say("unlock acme/demo#7")
        self.assertEqual(self.edit(), {})

    def test_an_unlock_or_rescope_parted_by_anything_but_a_blank_releases_nothing(self):
        """A no-break space, a line separator, a vertical tab and an ideographic space: none is typed or seen as a
        blank, so none starts a command or parts its words."""
        self.lock()
        for odd in ODD_BLANKS:
            for prompt in (f"{odd}unlock #7", f"unlock{odd}#7", f"{odd}/alq-spec rescope #7",
                           f"/alq-spec{odd}rescope #7", f"/alq-spec rescope{odd}#7"):
                with self.subTest(prompt=prompt):
                    self.assertEqual(self.say(prompt), "")
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_a_word_that_only_starts_like_a_commands_word_is_not_it(self):
        self.lock()
        for prompt in ("unlocked #7", "unlock#7", "Unlock #7", "/alq-specs rescope #7", "/alq-spec rescoped #7",
                       "alq-spec rescope #7", "/alq-review:alq-spec: rescope #7", "/other:alq-spec rescope #7",
                       "/alq-review:other-alq-spec rescope #7"):
            with self.subTest(prompt=prompt):
                self.assertEqual(self.say(prompt), "")
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_a_prompt_with_too_few_words_for_a_command_is_not_answered(self):
        self.lock()
        for prompt in ("", " \r\n\t", "unlock", "unlock \n", "override", "/alq-spec", "/alq-spec rescope"):
            with self.subTest(prompt=prompt):
                self.assertEqual(self.hook("UserPromptSubmit", prompt=prompt), {})
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_blanks_before_and_between_the_words_of_an_unlock_are_passed_over(self):
        self.lock()
        self.assertIn("The user unlocked acme/demo#7", self.say(" \r\n\tunlock \t\r\n#7\nand carry on"))
        self.assertEqual(self.edit(), {})

    def test_the_word_after_unlock_or_rescope_is_read_whole(self):
        """Each of these was once read as the PR whose number it starts with: the pattern stopped where it stopped
        understanding, and what it stopped at was judged by nothing. Each word has a locked PR of its own to
        release, so one that does release it fails alone."""
        words = ("#{n},", "#{n}.", "#0{n}", "#{wide}", "#{n}\u200b", "#{n}\u200b1", "acme/demo#{n}.", "acme/demo#0{n}",
                 "acme/demo#{wide}", "acme/demo#{n}\u200b1", "acme/demo #{n}")
        typed = [(command, form) for form in words for command in ("unlock", "/alq-spec rescope")]
        for n, (command, form) in enumerate(typed, start=11):
            self.lock(pr=n)
            word = form.format(n=n, wide="".join(chr(0xFF10 + int(digit)) for digit in str(n)))
            with self.subTest(command=command, word=word):
                self.assertIn("names no locked PR, so nothing was unlocked", self.say(f"{command} {word}"))
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            held = sorted(state["pr"] for state in ledger.all_states() if policy.locked(state))
        self.assertEqual(held, list(range(11, 11 + len(typed))))

    def test_a_prs_name_unlocks_whatever_its_capitals(self):
        self.lock()
        self.lock(repo="Acme/Other", pr=9)
        self.assertIn("The user unlocked acme/demo#7", self.say("unlock Acme/Demo#7"))
        self.assertIn("The user unlocked Acme/Other#9", self.say("unlock acme/other#9"))

    def test_a_word_that_is_no_name_does_not_unlock_a_pr_whose_repo_is_no_name(self):
        """Neither reads as a PR's name, and two texts that are both no name are not the same name."""
        self.lock(repo="acm\u00e9/demo")
        for word in ("junk", "acm\u00e9/demo#7", "acme/demo#7"):
            with self.subTest(word=word):
                self.assertIn("names no locked PR, so nothing was unlocked", self.say(f"unlock {word}"))
        self.assertIn("The user unlocked acm\u00e9/demo#7", self.say("unlock #7"))

    def test_an_answer_names_the_command_by_its_words(self):
        self.lock()
        self.assertIn("`unlock #8` names no locked PR", self.say("unlock \t #8\nand more"))
        self.assertIn("`/alq-spec rescope #8` names no locked PR", self.say("/alq-spec  rescope\n#8 now"))

    def test_writing_a_held_branch_through_bash_is_caught_wherever_the_command_runs(self):
        self.lock()
        out = self.bash(f"cd {self.root} && echo changed >> b.py")
        self.assertEqual(out.get("decision"), "block")
        self.assertIn("b.py", out["reason"])
        self.assertIn("`unlock #7`", out["reason"])

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
            state["branch"] = "feat/1-demo"
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
    def test_direct_reviewer_dispatch_from_the_main_thread_is_refused(self):
        call = {"subagent_type": "pr-review-toolkit:code-reviewer", "prompt": "review"}
        self.assertEqual(self.decision(self.hook("PreToolUse", "Agent", call)), "deny")
        self.assertEqual(self.hook("PreToolUse", "Agent", call, agent_id="sub", agent_type="general-purpose"), {})
        self.assertEqual(self.hook("PreToolUse", "Agent", {"subagent_type": "Explore", "prompt": "x"}), {})
        skill = self.hook("PreToolUse", "Skill", {"skill": "pr-review-toolkit:review-pr"})
        self.assertEqual(self.decision(skill), "deny")

    def test_the_pr_audit_skill_is_refused_toward_the_ledgers_audit_round(self):
        audit = self.hook("PreToolUse", "Skill", {"skill": "alq-anti-pattern:pr-audit"})
        self.assertEqual(self.decision(audit), "deny")
        self.assertIn("stage: 'audit'", self.reason(audit))
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

    def test_a_launch_with_no_open_pr_is_only_recorded_in_log_mode(self):
        self.env["GH_OPEN_PR"] = ""
        out = self.hook("PreToolUse", "Workflow", {"name": REVIEW, "args": {"worktree": str(self.root)}}, mode="log")
        self.assertEqual(out, {})
        logged = json.loads((self.state_dir / "gate.log").read_text().splitlines()[-1])
        self.assertEqual((logged["action"], logged["decision"]), ("launch", "would_deny"))

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

    def test_an_assess_launch_refused_in_log_mode_is_recorded_not_blocked(self):
        out = self.hook("PreToolUse", "Workflow", {"name": ASSESS, "args": {"worktree": str(self.root)}}, mode="log")
        self.assertNotEqual(self.decision(out), "deny")
        logged = json.loads((self.state_dir / "gate.log").read_text().splitlines()[-1])
        self.assertEqual((logged["action"], logged["decision"]), ("assess", "would_deny"))


class SpecChecks(Gate):
    """Spec-folder checks run at the first internal round, in enforce."""

    def setUp(self):
        super().setUp()
        self.env["ALQ_REVIEW_SPEC_CHECKS"] = "enforce"

    def commit_spec(self, plan, home="."):
        folder = self.root / home / "specs" / "004-demo"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "plan.md").write_text(plan)
        (folder / "research.md").write_text(test_settled_design.RESEARCH)
        git(self.root, "add", "-A")
        git(self.root, "commit", "-q", "-m", "docs: plan")


class SettledDesign(SpecChecks):
    """The first internal round on a branch that changes a spec folder runs the settled-design check."""

    def test_an_unsettled_folder_refuses_the_first_round_and_names_the_problem(self):
        self.commit_spec("# Plan\n")
        out, _ = self.launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("specs/004-demo/plan.md", self.reason(out))
        self.assertIn("## Mechanisms", self.reason(out))
        self.assertEqual(self.saved()["rounds"], [])

    def test_a_settled_folder_launches(self):
        self.commit_spec(test_settled_design.PLAN)
        self.assertEqual(self.decision(self.launch()[0]), "allow")

    def test_a_spec_folder_under_a_subdirectory_is_graded(self):
        self.commit_spec("# Plan\n", home="plugins/x")
        out, _ = self.launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("plugins/x/specs/004-demo/plan.md", self.reason(out))

    def test_a_branch_that_changes_no_spec_folder_is_not_checked(self):
        folder = self.root / "specs" / "004-demo"
        folder.mkdir(parents=True)
        (folder / "plan.md").write_text("# Plan\n")
        git(self.root, "add", "specs")
        git(self.root, "commit", "-q", "-m", "docs: unsettled plan")
        git(self.root, "push", "-q", "origin", "HEAD:main")
        git(self.root, "fetch", "-q", "origin")
        (self.root / "docs" / "guide").mkdir(parents=True)
        (self.root / "docs" / "guide" / "a.md").write_text("prose\n")
        git(self.root, "add", "docs")
        git(self.root, "commit", "-q", "-m", "docs: a nested folder that is not a spec folder")
        self.assertEqual(self.decision(self.launch()[0]), "allow")

    def test_a_branch_that_deletes_a_spec_folder_is_not_checked_for_it(self):
        folder = self.root / "specs" / "004-demo"
        folder.mkdir(parents=True)
        (folder / "plan.md").write_text("# Plan\n")
        git(self.root, "add", "specs")
        git(self.root, "commit", "-q", "-m", "docs: unsettled plan")
        git(self.root, "push", "-q", "origin", "HEAD:main")
        git(self.root, "fetch", "-q", "origin")
        git(self.root, "rm", "-q", "-r", "specs")
        git(self.root, "commit", "-q", "-m", "docs: drop the folder")
        self.assertEqual(self.decision(self.launch()[0]), "allow")

    def test_a_check_that_cannot_run_refuses_the_round(self):
        self.commit_spec(test_settled_design.PLAN)
        (self.root / "specs" / "004-demo" / "plan.md").write_bytes(b"\xff\xfe not utf-8\n")
        git(self.root, "commit", "-q", "-am", "docs: unreadable plan")
        out, _ = self.launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("could not run", self.reason(out))
        self.assertEqual(self.saved()["rounds"], [])

    def test_an_audit_round_is_not_checked(self):
        self.commit_spec("# Plan\n")
        self.assertEqual(self.decision(self.launch(stage="audit")[0]), "allow")

    def test_later_rounds_are_not_checked(self):
        self.commit_spec(test_settled_design.PLAN)
        _, args = self.launch()
        self.run_reviewers(args, [])
        self.commit_spec("# Plan\n")
        self.assertEqual(self.decision(self.launch()[0]), "allow")

    def test_in_log_mode_the_problem_is_recorded_and_the_round_launches(self):
        self.env["ALQ_REVIEW_SPEC_CHECKS"] = "log"
        self.commit_spec("# Plan\n")
        self.assertEqual(self.decision(self.launch()[0]), "allow")
        entries = [json.loads(line) for line in (self.state_dir / "gate.log").read_text().splitlines()]
        [logged] = [e for e in entries if e["decision"] == "would_deny"]
        self.assertEqual(logged["action"], "launch")
        self.assertIn("## Mechanisms", logged["reason"])

    def test_the_checks_ship_in_enforce_mode(self):
        config = json.loads((SCRIPTS.parent / "config.json").read_text())
        self.assertEqual(config["spec_checks"], "enforce")


class DesignDocuments(SpecChecks):
    """Spec 004 FR-004: a branch that changes a design document must also change a spec folder."""

    def commit_file(self, name):
        (self.root / name).parent.mkdir(parents=True, exist_ok=True)
        self.commit(name, "prose\n", f"docs: {name}")

    def test_a_design_document_without_a_spec_folder_refuses_the_first_round(self):
        for name in ("README.md", ".claude/plugins/x/README.md", "CLAUDE.md", "AGENTS.md",
                     "docs/adr/0001-a.md", ".claude/rules/a.md"):
            with self.subTest(name=name):
                self.setUp()
                self.commit_file(name)
                out, _ = self.launch()
                self.assertEqual(self.decision(out), "deny")
                self.assertIn(f"{name}:1: ", self.reason(out))
                self.assertIn("a design-document change comes with a spec folder", self.reason(out))
                self.assertIn("Next step: settle the design in a spec folder (/alq-review:alq-spec", self.reason(out))
                self.assertEqual(self.saved()["rounds"], [])

    def test_a_design_document_with_a_settled_spec_folder_launches(self):
        self.commit_file("README.md")
        self.commit_spec(test_settled_design.PLAN)
        self.assertEqual(self.decision(self.launch()[0]), "allow")

    def test_the_spec_folder_that_comes_with_it_is_still_graded(self):
        self.commit_file("README.md")
        self.commit_spec("# Plan\n")
        out, _ = self.launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("## Mechanisms", self.reason(out))

    def test_a_design_document_with_a_settled_spec_folder_under_a_subdirectory_launches(self):
        self.commit_file("plugins/x/README.md")
        self.commit_spec(test_settled_design.PLAN, home="plugins/x")
        self.assertEqual(self.decision(self.launch()[0]), "allow")

    def test_deleting_a_spec_folder_under_a_subdirectory_does_not_stand_in_for_one(self):
        self.commit_spec(test_settled_design.PLAN, home="plugins/x")
        git(self.root, "push", "-q", "origin", "HEAD:main")
        git(self.root, "fetch", "-q", "origin")
        git(self.root, "rm", "-q", "-r", "plugins/x/specs")
        git(self.root, "commit", "-q", "-m", "docs: drop the finished spec")
        self.commit_file("plugins/x/README.md")
        out, _ = self.launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("plugins/x/README.md:1: ", self.reason(out))

    def test_deleting_a_spec_folder_does_not_stand_in_for_one(self):
        self.commit_spec(test_settled_design.PLAN)
        git(self.root, "push", "-q", "origin", "HEAD:main")
        git(self.root, "fetch", "-q", "origin")
        git(self.root, "rm", "-q", "-r", "specs")
        git(self.root, "commit", "-q", "-m", "docs: drop the finished spec")
        self.commit_file("README.md")
        out, _ = self.launch()
        self.assertEqual(self.decision(out), "deny")
        self.assertIn("README.md:1: ", self.reason(out))

    def test_other_documents_are_not_design_documents(self):
        for name in ("docs/guide/a.md", "READMEx.md", "rules/a.md"):
            with self.subTest(name=name):
                self.setUp()
                self.commit_file(name)
                self.assertEqual(self.decision(self.launch()[0]), "allow")

    def test_in_log_mode_the_problem_is_recorded_and_the_round_launches(self):
        self.env["ALQ_REVIEW_SPEC_CHECKS"] = "log"
        self.commit_file("README.md")
        self.assertEqual(self.decision(self.launch()[0]), "allow")
        entries = [json.loads(line) for line in (self.state_dir / "gate.log").read_text().splitlines()]
        [logged] = [e for e in entries if e["decision"] == "would_deny"]
        self.assertIn("README.md", logged["reason"])

    def test_a_malformed_pattern_list_refuses_the_round(self):
        self.commit_file("README.md")
        with mock.patch.object(config, "load", return_value={"design_documents": "README.md"}):
            reason = gate._spec_problems(str(self.root), git(self.root, "rev-parse", "main"))
        self.assertIn("could not run", reason)

    def run_by_hand(self):
        return subprocess.run([sys.executable, str(SCRIPTS / "settled_design.py"), "--branch", str(self.root), "main"],
                              capture_output=True, text=True)

    def test_run_by_hand_against_the_checkout_it_gives_the_gates_result_and_changes_nothing(self):
        self.commit_file("README.md")
        before = git(self.root, "status", "--porcelain", "--ignored")
        done = self.run_by_hand()
        self.assertEqual(done.returncode, 1, done.stderr)
        self.assertEqual(git(self.root, "status", "--porcelain", "--ignored"), before)
        reason = self.reason(self.launch()[0])
        lines = done.stderr.splitlines()
        self.assertTrue(lines)
        for line in lines:
            self.assertIn(line, reason)

    def test_run_by_hand_against_a_settled_branch_passes(self):
        self.commit_file("README.md")
        self.commit_spec(test_settled_design.PLAN)
        done = self.run_by_hand()
        self.assertEqual((done.returncode, done.stderr), (0, ""))


    def spec_folders_by_hand(self):
        return subprocess.run([sys.executable, str(SCRIPTS / "settled_design.py"), "--spec-folders", str(self.root),
                               "main"], capture_output=True, text=True)

    def test_spec_folders_lists_the_folders_the_gate_grades(self):
        self.commit_spec(test_settled_design.PLAN)
        self.commit_spec(test_settled_design.PLAN, home="plugins/x")
        self.commit_file("plugins/x/specs/notes.md")
        done = self.spec_folders_by_hand()
        self.assertEqual((done.returncode, done.stdout, done.stderr),
                         (0, "plugins/x/specs/004-demo\nspecs/004-demo\n", ""))

    def test_spec_folders_of_a_branch_without_one_prints_nothing(self):
        self.commit_file("README.md")
        done = self.spec_folders_by_hand()
        self.assertEqual((done.returncode, done.stdout), (0, ""))


if __name__ == "__main__":
    unittest.main()
