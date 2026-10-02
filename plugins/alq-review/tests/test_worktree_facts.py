import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from helpers import REVIEWERS, T0, assess, finding

import briefs
import facts
import ledger
import policy
import worktree


def git(root, *args):
    return subprocess.run(["git", "-C", str(root), *args], check=True, capture_output=True, text=True).stdout.strip()


class Repo(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name) / "demo"
        self.root.mkdir()
        git(self.root, "init", "-q", "-b", "main")
        git(self.root, "config", "user.email", "t@example.com")
        git(self.root, "config", "user.name", "t")
        git(self.root, "remote", "add", "origin", "git@github.com:acme/demo.git")
        (self.root / ".gitignore").write_text("notes/\n")
        self.commit("a.py", "".join(f"line{i}\n" for i in range(30)), "base")
        git(self.root, "checkout", "-q", "-b", "feat/1-demo")

    def serve_remote(self):
        """A bare repo that stands in for GitHub: git reaches it whenever it would fetch from origin."""
        bare = Path(self.tmp.name) / "remote.git"
        git(self.tmp.name, "init", "-q", "--bare", str(bare))
        git(self.root, "config", f"url.{bare}.insteadOf", "git@github.com:acme/demo.git")
        git(self.root, "push", "-q", "origin", "main")
        git(self.root, "fetch", "-q", "origin")
        git(self.root, "remote", "set-head", "origin", "main")

    def commit(self, name, text, message):
        (self.root / name).write_text(text)
        git(self.root, "add", name)
        git(self.root, "commit", "-q", "-m", message)
        return git(self.root, "rev-parse", "HEAD")


class Locate(Repo):
    def test_file_resolves_to_its_repo_and_branch(self):
        found = worktree.locate(str(self.root / "pkg" / "new_file.py"))
        self.assertEqual((found.slug, found.branch, Path(found.root)), ("acme/demo", "feat/1-demo", self.root.resolve()))

    def test_path_outside_any_repo_resolves_to_nothing(self):
        self.assertIsNone(worktree.locate(self.tmp.name + "/elsewhere/x.py"))

    def test_https_remote_is_understood(self):
        git(self.root, "remote", "set-url", "origin", "https://github.com/acme/demo.git")
        self.assertEqual(worktree.locate(str(self.root)).slug, "acme/demo")

    def test_ignored_paths_are_not_part_of_the_change(self):
        self.assertTrue(worktree.is_ignored(str(self.root), str(self.root / "notes" / "task.md")))
        self.assertFalse(worktree.is_ignored(str(self.root), str(self.root / "a.py")))

    def test_dirty_means_tracked_changes_only(self):
        (self.root / "untracked.md").write_text("x")
        self.assertFalse(worktree.is_dirty(str(self.root)))
        (self.root / "a.py").write_text("changed\n")
        self.assertTrue(worktree.is_dirty(str(self.root)))


class Contents(Repo):
    def test_a_deleted_branch_reads_as_deleted(self):
        git(self.root, "checkout", "-q", "main")
        git(self.root, "branch", "-q", "-D", "feat/1-demo")
        self.assertEqual(worktree.contents(str(self.root), "feat/1-demo"),
                         worktree.Snapshot(tip="deleted", digests={}, unverified=frozenset()))

    def test_a_removed_checkout_is_an_error_not_a_deleted_branch(self):
        root = str(self.root)
        self.tmp.cleanup()
        with self.assertRaises(RuntimeError):
            worktree.contents(root, "feat/1-demo")

    def test_a_directory_that_is_no_repo_is_an_error(self):
        with self.assertRaises(RuntimeError):
            worktree.contents(self.tmp.name, "feat/1-demo")

    def test_a_checkout_git_cannot_read_is_an_error(self):
        (self.root / ".git" / "index").write_bytes(b"not an index")
        with self.assertRaises(RuntimeError):
            worktree.contents(str(self.root), "feat/1-demo")

    def test_a_nested_checkout_whose_git_is_gone_is_an_error_not_the_outer_repo(self):
        nested = self.root / ".git" / "wt" / "2-other"
        git(self.root, "worktree", "add", "-q", "-b", "feat/2-other", str(nested))
        (nested / ".git").unlink()
        with self.assertRaises(RuntimeError):
            worktree.contents(str(nested), "feat/2-other")

    def test_a_checkout_nested_in_a_work_tree_whose_git_is_gone_is_an_error_not_the_outer_repo(self):
        nested = self.root / "vendored"
        git(self.root, "worktree", "add", "-q", "-b", "feat/2-other", str(nested))
        (nested / ".git").unlink()
        with self.assertRaises(RuntimeError):
            worktree.contents(str(nested), "feat/2-other")

    def test_git_timing_out_is_an_error(self):
        with mock.patch("subprocess.run", side_effect=subprocess.TimeoutExpired("git", 30)), \
                self.assertRaises(RuntimeError):
            worktree.review_base(str(self.root), "main")
        with mock.patch("subprocess.run", side_effect=subprocess.TimeoutExpired("git", 30)), \
                self.assertRaises(RuntimeError):
            worktree.git(str(self.root), "status")

    def test_no_git_to_run_is_an_error(self):
        with mock.patch.dict(os.environ, {"PATH": ""}), self.assertRaises(RuntimeError):
            worktree.contents(str(self.root), "feat/1-demo")

    def test_an_unreadable_file_is_unverified_not_a_digest(self):
        unreadable = self.root / "z.py"
        unreadable.write_text("x")
        unreadable.chmod(0)
        snapshot = worktree.contents(str(self.root), "feat/1-demo")
        self.assertEqual(snapshot.unverified, {"z.py"})
        self.assertNotIn("z.py", snapshot.digests)

    def test_paths_git_status_cannot_read_are_unverified(self):
        """git status exits 0 on these and names them only on stderr."""
        (self.root / "d").mkdir()
        self.commit("d/t.py", "t\n", "tracked in d")
        (self.root / "u").mkdir()
        (self.root / "u" / "new.py").write_text("n")
        for directory in ("d", "u"):
            (self.root / directory).chmod(0)
            self.addCleanup((self.root / directory).chmod, 0o755)
        self.assertEqual(worktree.contents(str(self.root), "feat/1-demo").unverified, {"d/t.py", "d/", "u/"})


    def test_an_unreadable_gitignore_is_unverified(self):
        (self.root / "e").mkdir()
        (self.root / "e" / ".gitignore").write_text("*.log\n")
        (self.root / "e" / ".gitignore").chmod(0)
        self.addCleanup((self.root / "e" / ".gitignore").chmod, 0o644)
        self.assertEqual(worktree.contents(str(self.root), "feat/1-demo").unverified, {"e/.gitignore"})

    def test_git_status_complaining_of_what_it_names_no_path_for_leaves_the_files_unverified(self):
        run = worktree._run

        def status_complains(root, *args, **kw):
            done = run(root, *args, **kw)
            if args[0] == "status":
                done.stderr += 'error: open("x"): Permission denied\n'
            return done
        with mock.patch.object(worktree, "_run", status_complains):
            snapshot = worktree.contents(str(self.root), "feat/1-demo")
        self.assertEqual(snapshot.contents_unverified, 'error: open("x"): Permission denied')
        self.assertEqual(snapshot.tip, git(self.root, "rev-parse", "feat/1-demo"))

    def test_git_speaks_untranslated(self):
        """The watch reads git's messages, so they must not depend on the user's language."""
        fake = Path(self.tmp.name) / "bin"
        fake.mkdir()
        (fake / "git").write_text('#!/bin/sh\necho "$LC_ALL"\n')
        (fake / "git").chmod(0o755)
        with mock.patch.dict(os.environ, {"PATH": str(fake), "LC_ALL": "de_DE.UTF-8"}):
            self.assertEqual(worktree.git(str(self.root), "status"), "C")


class Compare(unittest.TestCase):
    def snap(self, tip="t1", unverified=(), **digests):
        return worktree.Snapshot(tip=tip, digests=digests, unverified=frozenset(unverified))

    def test_a_moved_tip_and_changed_known_content_are_moves(self):
        moved, unverified = worktree.compare(self.snap(**{"a.py": "1"}), self.snap(tip="t2", **{"a.py": "2", "n.py": "3"}))
        self.assertEqual((moved, unverified), (["tip", "a.py", "n.py"], []))

    def test_a_path_unverified_on_either_side_is_reported_never_moved(self):
        for before, after in ((self.snap(unverified={"z.py"}), self.snap(**{"z.py": "1"})),
                              (self.snap(**{"z.py": "1"}), self.snap(unverified={"z.py"}))):
            with self.subTest(before=before, after=after):
                self.assertEqual(worktree.compare(before, after), ([], ["z.py"]))

    def test_files_unverified_on_either_side_leave_only_the_tip_compared(self):
        for side in ("before", "after"):
            with self.subTest(side=side):
                snaps = {"before": self.snap(**{"a.py": "1"}), "after": self.snap(tip="t2", **{"a.py": "2"})}
                snaps[side] = worktree.Snapshot(snaps[side].tip, snaps[side].digests, frozenset(), "warning: odd")
                self.assertEqual(worktree.compare(snaps["before"], snaps["after"]), (["tip"], []))


class ReviewBase(Repo):
    def setUp(self):
        super().setUp()
        self.serve_remote()

    def test_it_is_where_the_branch_left_the_branch_its_pr_merges_into(self):
        git(self.root, "checkout", "-q", "-b", "dev", "main")
        dev = self.commit("d.py", "d\n", "dev work")
        git(self.root, "push", "-q", "origin", "dev")
        git(self.root, "checkout", "-q", "-b", "feat/2-on-dev")
        self.commit("b.py", "x\n", "feat")
        self.assertEqual(worktree.review_base(str(self.root), "dev"), dev)

    def test_it_reads_the_base_branch_as_the_remote_has_it_now(self):
        """A local copy of the base branch is only as fresh as the last fetch in that checkout."""
        stale = git(self.root, "rev-parse", "main")
        git(self.root, "checkout", "-q", "main")
        moved = self.commit("m.py", "m\n", "merged elsewhere")
        git(self.root, "push", "-q", "origin", "main")
        git(self.root, "checkout", "-q", "feat/1-demo")
        git(self.root, "merge", "-q", "--no-edit", "main")
        git(self.root, "branch", "-f", "main", stale)
        git(self.root, "update-ref", "refs/remotes/origin/main", stale)
        self.assertEqual(worktree.review_base(str(self.root), "main"), moved)

    def test_a_base_branch_the_remote_does_not_have_is_an_error(self):
        with self.assertRaises(RuntimeError):
            worktree.review_base(str(self.root), "no-such-branch")


class RoundFacts(Repo):
    def round_with(self, state, findings, head):
        rnd = ledger.open_round(state, "internal", head_sha=head, base_sha=git(self.root, "rev-parse", "main"),
                                scope="full", expected=REVIEWERS[:1], escalation=False, now=T0)
        ledger.record_report(state, rnd["ref"], REVIEWERS[0], {"findings": findings}, now=T0)
        return rnd

    def test_second_round_landing_on_fix_written_lines_shifts_the_burden_of_proof(self):
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        first = self.commit("b.py", "".join(f"b{i}\n" for i in range(20)), "feat: b")
        self.round_with(state, [finding("code-reviewer-1", file="b.py", line=5)], first)
        assess(state, "PATCH")
        lines = [f"b{i}\n" for i in range(20)]
        lines[4:5] = ["fixed-a\n", "fixed-b\n"]
        second = self.commit("b.py", "".join(lines), "fix: b")
        rnd = self.round_with(state, [finding("code-reviewer-1", file="b.py", line=6)], second)

        got = facts.round_facts(state, rnd, str(self.root))
        self.assertTrue(got["count_not_falling"])
        self.assertEqual(got["findings"]["code-reviewer-1"], {"on_fix_lines": True, "repeat_unit": True, "cites_prior_fix": False})
        self.assertTrue(got["burden"])
        self.assertEqual((got["original_additions"], got["fix_additions"]), (20, 2))

    def test_the_brief_diffs_from_the_base_of_the_round_being_assessed(self):
        """A branch that merged its base since round one must not be judged on commits the base already had."""
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        first = self.commit("b.py", "x\n", "feat: b")
        self.round_with(state, [finding("code-reviewer-1", file="b.py", line=1)], first)
        assess(state, "PATCH")
        git(self.root, "checkout", "-q", "main")
        moved = self.commit("m.py", "m\n", "merged elsewhere")
        git(self.root, "checkout", "-q", "feat/1-demo")
        git(self.root, "merge", "-q", "--no-edit", "main")
        rnd = self.round_with(state, [finding("code-reviewer-1", file="b.py", line=1)], git(self.root, "rev-parse", "HEAD"))
        rnd["root"] = str(self.root)
        self.assertEqual(rnd["base_sha"], moved)
        self.assertTrue(briefs.brief(state, rnd)["change_under_review"].endswith(f"diff {moved}...HEAD"))

    def test_first_round_never_carries_a_burden(self):
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        head = self.commit("b.py", "x\n", "feat: b")
        rnd = self.round_with(state, [finding("code-reviewer-1", file="b.py", line=1)], head)
        self.assertFalse(facts.round_facts(state, rnd, str(self.root))["burden"])

    def test_falling_count_carries_no_burden(self):
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        first = self.commit("b.py", "".join(f"b{i}\n" for i in range(20)), "feat: b")
        self.round_with(state, [finding("code-reviewer-1", file="b.py", line=5), finding("code-reviewer-2", file="b.py", line=15)], first)
        assess(state, "PATCH")
        second = self.commit("b.py", "".join(f"c{i}\n" for i in range(20)), "fix: b")
        rnd = self.round_with(state, [finding("code-reviewer-1", file="b.py", line=5)], second)
        self.assertFalse(facts.round_facts(state, rnd, str(self.root))["burden"])

    def test_files_edited_by_three_fix_commits_are_counted(self):
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        first = self.commit("b.py", "0\n", "feat: b")
        self.round_with(state, [finding("code-reviewer-1", file="b.py", line=1)], first)
        assess(state, "PATCH")
        for i in range(3):
            head = self.commit("b.py", f"{i + 1}\n", f"fix {i}")
        rnd = self.round_with(state, [finding("code-reviewer-1", file="b.py", line=1)], head)
        self.assertEqual(facts.round_facts(state, rnd, str(self.root))["files_at_third_edit"], ["b.py"])

    def test_a_finding_that_names_no_line_is_measured_like_any_other(self):
        """`line` is not required of a finding, and a whole-branch judgement never carries one."""
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        first = self.commit("b.py", "0\n", "feat: b")
        whole_branch = {k: v for k, v in finding("history-shape-1", file="b.py").items() if k != "line"}
        self.round_with(state, [whole_branch], first)
        assess(state, "PATCH")
        second = self.commit("b.py", "1\n", "fix: b")
        rnd = self.round_with(state, [whole_branch, finding("code-reviewer-1", file="b.py", line=1)], second)

        got = facts.round_facts(state, rnd, str(self.root))
        self.assertFalse(got["findings"]["history-shape-1"]["on_fix_lines"])
        self.assertFalse(got["findings"]["history-shape-1"]["repeat_unit"])

    def test_a_round_still_opens_after_an_audit_that_judged_the_whole_branch(self):
        """The launch path measures churn, so an unguarded field there stops every later round."""
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        head = self.commit("b.py", "0\n", "feat: b")
        whole_branch = {k: v for k, v in finding("history-shape-1", file="b.py").items() if k != "line"}
        self.round_with(state, [whole_branch], head)
        assess(state, "PATCH")
        nxt = self.round_with(state, [finding("code-reviewer-1", file="b.py", line=1)], self.commit("b.py", "1\n", "fix"))
        nxt["root"] = str(self.root)

        where = worktree.locate(str(self.root / "b.py"))
        self.assertIn("round_verdict", briefs.review_args(state, nxt, where, policy.Decision(True, scope="full"))
                      ["assess"]["schema"]["properties"])

    def test_the_churned_round_cannot_be_handed_a_verdict_that_edits_again(self):
        """Through the real assessor args: the schema the model answers in is where this has to bind."""
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        first = self.commit("b.py", "0\n", "feat: b")
        self.round_with(state, [finding("code-reviewer-1", file="b.py", line=1)], first)
        assess(state, "PATCH")
        for i in range(3):
            head = self.commit("b.py", f"{i + 1}\n", f"fix {i}")
        rnd = self.round_with(state, [finding("code-reviewer-1", file="b.py", line=1)], head)
        rnd["root"] = str(self.root)

        where = worktree.locate(str(self.root / "b.py"))
        schema = briefs.assess_args(state, rnd, where)["assess"]["schema"]
        offered = schema["properties"]["round_verdict"]["enum"]
        self.assertNotIn("PATCH", offered)
        self.assertNotIn("CLASS_FIX", offered)
        self.assertIn("REDESIGN", offered)

    def test_an_unchurned_round_is_still_offered_every_verdict(self):
        state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
        head = self.commit("b.py", "0\n", "feat: b")
        rnd = self.round_with(state, [finding("code-reviewer-1", file="b.py", line=1)], head)
        rnd["root"] = str(self.root)

        where = worktree.locate(str(self.root / "b.py"))
        offered = briefs.assess_args(state, rnd, where)["assess"]["schema"]["properties"]["round_verdict"]["enum"]
        self.assertIn("PATCH", offered)
        self.assertIn("CLASS_FIX", offered)


class StagedHunks(Repo):
    def stage(self, name, text):
        (self.root / name).parent.mkdir(parents=True, exist_ok=True)
        (self.root / name).write_text(text)
        git(self.root, "add", name)
        return worktree.tree_hunks(str(self.root), worktree.head_tree(str(self.root)), worktree.staged_tree(str(self.root)))

    def test_one_hunk_per_header_with_both_sides(self):
        lines = [f"line{i}\n" for i in range(30)]
        lines[3], lines[20] = "changed three\n", "changed twenty\n"
        first, second = self.stage("a.py", "".join(lines))
        self.assertEqual((first["file"], first["old_start"], first["old_count"], first["new_start"], first["new_count"]),
                         ("a.py", 4, 1, 4, 1))
        self.assertEqual((first["removed"], first["added"]), (["line3"], ["changed three"]))
        self.assertEqual((second["old_start"], second["added"]), (21, ["changed twenty"]))
        self.assertNotEqual(first["id"], second["id"])

    def test_a_removal_is_a_hunk_with_nothing_added(self):
        [hunk] = self.stage("a.py", "".join(f"line{i}\n" for i in range(30) if i != 7))
        self.assertEqual((hunk["old_start"], hunk["old_count"], hunk["new_count"], hunk["removed"], hunk["added"]),
                         (8, 1, 0, ["line7"], []))

    def test_a_new_file_is_one_hunk(self):
        [hunk] = self.stage("docs/new.md", "one\n\ntwo\n\nthree\n")
        self.assertEqual((hunk["file"], hunk["old_start"], hunk["old_count"], hunk["new_count"]), ("docs/new.md", 0, 0, 5))

    def test_generated_and_binary_files_have_no_hunks(self):
        (self.root / ".gitattributes").write_text("gen.txt linguist-generated\n")
        git(self.root, "add", ".gitattributes")
        (self.root / "blob.bin").write_bytes(b"\x00\x01\x02")
        git(self.root, "add", "blob.bin")
        self.assertEqual([h["file"] for h in self.stage("gen.txt", "generated\n")], [".gitattributes"])

    def test_the_fingerprint_ignores_spacing_and_follows_words(self):
        self.commit("doc.md", "intro\n", "doc")
        [plain] = self.stage("doc.md", "intro\nthe validator rejects an empty list\n")
        [spaced] = self.stage("doc.md", "intro\n  the validator   rejects an empty list\n")
        [reworded] = self.stage("doc.md", "intro\nthe validator accepts an empty list\n")
        self.assertEqual(plain["patch_id"], spaced["patch_id"])
        self.assertNotEqual(plain["patch_id"], reworded["patch_id"])

    def test_a_renamed_file_keeps_its_text_as_added(self):
        self.commit("old.md", "".join(f"para {i}\n" for i in range(10)), "doc")
        git(self.root, "mv", "old.md", "new.md")
        hunks = self.stage("new.md", "".join(f"para {i}\n" for i in range(10)) + "a new claim\n")
        self.assertEqual([(h["file"], h["added"]) for h in hunks], [("new.md", ["a new claim"])])

    def test_nothing_staged_is_no_hunks(self):
        self.assertEqual(worktree.tree_hunks(str(self.root), worktree.head_tree(str(self.root)), worktree.staged_tree(str(self.root))), [])


class StagedTree(Repo):
    def test_a_file_is_read_from_the_tree_not_the_checkout(self):
        (self.root / "a.py").write_text("staged\n")
        git(self.root, "add", "a.py")
        (self.root / "a.py").write_text("unstaged\n")
        tree = worktree.staged_tree(str(self.root))
        self.assertEqual(worktree.tree_text(str(self.root), tree, "a.py"), "staged\n")
        self.assertIsNone(worktree.tree_text(str(self.root), tree, "notes/x.md"))
        self.assertEqual(worktree.tree_blob(str(self.root), tree, "a.py"), git(self.root, "rev-parse", ":a.py"))
        self.assertIsNone(worktree.tree_blob(str(self.root), tree, "missing.py"))

    def test_unstaged_tracked_changes_are_named(self):
        (self.root / "a.py").write_text("edited\n")
        (self.root / "new.py").write_text("untracked\n")
        self.assertEqual(worktree.unstaged(str(self.root)), ["a.py"])

    def test_a_commit_that_concludes_a_merge_is_known(self):
        self.assertFalse(worktree.concluding(str(self.root)))
        Path(git(self.root, "rev-parse", "--absolute-git-dir"), "CHERRY_PICK_HEAD").write_text("x\n")
        self.assertTrue(worktree.concluding(str(self.root)))


if __name__ == "__main__":
    unittest.main()
