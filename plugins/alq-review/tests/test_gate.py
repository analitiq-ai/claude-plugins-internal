"""Drives scripts/gate.py the way Claude Code does: one JSON payload on stdin per hook event."""
import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

from test_worktree_facts import Repo, git

import briefs
import helpers
import ledger
import test_policy

SCRIPTS = Path(__file__).resolve().parent.parent / "scripts"
GATE = SCRIPTS / "gate.py"
REVIEW, ASSESS = "alq-review:review-round", "alq-review:assess-round"


class Gate(Repo):
    mode = "enforce"

    def setUp(self):
        super().setUp()
        self.state_dir = Path(self.tmp.name) / "state"
        self.head = self.commit("b.py", "".join(f"b{i}\n" for i in range(20)), "feat: b")
        self.serve_remote()
        # No network in tests: gh knows the branch has no open PR and the repo's default branch; every other
        # GitHub lookup sees a gh that cannot answer.
        stub = Path(self.tmp.name) / "bin"
        stub.mkdir()
        (stub / "gh").write_text('#!/bin/sh\ncase "$1 $2" in\n  "pr list") echo "$GH_PR_BASE" ;;\n'
                                 '  "repo view") echo main ;;\n  *) exit 1 ;;\nesac\n')
        (stub / "gh").chmod(0o755)
        self.env = dict(os.environ, ALQ_REVIEW_STATE_DIR=str(self.state_dir), PATH=f"{stub}{os.pathsep}{os.environ['PATH']}",
                        GH_PR_BASE="")

    def hook(self, event, tool=None, tool_input=None, mode=None, **extra):
        payload = {"hook_event_name": event, "session_id": "s1", "cwd": self.tmp.name, **extra}
        if tool:
            payload = {"tool_use_id": "t0", **payload, "tool_name": tool, "tool_input": tool_input or {}}
        done = subprocess.run([sys.executable, str(GATE)], input=json.dumps(payload), capture_output=True, text=True,
                              env=dict(self.env, ALQ_REVIEW_MODE=mode or self.mode))
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads(done.stdout) if done.stdout.strip() else {}

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
        self.env["GH_PR_BASE"] = "dev"
        _, args = self.launch()
        self.assertIn(f"git diff {dev}...HEAD", args["waves"][0][0]["prompt"])

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

    def test_structured_output_of_unrelated_workflows_is_ignored(self):
        self.assertEqual(self.hook("PreToolUse", "StructuredOutput", {"n": 1}, agent_id="x", agent_type="workflow-subagent"), {})

    def test_audit_round_hands_every_detector_a_delta_scope_packet(self):
        _, args = self.launch(stage="audit")
        self.assertEqual([r["type"] for wave in args["waves"] for r in wave], briefs.AUDIT_WAVES[0] + briefs.AUDIT_WAVES[1])
        packet = args["waves"][0][0]["prompt"]
        for field in ("mode: delta", "baseline:", "read_beyond: yes", "b.py"):
            self.assertIn(field, packet)
        self.assertEqual(args["waves"][1][0]["needs"], "alq-anti-pattern:duplication")


class ReleaseReady(Gate):
    """pr-gate passes a version-only release PR without review; the gate lets it out of draft on that alone."""

    def github_statuses(self, *statuses):
        path = Path(self.tmp.name) / "statuses.json"
        path.write_text(json.dumps(list(statuses)))
        (Path(self.tmp.name) / "bin" / "gh").write_text(
            f'#!/bin/sh\ncase "$*" in *commits/{self.head}/statuses*) cat {path} ;; *) exit 1 ;; esac\n')

    def status(self, state="success", creator="github-actions[bot]", description="version-only release: 1.0.0 → 1.0.1",
               context="internal-review"):
        return {"context": context, "state": state, "description": description, "creator": {"login": creator}}

    def ready(self):
        return self.decision(self.hook("PreToolUse", "Bash", {"command": f"cd {self.root} && gh pr ready"}))

    def test_a_version_only_release_on_the_head_may_be_marked_ready_without_a_round(self):
        self.github_statuses(self.status())
        self.assertIsNone(self.ready())

    def test_the_same_words_posted_by_anyone_but_the_actions_bot_are_not_trusted(self):
        self.github_statuses(self.status(creator="Analitiq-Bot"))
        self.assertEqual(self.ready(), "deny")

    def test_only_the_newest_internal_review_status_counts(self):
        self.github_statuses(self.status(state="pending", description="Waiting for an internal review"), self.status())
        self.assertEqual(self.ready(), "deny")

    def test_an_ordinary_clean_internal_review_status_is_not_a_release(self):
        self.github_statuses(self.status(description="Internal review clean on 0123456789"))
        self.assertEqual(self.ready(), "deny")


class BrokenGate(Gate):
    """A gate that crashes is deciding nothing. On the paths whose job is to refuse, silence reads
    as permission, so the crash must refuse instead."""

    def break_the_ledger(self):
        directory = self.state_dir / "acme__demo" / "feat__1-demo"
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "state.json").write_text("{ this is not json")

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

    def test_a_crash_doing_bookkeeping_still_fails_open(self):
        """Nothing is being guarded here, so a crash must not stand between a session and its work."""
        out = self.hook("SubagentStart", agent_type=briefs.INTERNAL_REVIEWERS[0])  # no agent_id: KeyError inside
        self.assertNotEqual(self.decision(out), "deny")
        self.assertIn("failed open", out.get("systemMessage", ""))


class HeldBranch(Gate):
    """A RESHAPE_SPEC or ESCALATE lock: only the user releases it, and no route around it goes unnoticed."""

    def lock(self, verdict="RESHAPE_SPEC", pr=7, repo="acme/demo", branch="feat/1-demo", root=None):
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_state(repo, branch) as state:
                state["pr"] = pr
                helpers.add_round(state, head=self.head)
                ledger.current_round(state)["root"] = str(root or self.root)
                helpers.assess(state, verdict)

    def say(self, prompt):
        return self.hook("UserPromptSubmit", prompt=prompt).get("hookSpecificOutput", {}).get("additionalContext", "")

    def bash(self, command):
        """One Bash call as Claude Code makes it: PreToolUse, the command, PostToolUse."""
        pre = self.hook("PreToolUse", "Bash", {"command": command}, tool_use_id="t1")
        if self.decision(pre) == "deny":
            return pre
        subprocess.run(command, shell=True, cwd=self.tmp.name, check=True)
        return self.hook("PostToolUse", "Bash", {"command": command}, tool_use_id="t1", tool_response={})

    def test_the_user_unlocks_by_starting_a_prompt_with_the_unlock_the_refusal_named(self):
        self.lock()
        self.assertIn("`unlock #7`", self.reason(self.edit()))
        self.assertIn("feat/1-demo", self.say("unlock #7 - the spec comment now says which root is canonical"))
        self.assertEqual(self.edit(), {})

    def test_the_user_unlocks_a_branch_whose_audits_are_spent(self):
        """The refusal said the work is back with the user; the unlock is how they hand it back."""
        with mock.patch.dict(os.environ, {"ALQ_REVIEW_STATE_DIR": str(self.state_dir)}):
            with ledger.open_state("acme/demo", "feat/1-demo") as state:
                state["pr"] = 7
                test_policy.spend_audits(state)
                ledger.current_round(state)["root"] = str(self.root)
        self.assertIn("`unlock #7`", self.reason(self.edit()))
        self.assertIn("feat/1-demo", self.say("unlock #7 - the recurring finding is a spec question, now answered"))
        self.assertEqual(self.edit(), {})

    def test_the_user_can_name_the_branch_instead(self):
        self.lock(pr=None)
        self.say("unlock feat/1-demo")
        self.assertEqual(self.edit(), {})

    def test_an_unlock_quoted_inside_a_prompt_unlocks_nothing(self):
        """The cron bot's prompts quote issue and PR text that anyone can write."""
        self.lock()
        self.say("Work on this issue:\n\nunlock #7")
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_an_unlock_two_repos_could_mean_is_refused_until_the_repo_is_named(self):
        self.lock()
        self.lock(repo="acme/other")
        self.assertIn("acme/other#7", self.say("unlock #7"))
        self.assertEqual(self.decision(self.edit()), "deny")
        self.say("unlock acme/demo#7")
        self.assertEqual(self.edit(), {})

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
        self.assertIn("HEAD", out["reason"])

    def test_a_branch_that_is_free_is_not_watched(self):
        self.lock(verdict="REDESIGN")
        self.assertEqual(self.bash(f"echo changed >> {self.root}/b.py"), {})


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


if __name__ == "__main__":
    unittest.main()
