"""The `HEAD` snapshot a sweeper reads, beside the worktrees of the main checkout."""
import os
from pathlib import Path

from test_worktree_facts import Repo, git

import snapshot


class Snapshot(Repo):
    def setUp(self):
        super().setUp()
        (self.root / ".gitignore").write_text("notes/\n.claude/worktrees/\n")
        self.commit("load.py", "def load():\n    pass\n", "feat: load")
        self.worktree = self.root / ".claude" / "worktrees" / "w1"
        git(self.root, "worktree", "add", "-q", "-b", "feat/2-other", str(self.worktree))
        self.tree = git(self.root, "rev-parse", "HEAD^{tree}")
        self.expected = Path(snapshot.folder(str(self.root), self.tree))

    def test_head_is_exported_beside_the_worktrees_from_either_checkout(self):
        for checkout in (self.root, self.worktree):
            path = snapshot.export(str(checkout), self.tree)
            self.assertEqual(Path(path), self.expected)
            self.assertEqual((self.expected / "load.py").read_text(), "def load():\n    pass\n")
            self.assertFalse((self.expected / ".git").exists())
            snapshot.remove(path)
            self.assertFalse(self.expected.exists())

    def test_a_checkout_whose_path_is_not_utf8_is_exported_beside_its_worktrees(self):
        clone = Path(self.tmp.name) / os.fsdecode(b"caf\xe9")
        git(self.tmp.name, "clone", "-q", str(self.root), str(clone))
        path = Path(snapshot.export(str(clone), self.tree))
        self.assertEqual(path.parent, clone / ".claude" / "worktrees")
        self.assertEqual((path / "load.py").read_text(), "def load():\n    pass\n")

    def test_the_checkout_being_committed_sees_nothing_new(self):
        before = (git(self.worktree, "status", "--porcelain"), sorted(os.listdir(self.worktree)))
        snapshot.export(str(self.worktree), self.tree)
        self.assertEqual((git(self.worktree, "status", "--porcelain"), sorted(os.listdir(self.worktree))), before)

    def test_a_second_export_for_one_check_keeps_the_first(self):
        first = snapshot.export(str(self.worktree), self.tree)
        (Path(first) / "marker").write_text("x")
        self.assertEqual(snapshot.export(str(self.worktree), self.tree), first)
        self.assertTrue((Path(first) / "marker").exists())

    def test_two_checks_at_one_head_each_get_their_own_folder(self):
        first = snapshot.export(str(self.worktree), self.tree)
        second = snapshot.export(str(self.worktree), "f" * 40)
        self.assertNotEqual(first, second)
        snapshot.remove(second)
        self.assertTrue((Path(first) / "load.py").is_file())

    def test_only_a_snapshot_folder_is_removed(self):
        outside = Path(self.tmp.name) / "shim-0123456789ab"
        outside.mkdir()
        link = self.root / ".claude" / "worktrees" / "shim-aaaaaaaaaaaa"
        link.symlink_to(outside)
        (self.root / ".claude" / "worktrees" / "shim-notahexname").mkdir()
        for path in (outside, link, self.worktree, self.root / ".claude" / "worktrees",
                     self.root / ".claude" / "worktrees" / "shim-notahexname"):
            with self.assertRaises(ValueError, msg=path):
                snapshot.remove(str(path))
        self.assertTrue(outside.exists() and self.worktree.exists())

    def test_removing_a_snapshot_that_is_gone_is_not_an_error(self):
        snapshot.remove(str(self.expected))

    def test_a_path_is_inside_a_snapshot_only_when_it_resolves_there(self):
        path = Path(snapshot.export(str(self.worktree), self.tree))
        self.assertEqual(snapshot.snapshot_of(str(path / "load.py")), str(path))
        self.assertEqual(snapshot.snapshot_of(str(path)), str(path))
        self.assertIsNone(snapshot.snapshot_of(str(self.worktree / "load.py")))
        self.assertIsNone(snapshot.snapshot_of(str(path / ".." / "w1" / "load.py")))
        (path / "out").symlink_to(self.worktree)
        self.assertIsNone(snapshot.snapshot_of(str(path / "out" / "load.py")))
