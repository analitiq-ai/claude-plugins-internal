"""The plugin's on/off switch (spec 016): the session's state, the keyword, and what off stops, as Claude Code
drives the gate."""
import json
import os
import sqlite3
import subprocess
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest import mock

from paths import PLUGIN

from test_claim_gate import CONTEST, V, ClaimGate
import test_gate
from test_gate import ASSESS, GATE, REVIEW, Gate
from test_shim_gate import FIXED, ShimGate
from test_worktree_facts import git

import briefs
import claimcheck
import hookio
import ledger
import policy
import shell


class SwitchState(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.state = Path(tmp.name)
        patched = mock.patch.dict(os.environ, {"REVIEWER_STATE_DIR": str(self.state)})
        patched.start()
        self.addCleanup(patched.stop)

    def off_file(self, session="s1"):
        return self.state / "sessions" / f"{session}.off.json"

    def write(self, text, session="s1"):
        self.off_file(session).parent.mkdir(parents=True, exist_ok=True)
        self.off_file(session).write_text(text)

    def test_a_session_with_no_file_is_on_and_asking_creates_nothing(self):
        self.assertEqual(hookio.switch_state({"session_id": "s1"}), "on")
        self.assertEqual(list(self.state.iterdir()), [])

    def test_a_file_of_the_recorded_shape_is_off(self):
        self.write(json.dumps({"at": "2026-10-07T10:00:00Z", "by": "reviewer off"}))
        self.assertEqual(hookio.switch_state({"session_id": "s1"}), "off")
        self.assertEqual(sorted(p.name for p in self.off_file().parent.iterdir()), ["s1.off.json"])

    def test_a_sessions_file_is_off_for_that_session_and_no_other(self):
        self.write(json.dumps({"at": "2026-10-07T10:00:00Z", "by": "reviewer off"}))
        self.assertEqual(hookio.switch_state({"session_id": "s1"}), "off")
        self.assertEqual(hookio.switch_state({"session_id": "s2"}), "on")

    def test_a_file_of_any_other_shape_is_unreadable_and_logged(self):
        for i, text in enumerate(["not json", "[]", json.dumps({"at": "2026-10-07T10:00:00Z"}),
                                  json.dumps({"at": 1, "by": "reviewer off"}),
                                  json.dumps({"at": "2026-10-07T10:00:00Z", "by": "x", "more": 1})], 1):
            with self.subTest(text=text):
                self.write(text)
                self.assertEqual(hookio.switch_state({"session_id": "s1"}), "unreadable")
                self.assertEqual((self.state / "errors.log").read_text().count("s1.off.json"), i)

    def test_a_file_that_cannot_be_opened_as_text_is_unreadable(self):
        self.write("x")
        self.off_file().write_bytes(b"\xff\xfe")
        self.assertEqual(hookio.switch_state({"session_id": "s1"}), "unreadable")
        self.off_file().unlink()
        self.off_file().mkdir()
        self.assertEqual(hookio.switch_state({"session_id": "s1"}), "unreadable")
        self.assertEqual(len((self.state / "errors.log").read_text().splitlines()), 2)

    def test_a_session_id_that_is_not_a_plain_name_holds_no_state(self):
        for session in ("../s1", "a/b", "", None):
            with self.subTest(session=session):
                payload = {} if session is None else {"session_id": session}
                self.assertEqual(hookio.switch_state(payload), "on")
                with self.assertRaises(ValueError):
                    hookio.session_file(payload)
        self.assertFalse((self.state / "sessions").exists())


WORKFLOWS = (REVIEW, ASSESS, "reviewer:claim-check", "reviewer:shim-check")


class Switch:
    """Helpers for the tests that drive the gate: type to a session, and look at what it left behind."""

    def say(self, prompt, session="s1"):
        return self.hook("UserPromptSubmit", prompt=prompt, session_id=session)

    def turn_off(self, session="s1"):
        return self.say("reviewer off", session)

    def turn_on(self, session="s1"):
        return self.say("reviewer on", session)

    def off_path(self, session="s1"):
        return self.state_dir / "sessions" / f"{session}.off.json"

    def write_off_file(self, text=None, session="s1"):
        self.off_path(session).parent.mkdir(parents=True, exist_ok=True)
        self.off_path(session).write_text(text or json.dumps({"at": "2026-10-07T10:00:00Z", "by": "reviewer off"}))

    def gate_log(self):
        path = self.state_dir / "gate.log"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def github_calls(self):
        path = Path(self.env["GH_LOG"])
        return path.read_text() if path.exists() else ""

    def ledger_rows(self):
        """The ledger's rows, not its bytes (the write-ahead log makes those unstable), table by table."""
        db = self.state_dir / "ledger.db"
        if not db.exists():
            return {}
        with closing(sqlite3.connect(db)) as conn:
            tables = [t for (t,) in conn.execute("select name from sqlite_master where type = 'table' order by name")]
            return {t: conn.execute(f"select * from {t} order by 1, 2").fetchall() for t in tables}

    def unassessed(self):
        """A branch whose round has a finding nobody assessed yet, so edits are refused."""
        _, args = self.launch()
        first = args["waves"][0][0]
        found = [{"id": f"{first['short']}-1", "title": "t", "file": "b.py", "line": 3, "severity": "HIGH", "detail": "d"}]
        self.run_reviewers(args, found)
        return args

    def assertStoppedByOff(self, call):
        """`call` is refused with the plugin on; once it is off, it gets no decision, and nothing is logged or asked
        of GitHub."""
        self.assertEqual(self.decision(call()), "deny")
        self.turn_off()
        logged, asked = self.gate_log(), self.github_calls()
        self.assertEqual(call(), {})
        self.assertEqual((self.gate_log(), self.github_calls()), (logged, asked))

    def bash_call(self, command):
        return lambda: self.hook("PreToolUse", "Bash", {"command": command}, cwd=str(self.root))


class Keyword(Switch, Gate):
    def test_off_is_answered_to_the_user_and_the_agent_and_recorded_in_a_file(self):
        out = self.turn_off()
        said = "[reviewer] reviewer is off for this session."
        self.assertIn(said, out["systemMessage"])
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "UserPromptSubmit")
        self.assertIn(said, out["hookSpecificOutput"]["additionalContext"])
        recorded = json.loads(self.off_path().read_text())
        self.assertEqual(sorted(recorded), ["at", "by"])
        self.assertEqual((type(recorded["at"]), recorded["by"]), (str, "reviewer off"))

    def test_on_answers_and_deletes_the_file(self):
        self.turn_off()
        self.assertTrue(self.off_path().exists())
        out = self.turn_on()
        self.assertIn("reviewer is on again.", out["systemMessage"])
        self.assertIn("reviewer is on again.", out["hookSpecificOutput"]["additionalContext"])
        self.assertFalse(self.off_path().exists())

    def test_the_keyword_is_read_after_leading_whitespace_and_only_its_first_line_is_kept(self):
        self.say("  \n reviewer off\nand then carry on")
        self.assertEqual(json.loads(self.off_path().read_text())["by"], "reviewer off")

    def test_a_switch_parted_by_anything_but_a_blank_is_not_a_switch(self):
        for odd in test_gate.ODD_BLANKS:
            for prompt in (f"{odd}reviewer off", f"reviewer{odd}off"):
                with self.subTest(prompt=prompt):
                    self.assertEqual(self.say(prompt), {})
        self.assertFalse(self.off_path().exists())

    def test_the_switchs_line_ends_at_a_line_break_and_nowhere_else(self):
        for odd in ("\u2028", "\x0b", "\x0c", "\x85"):
            with self.subTest(odd=odd):
                self.assertIn("is not a switch, so nothing changed.", self.say(f"reviewer off{odd}carry on")["systemMessage"])
        self.assertFalse(self.off_path().exists())

    def test_the_first_word_without_on_or_off_after_it_is_answered_with_the_two_forms(self):
        for prompt in ("reviewer", "reviewer offline", "reviewer off.", "reviewer\noff", "reviewer is broken",
                       "reviewer is off", "reviewer on off"):
            with self.subTest(prompt=prompt):
                out = self.say(prompt)
                line = prompt.split("\n")[0]
                for text in (out["systemMessage"], out["hookSpecificOutput"]["additionalContext"]):
                    self.assertIn(f'"{line}" is not a switch, so nothing changed. Type reviewer off or reviewer on.', text)
                self.assertEqual(self.gate_log()[-1]["decision"], "unknown")
        self.assertFalse(self.off_path().exists())

    def test_a_first_word_that_is_not_the_plugins_name_is_not_answered(self):
        for prompt in ("reviewer: turn it off", "reviewers off", "Reviewer off", "`reviewer off`"):
            with self.subTest(prompt=prompt):
                self.assertEqual(self.say(prompt), {})
        self.assertFalse(self.off_path().exists())

    def test_a_switch_in_the_middle_of_a_prompt_is_not_a_switch(self):
        self.assertEqual(self.say("please type reviewer off for me"), {})
        self.assertEqual(self.say("Work on this issue:\n\nreviewer off"), {})
        self.assertFalse(self.off_path().exists())

    def test_each_keyword_leaves_one_gate_log_line_naming_what_it_did(self):
        self.turn_off()
        self.turn_off()
        self.turn_on()
        self.turn_on()
        self.say("reviewer off please")
        lines = [e for e in self.gate_log() if e["action"] == "switch"]
        self.assertEqual([e["decision"] for e in lines], ["off", "unchanged", "on", "unchanged", "unknown"])
        self.assertEqual([e["reason"] for e in lines][-1], "reviewer off please")
        self.assertEqual({e["session"] for e in lines}, {"s1"})

    def test_repeating_a_keyword_changes_nothing_and_says_so(self):
        self.assertIn("reviewer was already on.", self.turn_on()["systemMessage"])
        self.assertFalse(self.off_path().exists())
        self.turn_off()
        before = self.off_path().read_text()
        self.assertIn("reviewer was already off.", self.turn_off()["systemMessage"])
        self.assertEqual(self.off_path().read_text(), before)

    def test_a_further_word_changes_nothing_and_is_answered_with_the_two_forms(self):
        for prompt, then in (("reviewer off please", "on"), ("reviewer on claim-check", "off")):
            with self.subTest(prompt=prompt):
                (self.turn_on if then == "on" else self.turn_off)()
                before = self.off_path().read_text() if self.off_path().exists() else None
                out = self.say(prompt)
                for text in (out["systemMessage"], out["hookSpecificOutput"]["additionalContext"]):
                    self.assertIn(f'"{prompt}" is not a switch, so nothing changed. Type reviewer off or reviewer on.', text)
                self.assertEqual(self.off_path().read_text() if self.off_path().exists() else None, before)
                self.assertEqual(self.gate_log()[-1]["decision"], "unknown")

    def test_the_line_a_further_word_quotes_and_logs_stops_at_200_characters(self):
        out = self.say("reviewer off " + "x" * 300)
        kept = ("reviewer off " + "x" * 300)[:200]
        self.assertEqual(self.gate_log()[-1]["reason"], kept)
        self.assertIn(f'"{kept}" is not a switch', out["systemMessage"])

    def test_off_belongs_to_the_session_that_typed_it(self):
        self.unassessed()
        self.turn_off()
        self.assertEqual(self.edit(), {})
        self.assertEqual(self.decision(self.edit(session_id="s2")), "deny")


class StoppedWhileOff(Switch, Gate):
    def test_an_edit_on_a_branch_with_an_unassessed_round(self):
        self.unassessed()
        self.assertStoppedByOff(self.edit)

    def test_a_push_of_a_branch_with_an_unassessed_round(self):
        self.unassessed()
        self.assertStoppedByOff(self.bash_call(f"git -C {self.root} push"))

    def test_marking_a_pr_ready_without_a_clean_round(self):
        self.assertStoppedByOff(self.bash_call(f"cd {self.root} && gh pr ready"))

    def test_the_attestation_comment_without_a_clean_round(self):
        self.assertStoppedByOff(self.bash_call(
            f"cd {self.root} && gh pr comment --body '{shell.ATTESTATION_MARKER} Internal review clean.'"))

    def test_an_agent_unlocking_the_ledger(self):
        self.assertStoppedByOff(self.bash_call(
            f"python3 {GATE.parent}/ledger.py unlock --worktree {self.root} --reason x"))

    def test_dispatching_an_internal_reviewer_by_hand(self):
        call = {"subagent_type": briefs.INTERNAL_REVIEWERS[0], "prompt": "review"}
        self.assertStoppedByOff(lambda: self.hook("PreToolUse", "Agent", call))

    def test_the_review_skill_that_runs_reviewers_by_hand(self):
        self.assertStoppedByOff(lambda: self.hook("PreToolUse", "Skill", {"skill": "pr-review-toolkit:review-pr"}))

    def test_a_reviewers_invalid_report_is_neither_denied_nor_recorded(self):
        _, args = self.launch()
        first = args["waves"][0][0]
        dup = [{"id": f"{first['short']}-1", "title": "t", "file": "b.py", "severity": "LOW", "detail": "d"}] * 2
        body = {"round_ref": args["round_ref"], "findings": dup}
        report = lambda event: self.hook(event, "StructuredOutput", body, agent_id="a1", agent_type=first["type"])
        self.assertEqual(self.decision(report("PreToolUse")), "deny")
        self.turn_off()
        before = self.saved()["rounds"]
        self.assertEqual((report("PreToolUse"), report("PostToolUse")), ({}, {}))
        self.assertEqual(self.saved()["rounds"], before)

    def test_a_bash_command_that_changes_a_held_branch_is_not_watched(self):
        test_gate.HeldBranch.lock(self)
        command = f"echo changed >> {self.root}/b.py"
        self.assertEqual(self.bash(command).get("decision"), "block")
        git(self.root, "checkout", "--", "b.py")
        held = self.state_dir / "sessions" / "s1.held.json"
        held.unlink()
        self.turn_off()
        self.assertEqual(self.bash(command), {})
        self.assertFalse(held.exists())

    drop = test_gate.GithubRound.drop

    def test_a_polled_drop_is_left_in_the_inbox_until_the_plugin_is_on_again(self):
        self.turn_off()
        self.drop(["https://github.com/acme/demo/pull/7#discussion_r1"])
        dropped = self.state_dir / "inbox" / "acme__demo__7.json"
        self.assertEqual(self.edit(), {})
        self.assertTrue(dropped.exists())
        self.turn_on()
        self.assertIn(ASSESS, self.reason(self.edit()))
        self.assertFalse(dropped.exists())


class StoppedCommit(Switch, ClaimGate):
    def test_a_commit_the_claim_check_has_not_seen(self):
        self.stage("README.md", "The validator rejects an empty list.\n")
        self.assertStoppedByOff(self.bash_call(f"git -C {self.root} commit -q -m change"))


class StillRunsWhileOff(Switch, Gate):
    def test_unlock_releases_a_locked_ledger(self):
        test_gate.HeldBranch.lock(self)
        self.turn_off()
        self.assertIn("feat/1-demo", self.say("unlock #7")["hookSpecificOutput"]["additionalContext"])
        self.assertFalse(policy.locked(self.saved()))

    def test_reviewers_in_flight_are_still_counted(self):
        reviewer = {"agent_id": "r1", "agent_type": briefs.INTERNAL_REVIEWERS[0]}
        self.turn_off()
        self.hook("SubagentStart", **reviewer)
        inflight = self.state_dir / "sessions" / "s1.json"
        self.assertEqual(list(json.loads(inflight.read_text())), ["r1"])
        self.hook("SubagentStop", **reviewer)
        self.assertEqual(json.loads(inflight.read_text()), {})


class StillRunsWhileOffClaim(Switch, ClaimGate):
    def test_unlock_claim_releases_the_hold_and_the_contest_judge_stays_confined(self):
        for text in V[:3]:
            self.wrong(text)
        cid = f"claim-{claimcheck.claim_id('README.md', V[0])}"
        self.assertEqual(self.decision(self.git_commit()), "deny")
        self.turn_off()
        self.assertIn("The user released", json.dumps(self.say(f"unlock {cid}")))
        refused = self.hook("PreToolUse", "WebFetch", {"url": "https://elsewhere.example/", "prompt": "p"},
                            agent_id="c1", agent_type=CONTEST)
        self.assertEqual(self.decision(refused), "deny")
        self.turn_on()
        self.assertNotEqual(self.decision(self.git_commit()), "deny")


class StillRunsWhileOffShim(Switch, ShimGate):
    def test_override_still_marks_a_chain_overridden(self):
        tree = self.labelled({"b.py": (FIXED, "CODE")})
        self.record(tree, verdict="patch", kind="fix", level="symptom", coverage="all", same_operation=[], callers=[])
        self.chain()
        self.turn_off()
        self.assertIn("switched the shim check off", json.dumps(self.say("override shim-" + "c" * 16)))
        with self.shims() as shims:
            self.assertEqual(shims.bug("c" * 16)["state"], "overridden")


class LaunchWhileOff(Switch, Gate):
    def test_the_four_workflows_are_answered_off_in_both_modes_and_open_nothing(self):
        self.turn_off()
        before = self.ledger_rows()
        for mode in ("enforce", "log"):
            self.mode = mode
            for name in WORKFLOWS:
                with self.subTest(mode=mode, workflow=name):
                    out, _ = self.launch(name)
                    self.assertEqual(self.decision(out), "deny")
                    self.assertIn(f"reviewer is off for this session, so {name} does not run. Carry on without it.",
                                  self.reason(out))
        self.assertEqual(self.ledger_rows(), before)

    def test_any_other_workflow_is_left_alone(self):
        self.turn_off()
        self.assertEqual(self.hook("PreToolUse", "Workflow", {"name": "other:workflow", "args": {}}), {})


class UnreadableSwitch(Switch, Gate):
    def test_a_prompt_is_told_the_plugin_counts_as_on_and_an_edit_is_still_refused(self):
        self.unassessed()
        self.assertEqual(self.decision(self.edit()), "deny")
        self.write_off_file("not json")
        self.assertIn("so the plugin counts as on", self.say("hello")["systemMessage"])
        self.assertEqual(self.decision(self.edit()), "deny")

    def test_an_unlock_typed_then_is_answered_with_both_the_notice_and_the_release(self):
        test_gate.HeldBranch.lock(self)
        self.write_off_file("not json")
        out = self.say("unlock #7")
        self.assertIn("so the plugin counts as on", out["systemMessage"])
        self.assertIn("feat/1-demo", out["hookSpecificOutput"]["additionalContext"])

    def test_a_resumed_session_is_told_the_plugin_counts_as_on(self):
        self.write_off_file("not json")
        out = self.hook("SessionStart", source="resume")
        self.assertIn("so the plugin counts as on", out["systemMessage"])
        self.assertNotIn("hookSpecificOutput", out)

    def test_off_rewrites_the_file_and_on_deletes_it(self):
        self.unassessed()
        for then in ("off", "on"):
            self.write_off_file("not json")
            (self.turn_off if then == "off" else self.turn_on)()
            if then == "off":
                recorded = json.loads(self.off_path().read_text())
                self.assertEqual(sorted(recorded), ["at", "by"])
                self.assertEqual(self.edit(), {})
            else:
                self.assertFalse(self.off_path().exists())
                self.assertEqual(self.decision(self.edit()), "deny")


class SessionStart(Switch, Gate):
    def test_a_resumed_session_that_is_off_tells_the_user_and_the_agent(self):
        self.write_off_file()
        out = self.hook("SessionStart", source="resume")
        self.assertIn("reviewer is off in this session.", out["systemMessage"])
        self.assertEqual(out["hookSpecificOutput"]["hookEventName"], "SessionStart")
        self.assertIn("reviewer is off in this session.", out["hookSpecificOutput"]["additionalContext"])

    def test_after_a_compaction_only_the_agent_is_told(self):
        self.write_off_file()
        out = self.hook("SessionStart", source="compact")
        self.assertNotIn("systemMessage", out)
        self.assertIn("reviewer is off in this session.", out["hookSpecificOutput"]["additionalContext"])

    def test_a_session_that_is_on_is_told_nothing(self):
        for source in ("resume", "compact"):
            self.assertEqual(self.hook("SessionStart", source=source), {})

    def test_the_plugin_registers_the_event_for_resume_and_compact(self):
        [entry] = json.loads((PLUGIN / "hooks" / "hooks.json").read_text())["hooks"]["SessionStart"]
        self.assertEqual(entry["matcher"], "resume|compact")
        [command] = [h["command"] for h in entry["hooks"]]
        self.assertEqual(command, 'python3 "${CLAUDE_PLUGIN_ROOT}/scripts/gate.py"')


class OffAndOnAgain(Switch, Gate):
    def test_turning_off_and_on_leaves_the_ledger_and_the_refusals_as_they_were(self):
        self.unassessed()
        refused = self.reason(self.edit())
        before = self.ledger_rows()
        self.turn_off()
        self.assertEqual(self.decision(self.edit(session_id="s2")), "deny")
        self.turn_on()
        self.assertEqual(self.reason(self.edit()), refused)
        self.assertEqual(self.ledger_rows(), before)

    def test_log_mode_writes_no_would_deny_while_off_and_writes_it_again_after(self):
        self.mode = "log"
        self.unassessed()
        would = lambda: [e for e in self.gate_log() if e["decision"] == "would_deny"]
        self.edit()
        self.assertEqual(len(would()), 1)
        self.turn_off()
        self.edit()
        self.assertEqual(len(would()), 1)
        self.turn_on()
        self.edit()
        self.assertEqual(len(would()), 2)


if __name__ == "__main__":
    unittest.main()
