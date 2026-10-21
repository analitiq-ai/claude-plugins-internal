import subprocess
import tempfile
import unittest

import helpers  # noqa: F401  (puts scripts/ on the path)

import worktree

OLD = "one\ntwo\nthree\nfour\n"
NEW = "one\n2\nthree\nfour\nfive\n"


def shape(hunks):
    return [(h.old_start, h.old_count, h.new_start, h.new_count, h.removed, h.added) for h in hunks]


class TextHunksTest(unittest.TestCase):
    def setUp(self):
        self._dir = tempfile.TemporaryDirectory()
        self.addCleanup(self._dir.cleanup)
        self.root = self._dir.name
        subprocess.run(["git", "init", "-q", self.root], check=True)

    def commit(self, text):
        with open(f"{self.root}/a.md", "w") as handle:
            handle.write(text)
        worktree.git(self.root, "add", "a.md")
        return worktree.staged_tree(self.root)

    def test_two_texts_give_the_hunks_git_gives_for_the_same_file_in_two_trees(self):
        before, after = self.commit(OLD), self.commit(NEW)
        staged = worktree.tree_hunks(self.root, before, after)
        self.assertEqual(shape(worktree.text_hunks(self.root, OLD, NEW)),
                         [(h["old_start"], h["old_count"], h["new_start"], h["new_count"], tuple(h["removed"]),
                           tuple(h["added"])) for h in staged])
        self.assertTrue(staged)

    def test_identical_texts_have_no_hunks(self):
        self.assertEqual(worktree.text_hunks(self.root, OLD, OLD), [])

    def test_the_texts_need_not_be_in_the_repository_already(self):
        # setUp made an empty repository: no object of either text exists in it.
        self.assertEqual(len(worktree.text_hunks(self.root, OLD, NEW)), 2)


if __name__ == "__main__":
    unittest.main()
