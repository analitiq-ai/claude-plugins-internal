import subprocess
import tempfile
import unittest
from pathlib import Path

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
        state = ledger.new_state("acme/demo", "feat/1-demo")
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
        state = ledger.new_state("acme/demo", "feat/1-demo")
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
        state = ledger.new_state("acme/demo", "feat/1-demo")
        head = self.commit("b.py", "x\n", "feat: b")
        rnd = self.round_with(state, [finding("code-reviewer-1", file="b.py", line=1)], head)
        self.assertFalse(facts.round_facts(state, rnd, str(self.root))["burden"])

    def test_falling_count_carries_no_burden(self):
        state = ledger.new_state("acme/demo", "feat/1-demo")
        first = self.commit("b.py", "".join(f"b{i}\n" for i in range(20)), "feat: b")
        self.round_with(state, [finding("code-reviewer-1", file="b.py", line=5), finding("code-reviewer-2", file="b.py", line=15)], first)
        assess(state, "PATCH")
        second = self.commit("b.py", "".join(f"c{i}\n" for i in range(20)), "fix: b")
        rnd = self.round_with(state, [finding("code-reviewer-1", file="b.py", line=5)], second)
        self.assertFalse(facts.round_facts(state, rnd, str(self.root))["burden"])

    def test_files_edited_by_three_fix_commits_are_counted(self):
        state = ledger.new_state("acme/demo", "feat/1-demo")
        first = self.commit("b.py", "0\n", "feat: b")
        self.round_with(state, [finding("code-reviewer-1", file="b.py", line=1)], first)
        assess(state, "PATCH")
        for i in range(3):
            head = self.commit("b.py", f"{i + 1}\n", f"fix {i}")
        rnd = self.round_with(state, [finding("code-reviewer-1", file="b.py", line=1)], head)
        self.assertEqual(facts.round_facts(state, rnd, str(self.root))["files_at_third_edit"], ["b.py"])

    def test_a_finding_that_names_no_line_is_measured_like_any_other(self):
        """`line` is not required of a finding, and a whole-branch judgement never carries one."""
        state = ledger.new_state("acme/demo", "feat/1-demo")
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
        state = ledger.new_state("acme/demo", "feat/1-demo")
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
        state = ledger.new_state("acme/demo", "feat/1-demo")
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
        state = ledger.new_state("acme/demo", "feat/1-demo")
        head = self.commit("b.py", "0\n", "feat: b")
        rnd = self.round_with(state, [finding("code-reviewer-1", file="b.py", line=1)], head)
        rnd["root"] = str(self.root)

        where = worktree.locate(str(self.root / "b.py"))
        offered = briefs.assess_args(state, rnd, where)["assess"]["schema"]["properties"]["round_verdict"]["enum"]
        self.assertIn("PATCH", offered)
        self.assertIn("CLASS_FIX", offered)


if __name__ == "__main__":
    unittest.main()
