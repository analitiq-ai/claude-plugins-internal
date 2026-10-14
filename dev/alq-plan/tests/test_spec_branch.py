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

    def test_a_default_branch_github_will_not_name_creates_nothing(self):
        self.repo.env["GH_FAILS"] = "1"
        done = self.repo.run("create", ISSUE)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("HTTP 502", done.stderr)
        self.assert_created_nothing()


def write_run(project: Path, status: str, run_id="run-1"):
    """A run as drive_workflow.py reads it: its state and the inputs it was started with."""
    run = project / ".specify" / "workflows" / "runs" / run_id
    run.mkdir(parents=True)
    (run / "state.json").write_text(json.dumps({"run_id": run_id, "status": status, "current_step_id": "tasks",
                                                "error": None, "step_results": {}}))
    (run / "inputs.json").write_text(json.dumps({"inputs": {"spec": "# Demo\n", "issue": ISSUE}}))
    return run_id


def write_folder(project: Path, folder=FOLDER):
    (project / folder).mkdir(parents=True, exist_ok=True)
    (project / folder / "spec.md").write_text("# Demo\n")
    (project / folder / "plan.md").write_text("# Plan\n")


class Land(unittest.TestCase):
    """A completed new scope: its folder committed and pushed on the spec branch, and a draft PR part of its issue."""

    def setUp(self):
        self.repo = Repo()
        self.addCleanup(self.repo.close)
        done = self.repo.run("create", ISSUE)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.created = self.repo.gh_calls()
        self.base = self.repo.git("rev-parse", "HEAD", cwd=self.repo.worktree)

    def land(self, project, status="completed"):
        write_folder(project)
        return self.repo.run("land", write_run(project, status, f"run-{status}"), FOLDER, cwd=project)

    def committed(self):
        return self.repo.git("show", "--name-only", "--format=", "HEAD", cwd=self.repo.worktree).splitlines()

    def test_a_completed_new_scope_commits_the_folder_pushes_the_branch_and_opens_a_draft_pr(self):
        done = self.land(self.repo.worktree)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout), {"folder": FOLDER, "branch": BRANCH, "pr": PR_URL})
        self.assertEqual(sorted(self.committed()), [f"{FOLDER}/plan.md", f"{FOLDER}/spec.md"])
        head = self.repo.git("rev-parse", "HEAD", cwd=self.repo.worktree)
        self.assertEqual(self.repo.git("rev-parse", "HEAD~1", cwd=self.repo.worktree), self.base)
        self.assertEqual(self.repo.remote_branch(BRANCH), head)
        read, create = self.repo.gh_calls()[len(self.created):]
        self.assertEqual(read, ["repo", "view", str(self.repo.origin), *DEFAULT_BRANCH_READ])
        self.assertEqual(create[:2], ["pr", "create"])
        self.assertIn("--draft", create)
        create.remove("--draft")
        flags = dict(zip(create[2::2], create[3::2]))
        self.assertEqual((flags["--repo"], flags["--base"], flags["--head"]), (str(self.repo.origin), "trunk", BRANCH))
        self.assertEqual(flags["--body"].splitlines()[0], f"Part of #{ISSUE}")
        self.assertTrue(flags["--title"])

    def test_a_project_below_the_checkout_names_its_folder_from_the_checkout(self):
        project = self.repo.worktree / "dev" / "demo"
        done = self.land(project)
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout)["folder"], f"dev/demo/{FOLDER}")
        self.assertEqual(sorted(self.committed()), [f"dev/demo/{FOLDER}/plan.md", f"dev/demo/{FOLDER}/spec.md"])

    def test_a_run_that_failed_was_rejected_or_has_not_finished_commits_pushes_and_opens_nothing(self):
        for status in ("failed", "aborted", "paused"):
            with self.subTest(status=status):
                done = self.land(self.repo.worktree, status)
                self.assertNotEqual(done.returncode, 0)
                self.assertIn(status, done.stderr)
                self.assertEqual(self.repo.git("rev-parse", "HEAD", cwd=self.repo.worktree), self.base)
                self.assertEqual(self.repo.remote_branch(BRANCH), "")
                self.assertEqual(self.repo.gh_calls(), self.created)

    def test_a_default_branch_github_will_not_name_commits_pushes_and_opens_nothing(self):
        self.repo.env["GH_FAILS"] = "1"
        done = self.land(self.repo.worktree)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("HTTP 502", done.stderr)
        self.assertEqual(self.repo.git("rev-parse", "HEAD", cwd=self.repo.worktree), self.base)
        self.assertEqual(self.repo.remote_branch(BRANCH), "")

    def test_landing_off_the_spec_branch_is_refused_naming_it(self):
        done = self.land(self.repo.root)
        self.assertNotEqual(done.returncode, 0)
        self.assertIn(BRANCH, done.stderr)
        self.assertEqual(self.repo.git("rev-parse", "HEAD"), self.repo.git("rev-parse", "origin/main"))
        self.assertEqual(self.repo.remote_branch(BRANCH), "")


class Push(unittest.TestCase):
    """A completed rescope: the spec edit committed and pushed on the branch of the worktree it ran in, and nothing
    created."""
    STORY = "7-us1-demo"

    def setUp(self):
        self.repo = Repo()
        self.addCleanup(self.repo.close)
        self.checkout = self.repo.root / ".claude" / "worktrees" / self.STORY
        self.repo.git("worktree", "add", "-q", "-b", self.STORY, str(self.checkout), "origin/main")
        self.base = self.repo.git("rev-parse", "HEAD", cwd=self.checkout)

    def push(self, status="completed"):
        write_folder(self.checkout)
        return self.repo.run("push", write_run(self.checkout, status), FOLDER, cwd=self.checkout)

    def test_a_completed_rescope_commits_and_pushes_on_its_worktrees_branch_and_creates_nothing(self):
        branches = self.repo.git("branch", "--list")
        worktrees = self.repo.git("worktree", "list", "--porcelain")
        done = self.push()
        self.assertEqual(done.returncode, 0, done.stderr)
        self.assertEqual(json.loads(done.stdout), {"folder": FOLDER, "branch": self.STORY})
        head = self.repo.git("rev-parse", "HEAD", cwd=self.checkout)
        self.assertEqual(self.repo.git("rev-parse", "HEAD~1", cwd=self.checkout), self.base)
        self.assertEqual(sorted(self.repo.git("show", "--name-only", "--format=", "HEAD", cwd=self.checkout).splitlines()),
                         [f"{FOLDER}/plan.md", f"{FOLDER}/spec.md"])
        self.assertEqual(self.repo.remote_branch(self.STORY), head)
        self.assertEqual((self.repo.git("branch", "--list"), self.repo.git("worktree", "list", "--porcelain")),
                         (branches, worktrees))
        self.assertEqual(self.repo.gh_calls(), [])

    def test_a_rescope_that_failed_or_was_rejected_commits_and_pushes_nothing(self):
        done = self.push("aborted")
        self.assertNotEqual(done.returncode, 0)
        self.assertIn("aborted", done.stderr)
        self.assertEqual(self.repo.git("rev-parse", "HEAD", cwd=self.checkout), self.base)
        self.assertEqual(self.repo.remote_branch(self.STORY), "")


if __name__ == "__main__":
    unittest.main()
