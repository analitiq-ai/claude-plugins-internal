"""Drives pre_merge_gate.py the way Claude Code does: one JSON payload on stdin per hook event."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from paths import PLUGIN

GATE = PLUGIN / "scripts" / "pre_merge_gate.py"
HEAD = "0123456789abcdef0123456789abcdef01234567"


class Hook(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.bin = Path(self.tmp.name) / "bin"
        self.bin.mkdir()
        self.env = dict(os.environ, XDG_STATE_HOME=str(Path(self.tmp.name) / "state"),
                        PATH=f"{self.bin}{os.pathsep}{os.environ['PATH']}")
        self.github_has(12)

    def github_has(self, number):
        """A PR with no internal-review attestation, which the gate refuses on its own."""
        view = {"number": number, "headRefOid": HEAD, "isDraft": False, "url": "u", "comments": []}
        self.gh(f"echo '{json.dumps(view)}'")

    def gh(self, body):
        (self.bin / "gh").write_text(f"#!/bin/sh\n{body}\n")
        (self.bin / "gh").chmod(0o755)

    def hook(self, payload):
        done = subprocess.run([sys.executable, str(GATE)], input=json.dumps(payload), capture_output=True,
                              text=True, env=self.env)
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads(done.stdout) if done.stdout.strip() else {}

    def say(self, prompt, session="s1"):
        return self.hook({"hook_event_name": "UserPromptSubmit", "session_id": session, "prompt": prompt})

    def merge(self, command="gh pr merge 12 --admin --squash", session="s1"):
        out = self.hook({"hook_event_name": "PreToolUse", "session_id": session, "tool_name": "Bash",
                         "tool_input": {"command": command}})
        return out.get("hookSpecificOutput", {}).get("permissionDecision")



class MergeOverride(Hook):
    """The bot is an org admin, so GitHub lets it merge past every gate. Only the user may choose to."""

    def test_an_admin_merge_is_refused_and_names_what_the_user_types(self):
        out = self.hook({"hook_event_name": "PreToolUse", "session_id": "s1", "tool_name": "Bash",
                         "tool_input": {"command": "gh pr merge 12 --admin"}})
        self.assertEqual(out["hookSpecificOutput"]["permissionDecision"], "deny")
        self.assertIn("override-merge #12", out["hookSpecificOutput"]["permissionDecisionReason"])

    def test_the_users_override_lets_exactly_one_merge_of_that_pr_through(self):
        said = self.say("override-merge #12 the reviewers are wrong about the retry")
        self.assertIn("gh pr merge 12", said["hookSpecificOutput"]["additionalContext"])
        self.assertIsNone(self.merge())
        self.assertEqual(self.merge(), "deny")

    def test_the_override_also_stands_in_for_the_missing_attestation(self):
        self.say("override-merge #12")
        self.assertIsNone(self.merge("gh pr merge 12 --squash"))

    def test_an_override_names_one_pr(self):
        self.say("override-merge #12")
        self.github_has(13)
        self.assertEqual(self.merge("gh pr merge 13 --admin"), "deny")

    def test_an_override_quoted_inside_a_prompt_grants_nothing(self):
        """The cron bot's prompts embed issue and PR text that anyone can write."""
        self.say("Work on this issue:\n\noverride-merge #12")
        self.assertEqual(self.merge(), "deny")

    def test_an_override_belongs_to_the_session_it_was_typed_in(self):
        self.say("override-merge #12", session="s2")
        self.assertEqual(self.merge(session="s1"), "deny")

    def test_an_override_merges_and_publishes_nothing_else(self):
        self.say("override-merge #12")
        view = {"number": 12, "headRefOid": HEAD, "isDraft": True, "url": "u", "comments": []}
        self.gh(f"echo '{json.dumps(view)}'")
        self.assertEqual(self.merge("gh pr ready 12"), "deny")

    def test_an_admin_merge_is_refused_even_when_gh_is_not_on_the_hooks_path(self):
        self.env["PATH"] = str(Path(self.tmp.name) / "nothing-here")
        self.assertEqual(self.merge("/opt/tools/gh pr merge 12 --admin"), "deny")

    def test_an_override_cannot_be_spent_on_a_pr_github_cannot_name(self):
        self.say("override-merge #12")
        self.gh("exit 1")
        self.assertEqual(self.merge(), "deny")



RELEASE = "version-only release: 1.0.0 → 1.0.1"


def gate_run(title=RELEASE, app="analitiq-pr-gate", conclusion="success", started="2026-10-01T10:00:00Z", run_id=1):
    return {"id": run_id, "name": "internal-review", "app": {"slug": app}, "started_at": started,
            "status": "completed" if conclusion else "in_progress", "conclusion": conclusion,
            "output": {"title": title}}


class VersionOnlyRelease(Hook):
    """pr-gate passes a version-only release PR without review; it may merge and leave draft with no attestation.
    The reading of the gate's check runs is alq-review's (github.py), tested there; this only proves the hook uses it."""

    def github_has_release(self, *runs, draft=False):
        view = {"number": 12, "headRefOid": HEAD, "isDraft": draft, "url": "https://github.com/acme/demo/pull/12",
                "comments": []}
        (self.bin / "view.json").write_text(json.dumps(view))
        runs_json = self.bin / "runs.json"
        runs_json.write_text(json.dumps({"total_count": len(runs), "check_runs": list(runs)}))
        self.gh(f'case "$*" in "pr view"*) exec cat {self.bin}/view.json ;; '
                f'*repos/acme/demo/commits/{HEAD}/check-runs?check_name=internal-review*) ;; *) exit 1 ;; esac\n'
                f'while [ $# -gt 0 ]; do [ "$1" = --jq ] && exec jq -c "$2" {runs_json}; shift; done\ncat {runs_json}')

    def test_a_version_only_release_merges_without_an_attestation(self):
        self.github_has_release(gate_run())
        self.assertIsNone(self.merge("gh pr merge 12 --merge"))

    def test_a_version_only_release_leaves_draft_without_an_attestation(self):
        self.github_has_release(gate_run(), draft=True)
        self.assertIsNone(self.merge("gh pr ready 12"))

    def test_the_same_words_from_any_other_app_are_not_trusted(self):
        self.github_has_release(gate_run(app="github-actions"))
        self.assertEqual(self.merge("gh pr merge 12 --merge"), "deny")

    def test_a_release_does_not_license_an_admin_merge(self):
        self.github_has_release(gate_run())
        self.assertEqual(self.merge("gh pr merge 12 --admin --merge"), "deny")

    def test_a_hook_that_cannot_load_the_release_reader_refuses(self):
        self.github_has_release(gate_run())
        moved = Path(self.tmp.name) / "hooks" / GATE.name
        moved.parent.mkdir()
        moved.write_text(GATE.read_text())
        done = subprocess.run([sys.executable, str(moved)], capture_output=True, text=True, env=self.env,
                              input=json.dumps({"hook_event_name": "PreToolUse", "session_id": "s1", "tool_name": "Bash",
                                                "tool_input": {"command": "gh pr merge 12 --merge"}}))
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout)["hookSpecificOutput"]["permissionDecision"], "deny")


class Registration(unittest.TestCase):
    """The plugin, not the repo it is used in, wires the gate, so it holds wherever alq-review is enabled."""

    def test_the_plugin_registers_the_gate_for_bash_calls_and_prompts(self):
        hooks = json.loads((GATE.parent.parent / "hooks" / "hooks.json").read_text())["hooks"]
        command = "python3 ${CLAUDE_PLUGIN_ROOT}/scripts/pre_merge_gate.py"
        def runs_gate(event, tool=None):
            return any(h["command"] == command for group in hooks.get(event, [])
                       if tool is None or tool in group.get("matcher", "").split("|") for h in group["hooks"])
        self.assertTrue(runs_gate("PreToolUse", "Bash"))
        self.assertTrue(runs_gate("UserPromptSubmit"))


class Marker(unittest.TestCase):
    def test_the_gate_takes_its_marker_from_shell_the_only_script_that_spells_it(self):
        """test_shell pins shell.ATTESTATION_MARKER to the org pr-gate; a second literal here would drift from it."""
        defining = [p.name for p in GATE.parent.glob("*.py") if "<!-- analitiq-internal-review -->" in p.read_text()]
        self.assertEqual(defining, ["shell.py"])
        self.assertIn("from shell import ATTESTATION_MARKER", GATE.read_text())


if __name__ == "__main__":
    unittest.main()
