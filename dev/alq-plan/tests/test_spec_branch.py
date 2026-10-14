"""spec_branch.py against real git, with a bare repo standing in for origin and a stand-in `gh` that keeps each call.

origin's default branch, as the stand-in gh names it, is `trunk`; the checkout is cloned on `main` and its
`origin/trunk` is behind origin's, so a branch from anything but origin's default branch as origin has it shows.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from paths import PLUGIN

SCRIPT = PLUGIN / "skills" / "issue-spec" / "scripts" / "spec_branch.py"
ISSUE, BRANCH, FOLDER = "7", "7-spec", "specs/7-demo"
PR_URL = "https://github.test/acme/demo/pull/12"
DEFAULT_BRANCH_READ = ["--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]


class Repo:
    def __init__(self):
        self._tmp = tempfile.TemporaryDirectory()
        tmp = Path(self._tmp.name)
        bin_dir = tmp / "bin"
        bin_dir.mkdir()
        self.gh_log = tmp / "gh.log"
        gh = bin_dir / "gh"
        # GH_FAILS makes it fail the way gh does when GitHub refuses a call.
        gh.write_text(f"#!{sys.executable}\nimport json, os, sys\n"
                      f"with open({str(self.gh_log)!r}, 'a') as log:\n"
                      "    log.write(json.dumps(sys.argv[1:]) + '\\n')\n"
                      "if os.environ.get('GH_FAILS'):\n"
                      "    sys.exit('HTTP 502: Bad Gateway')\n"
                      "if sys.argv[1:3] == ['repo', 'view']:\n"
                      "    print('trunk')\n"
                      "if sys.argv[1:3] == ['pr', 'create']:\n"
                      f"    print({PR_URL!r})\n")
        gh.chmod(0o755)
        config = tmp / "gitconfig"
        config.write_text("[user]\n\tname = Test\n\temail = test@example.test\n[init]\n\tdefaultBranch = main\n")
        self.env = {**os.environ, "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
                    "GIT_CONFIG_GLOBAL": str(config), "GIT_CONFIG_NOSYSTEM": "1"}
        self.origin = tmp / "origin.git"
        self.git("init", "-q", "--bare", str(self.origin), cwd=tmp)
        self.seed = tmp / "seed"
        self.git("clone", "-q", str(self.origin), str(self.seed), cwd=tmp)
        self.commit(self.seed, "base.txt")
        self.git("push", "-q", "origin", "HEAD:main", cwd=self.seed)
        self.git("checkout", "-q", "-b", "trunk", cwd=self.seed)
        self.commit(self.seed, "trunk.txt")
        self.git("push", "-q", "origin", "trunk", cwd=self.seed)
        self.root = tmp / "checkout"
        self.git("clone", "-q", "-b", "main", str(self.origin), str(self.root), cwd=tmp)
        self.commit(self.seed, "later.txt")
        self.git("push", "-q", "origin", "trunk", cwd=self.seed)
        self.trunk = self.git("rev-parse", "HEAD", cwd=self.seed)
        self.worktree = self.root / ".claude" / "worktrees" / BRANCH

    def git(self, *args, cwd=None):
        done = subprocess.run(["git", *args], cwd=cwd or self.root, env=self.env, capture_output=True, text=True)
        if done.returncode != 0:
            raise AssertionError(f"git {' '.join(args)}: {done.stderr}")
        return done.stdout.strip()

    def commit(self, where, name):
        (where / name).write_text(name)
        self.git("add", name, cwd=where)
        self.git("commit", "-q", "-m", name, cwd=where)

    def run(self, *args, cwd=None):
        return subprocess.run([sys.executable, str(SCRIPT), *args], cwd=cwd or self.root, env=self.env,
                              capture_output=True, text=True)

    def gh_calls(self):
        return [json.loads(line) for line in self.gh_log.read_text().splitlines()] if self.gh_log.exists() else []

    def remote_branch(self, branch):
        return self.git("ls-remote", "--heads", "origin", branch).split("\t")[0]

    def close(self):
        self._tmp.cleanup()


class Create(unittest.TestCase):
    def setUp(self):
        self.repo = Repo()
        self.addCleanup(self.repo.close)

    def assert_created_nothing(self):
        self.assertFalse(self.repo.worktree.exists())
        self.assertEqual(self.repo.git("branch", "--list", BRANCH), "")
        self.assertEqual(self.repo.git("worktree", "list", "--porcelain").count("worktree "), 1)

    def test_a_new_scope_branches_from_origins_default_branch_as_origin_has_it_in_the_repos_spec_worktree(self):
        done = self.repo.run("create", ISSUE)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout),
                         {"branch": BRANCH, "worktree": str(self.repo.worktree), "base": "origin/trunk"})
        self.assertEqual(self.repo.git("rev-parse", "--abbrev-ref", "HEAD", cwd=self.repo.worktree), BRANCH)
        self.assertEqual(self.repo.git("rev-parse", "HEAD", cwd=self.repo.worktree), self.repo.trunk)
        self.assertEqual(self.repo.gh_calls(), [["repo", "view", str(self.repo.origin), *DEFAULT_BRANCH_READ]])

    def test_the_spec_branch_tracks_nothing(self):
        self.assertEqual(self.repo.run("create", ISSUE).returncode, 0)
        upstream = subprocess.run(["git", "config", "--get", f"branch.{BRANCH}.merge"], cwd=self.repo.root,
                                  env=self.repo.env, capture_output=True, text=True)
        self.assertEqual((upstream.returncode, upstream.stdout), (1, ""))

    def test_run_from_another_worktree_it_lands_under_the_repos_own_worktrees(self):
        other = self.repo.root / ".claude" / "worktrees" / "other"
        self.repo.git("worktree", "add", "-q", "-b", "other", str(other))
        done = self.repo.run("create", ISSUE, cwd=other)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout)["worktree"], str(self.repo.worktree))
        self.assertTrue(self.repo.worktree.is_dir())

    def test_a_spec_branch_that_exists_locally_refuses_the_new_scope_naming_it_and_the_rescope_form(self):
        self.repo.git("branch", BRANCH)
        done = self.repo.run("create", ISSUE)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn(BRANCH, done.stderr)
        self.assertIn(f"rescope <spec folder> #{ISSUE}", done.stderr)
        self.assertFalse(self.repo.worktree.exists())

    def test_a_spec_branch_that_exists_on_origin_refuses_the_new_scope_naming_it_and_the_rescope_form(self):
        self.repo.git("push", "-q", "origin", f"main:{BRANCH}", cwd=self.repo.seed)
        done = self.repo.run("create", ISSUE)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn(BRANCH, done.stderr)
        self.assertIn("origin", done.stderr)
        self.assertIn(f"rescope <spec folder> #{ISSUE}", done.stderr)
        self.assert_created_nothing()

    def test_a_branch_on_origin_whose_name_only_ends_in_the_spec_branchs_is_not_the_spec_branch(self):
        self.repo.git("push", "-q", "origin", f"main:refs/heads/old/{BRANCH}", cwd=self.repo.seed)
        done = self.repo.run("create", ISSUE)
        self.assertEqual(done.returncode, 0, done.stderr)

    def test_the_spec_worktree_path_is_made_in_one_place(self):
        """create makes it and discard removes it: two spellings of one path would drift apart."""
        self.assertEqual(SCRIPT.read_text().count('"worktrees"'), 1)

    def test_a_default_branch_github_will_not_name_creates_nothing(self):
        self.repo.env["GH_FAILS"] = "1"
        done = self.repo.run("create", ISSUE)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("HTTP 502", done.stderr)
        self.assert_created_nothing()


def write_run(project: Path, status: str, run_id="run-1", kind="new", inputs=None):
    """A run as drive_workflow.py reads it: its state and the inputs it was started with, the folder among them."""
    run = project / ".specify" / "workflows" / "runs" / run_id
    run.mkdir(parents=True)
    (run / "state.json").write_text(json.dumps({"run_id": run_id, "status": status, "current_step_id": "tasks",
                                                "error": None, "step_results": {}}))
    inputs = {"spec": "# Demo\n", "issue": ISSUE, "spec_dir": FOLDER, "kind": kind} if inputs is None else inputs
    (run / "inputs.json").write_text(json.dumps({"inputs": inputs}))
    return run_id


def write_folder(project: Path, folder=FOLDER):
    (project / folder).mkdir(parents=True, exist_ok=True)
    (project / folder / "spec.md").write_text("# Demo\n")
    (project / folder / "plan.md").write_text("# Plan\n")


class Discard(unittest.TestCase):
    """A new scope that ends without landing leaves no spec branch behind, so that a new scope can start again."""

    def setUp(self):
        self.repo = Repo()
        self.addCleanup(self.repo.close)
        done = self.repo.run("create", ISSUE)
        self.assertEqual(done.returncode, 0, done.stderr)
        # What a run that stopped leaves in the worktree: a folder and the run's own files, none of them committed.
        write_folder(self.repo.worktree)
        write_run(self.repo.worktree, "failed")

    def assert_kept(self):
        self.assertTrue(self.repo.worktree.is_dir())
        self.assertEqual(self.repo.git("branch", "--list", BRANCH).strip("+* "), BRANCH)

    def test_the_spec_worktree_and_its_local_branch_are_removed(self):
        done = self.repo.run("discard", ISSUE)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertFalse(self.repo.worktree.exists())
        self.assertEqual(self.repo.git("branch", "--list", BRANCH), "")
        self.assertEqual(self.repo.git("worktree", "list", "--porcelain").count("worktree "), 1)
        self.assertEqual(self.repo.run("create", ISSUE).returncode, 0)

    def test_run_from_another_worktree_it_removes_the_repos_spec_worktree(self):
        other = self.repo.root / ".claude" / "worktrees" / "other"
        self.repo.git("worktree", "add", "-q", "-b", "other", str(other))
        done = self.repo.run("discard", ISSUE, cwd=other)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertFalse(self.repo.worktree.exists())

    def test_a_spec_branch_with_a_commit_beyond_its_base_is_kept_naming_the_commit(self):
        self.repo.commit(self.repo.worktree, "landed.txt")
        done = self.repo.run("discard", ISSUE)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn(BRANCH, done.stderr)
        self.assertIn("landed.txt", done.stderr)
        self.assertIn("Next step:", done.stderr)
        self.assert_kept()

    def test_a_spec_branch_on_origin_is_kept_naming_it(self):
        self.repo.git("push", "-q", "origin", f"{BRANCH}:{BRANCH}", cwd=self.repo.worktree)
        done = self.repo.run("discard", ISSUE)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn(f"{BRANCH} is on origin", done.stderr)
        self.assertIn("Next step:", done.stderr)
        self.assert_kept()

    def test_an_issue_with_no_spec_branch_has_nothing_to_discard(self):
        done = self.repo.run("discard", "8")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("8-spec", done.stderr)


def staged(where):
    return subprocess.run(["git", "diff", "--cached", "--name-only"], cwd=where, capture_output=True, text=True,
                          check=True).stdout.split()


class Check(unittest.TestCase):
    """Before the session commits a completed run's folder: the run completed, the branch is the right one, and
    nothing but the folder is staged. The check commits and pushes nothing itself."""

    def setUp(self):
        self.repo = Repo()
        self.addCleanup(self.repo.close)
        done = self.repo.run("create", ISSUE)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.created = self.repo.gh_calls()
        self.base = self.repo.git("rev-parse", "HEAD", cwd=self.repo.worktree)

    def check(self, kind, project, status="completed"):
        write_folder(project)
        return self.repo.run("check", write_run(project, status, f"run-{kind}-{status}", kind), cwd=project)

    def assert_changed_nothing(self, where):
        self.assertEqual(self.repo.git("rev-parse", "HEAD", cwd=where), self.base)
        self.assertEqual(self.repo.remote_branch(BRANCH), "")
        self.assertEqual(self.repo.gh_calls(), self.created)

    def test_a_completed_new_scope_on_its_spec_branch_passes_and_gives_the_commit_message(self):
        done = self.check("new", self.repo.worktree)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout),
                         {"folder": FOLDER, "branch": BRANCH, "message": f"docs(#{ISSUE}): spec {FOLDER}"})
        self.assert_changed_nothing(self.repo.worktree)
        self.assertEqual(staged(self.repo.worktree), [])

    def test_a_project_below_the_checkout_names_its_folder_from_the_checkout(self):
        done = self.check("new", self.repo.worktree / "dev" / "demo")
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout)["folder"], f"dev/demo/{FOLDER}")

    def test_a_run_that_failed_was_rejected_or_has_not_finished_is_refused(self):
        for kind in ("new", "rescope"):
            for status in ("failed", "aborted", "paused"):
                with self.subTest(kind=kind, status=status):
                    done = self.check(kind, self.repo.worktree, status)
                    self.assertNotEqual(done.returncode, 0)
                    self.assertIn(status, done.stderr)
                    self.assert_changed_nothing(self.repo.worktree)

    def test_a_new_scope_off_its_spec_branch_is_refused_naming_it(self):
        done = self.check("new", self.repo.root)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn(BRANCH, done.stderr)

    def test_anything_staged_outside_the_folder_is_refused_naming_it(self):
        (self.repo.worktree / "stray.txt").write_text("stray")
        self.repo.git("add", "stray.txt", cwd=self.repo.worktree)
        done = self.check("new", self.repo.worktree)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("stray.txt", done.stderr)

    def test_the_folder_already_staged_passes(self):
        write_folder(self.repo.worktree)
        self.repo.git("add", FOLDER, cwd=self.repo.worktree)
        self.assertEqual(self.check("new", self.repo.worktree).returncode, 0)

    def test_a_completed_rescope_passes_on_whatever_branch_it_runs_on(self):
        story = self.repo.root / ".claude" / "worktrees" / "7-us1-demo"
        self.repo.git("worktree", "add", "-q", "-b", "7-us1-demo", str(story), "origin/main")
        done = self.check("rescope", story)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout),
                         {"folder": FOLDER, "branch": "7-us1-demo", "message": f"docs(#{ISSUE}): rescope {FOLDER}"})

    def test_a_rescope_on_origins_default_branch_is_refused_naming_it(self):
        """The spec edit lands through a PR, so never as a commit pushed to the default branch."""
        default = self.repo.root / ".claude" / "worktrees" / "trunk"
        self.repo.git("worktree", "add", "-q", "-b", "trunk", str(default), "origin/trunk")
        done = self.check("rescope", default)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("trunk", done.stderr)
        self.assertIn("Next step:", done.stderr)
        self.assertEqual(self.repo.git("rev-parse", "HEAD", cwd=default), self.repo.git("rev-parse", "origin/trunk"))

    def test_a_run_started_before_runs_took_their_folder_and_kind_is_refused_naming_the_next_step(self):
        write_folder(self.repo.worktree)
        run_id = write_run(self.repo.worktree, "completed", "run-old", inputs={"spec": "# Demo\n", "issue": ISSUE})
        for action in ("check", "open-pr"):
            with self.subTest(action=action):
                done = self.repo.run(action, run_id, cwd=self.repo.worktree)
                self.assertNotEqual(done.returncode, 0)
                self.assertIn("Next step:", done.stderr)
                self.assert_changed_nothing(self.repo.worktree)

    def test_the_script_never_commits_or_pushes_so_the_sessions_commit_gate_sees_every_commit(self):
        self.assertNotRegex(SCRIPT.read_text(), r'"(commit|push)"')


class OpenPr(unittest.TestCase):
    """A completed new scope whose folder the session committed and pushed: a draft PR, part of its issue."""

    def setUp(self):
        self.repo = Repo()
        self.addCleanup(self.repo.close)
        done = self.repo.run("create", ISSUE)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.created = self.repo.gh_calls()
        self.run_id = write_run(self.repo.worktree, "completed")
        write_folder(self.repo.worktree)

    def landed(self, pushed=True):
        """The session's part: the folder committed as the check says, and pushed."""
        done = self.repo.run("check", self.run_id, cwd=self.repo.worktree)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.repo.git("add", "--", FOLDER, cwd=self.repo.worktree)
        self.repo.git("commit", "-q", "-m", json.loads(done.stdout)["message"], cwd=self.repo.worktree)
        if pushed:
            self.repo.git("push", "-q", "--set-upstream", "origin", "HEAD", cwd=self.repo.worktree)

    def open_pr(self):
        return self.repo.run("open-pr", self.run_id, cwd=self.repo.worktree)

    def test_a_pushed_new_scope_opens_one_draft_pr_into_the_default_branch_part_of_its_issue(self):
        self.landed()
        done = self.open_pr()
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout), {"folder": FOLDER, "branch": BRANCH, "pr": PR_URL})
        self.assertEqual(sorted(self.repo.git("show", "--name-only", "--format=", "HEAD",
                                              cwd=self.repo.worktree).splitlines()),
                         [f"{FOLDER}/plan.md", f"{FOLDER}/spec.md"])
        read, create = self.repo.gh_calls()[len(self.created):]
        self.assertEqual(read, ["repo", "view", str(self.repo.origin), *DEFAULT_BRANCH_READ])
        self.assertEqual(create[:2], ["pr", "create"])
        self.assertIn("--draft", create)
        create.remove("--draft")
        flags = dict(zip(create[2::2], create[3::2]))
        self.assertEqual((flags["--repo"], flags["--base"], flags["--head"]), (str(self.repo.origin), "trunk", BRANCH))
        self.assertEqual(flags["--body"].splitlines()[0], f"Part of #{ISSUE}")
        self.assertEqual(flags["--title"], f"docs(#{ISSUE}): spec 7-demo")

    def test_a_branch_origin_does_not_have_at_its_head_opens_nothing(self):
        self.landed(pushed=False)
        done = self.open_pr()
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("Next step:", done.stderr)
        self.assertEqual(self.repo.gh_calls(), self.created)

    def test_a_branch_on_origin_whose_name_only_ends_in_the_spec_branchs_is_not_read_as_it(self):
        self.landed()
        # Sorted ahead of refs/heads/7-spec, so a match on the name's tail would read its sha first.
        self.repo.git("push", "-q", "origin", f"main:refs/heads/0/{BRANCH}", cwd=self.repo.seed)
        done = self.open_pr()
        self.assertEqual(done.returncode, 0, done.stderr)

    def test_a_run_that_has_not_completed_opens_nothing(self):
        self.landed()
        run_id = write_run(self.repo.worktree, "aborted", "run-aborted")
        done = self.repo.run("open-pr", run_id, cwd=self.repo.worktree)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("aborted", done.stderr)
        self.assertEqual(self.repo.gh_calls(), self.created)

    def test_a_rescope_opens_no_pr(self):
        self.landed()
        run_id = write_run(self.repo.worktree, "completed", "run-rescope", "rescope")
        done = self.repo.run("open-pr", run_id, cwd=self.repo.worktree)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("rescope", done.stderr)
        self.assertEqual(self.repo.gh_calls(), self.created)

    def test_a_pr_github_refuses_fails_loud(self):
        self.landed()
        self.repo.env["GH_FAILS"] = "1"
        done = self.open_pr()
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("HTTP 502", done.stderr)


if __name__ == "__main__":
    unittest.main()
