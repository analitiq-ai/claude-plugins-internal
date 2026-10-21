"""The shim sweeper reads only its snapshot of `HEAD`; every other reader is left alone."""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from paths import PLUGIN

HOOK = PLUGIN / "scripts" / "sweeper_read.py"
SWEEPER = "reviewer:shim-sweeper"


class SweeperRead(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        worktrees = Path(self.tmp.name) / "demo" / ".claude" / "worktrees"
        self.snap = worktrees / "shim-0123456789ab"
        (self.snap / "src").mkdir(parents=True)
        (self.snap / "src" / "load.py").write_text("x\n")
        self.worktree = worktrees / "w1"
        self.worktree.mkdir()
        (self.worktree / "secret.py").write_text("y\n")

    def hook(self, tool, tool_input, agent_type=SWEEPER):
        payload = {"hook_event_name": "PreToolUse", "session_id": "s1", "cwd": str(self.worktree), "tool_name": tool,
                   "tool_input": tool_input, **({"agent_type": agent_type} if agent_type else {})}
        done = subprocess.run([sys.executable, str(HOOK)], input=json.dumps(payload), capture_output=True, text=True)
        self.assertEqual(done.returncode, 0, done.stderr)
        return json.loads(done.stdout) if done.stdout.strip() else {}

    def decision(self, out):
        return out.get("hookSpecificOutput", {}).get("permissionDecision")

    def test_the_sweeper_reads_and_searches_inside_its_snapshot(self):
        for tool, tool_input in (("Read", {"file_path": str(self.snap / "src" / "load.py")}),
                                 ("Glob", {"pattern": "**/*.py", "path": str(self.snap)}),
                                 ("Grep", {"pattern": "load", "path": str(self.snap / "src"), "glob": "*.py"})):
            self.assertEqual(self.decision(self.hook(tool, tool_input)), "allow", tool)

    def test_the_sweeper_is_refused_anywhere_else(self):
        (self.snap / "out").symlink_to(self.worktree)
        for tool, tool_input in (("Read", {"file_path": str(self.worktree / "secret.py")}),
                                 ("Read", {"file_path": str(self.snap / "out" / "secret.py")}),
                                 ("Read", {"file_path": str(self.snap / ".." / "w1" / "secret.py")}),
                                 ("Glob", {"pattern": "**/*.py"}),
                                 ("Grep", {"pattern": "y"}),
                                 ("Glob", {"pattern": "../w1/*.py", "path": str(self.snap)}),
                                 ("Glob", {"pattern": str(self.worktree / "*.py"), "path": str(self.snap)})):
            out = self.hook(tool, tool_input)
            self.assertEqual(self.decision(out), "deny", (tool, tool_input))
            self.assertIn("snapshot", out["hookSpecificOutput"]["permissionDecisionReason"])

    def test_other_readers_are_not_the_hooks_business(self):
        for agent_type in ("reviewer:claim-judge", None):
            self.assertEqual(self.hook("Read", {"file_path": str(self.worktree / "secret.py")}, agent_type), {})


if __name__ == "__main__":
    unittest.main()
