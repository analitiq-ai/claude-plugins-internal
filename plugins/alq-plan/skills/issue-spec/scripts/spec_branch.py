#!/usr/bin/env python3
"""The spec branch a new scope runs on, and how a completed run lands its spec folder.

    spec_branch.py create <issue>               # branch <issue>-spec from origin's default branch, in its worktree
    spec_branch.py land <run id> <spec folder>  # a new scope: commit, push, open a draft PR into the default branch
    spec_branch.py push <run id> <spec folder>  # a rescope: commit and push on the branch it runs on

`land` and `push` run from the run's project, with the folder relative to it, and refuse a run that has not
completed: a run that failed or was rejected commits, pushes and opens nothing. Each prints one JSON report.
"""
import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

from drive_workflow import require_run, run_inputs, run_state


def _run(*command):
    proc = subprocess.run(command, capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"`{' '.join(command)}` failed:\n{proc.stdout}{proc.stderr}")
    return proc.stdout.strip()


def spec_branch(issue):
    return f"{issue}-spec"


def _origin():
    return _run("git", "remote", "get-url", "origin")


def _default_branch(origin):
    """As origin has it: the checkout's own default may be another branch, or behind."""
    return _run("gh", "repo", "view", origin, "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name")


def _where_it_exists(branch):
    """'locally', 'on origin', or None."""
    local = subprocess.run(["git", "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"],
                           capture_output=True, text=True)
    if local.returncode == 0:
        return "locally"
    if local.returncode != 1:
        sys.exit(f"`git show-ref` failed:\n{local.stderr}")
    remote = subprocess.run(["git", "ls-remote", "--exit-code", "--heads", "origin", branch],
                            capture_output=True, text=True)
    if remote.returncode == 0:
        return "on origin"
    # ls-remote --exit-code exits 2 when origin has no such branch, and otherwise when it could not ask.
    if remote.returncode != 2:
        sys.exit(f"`git ls-remote origin` failed:\n{remote.stderr}")
    return None


def create(issue):
    if not re.fullmatch(r"[1-9]\d*", issue):
        sys.exit(f"the issue must be a number as GitHub writes it, got {issue!r}")
    branch = spec_branch(issue)
    where = _where_it_exists(branch)
    if where:
        sys.exit(f"Branch {branch} exists {where}: issue #{issue} already has a spec branch. Next step: rescope its "
                 f"spec from that branch's worktree, with `rescope <spec folder> #{issue}`.")
    origin = _origin()
    base = _default_branch(origin)
    _run("git", "fetch", "--quiet", "origin", base)
    # Under the repo's main worktree, whichever of its worktrees this runs in.
    root = Path(_run("git", "rev-parse", "--path-format=absolute", "--git-common-dir")).parent
    worktree = root / ".claude" / "worktrees" / branch
    _run("git", "worktree", "add", "--quiet", "--no-track", "-b", branch, str(worktree), f"origin/{base}")
    return {"branch": branch, "worktree": str(worktree), "base": f"origin/{base}"}


def _completed_run_issue(run_id):
    require_run(run_id)
    status = run_state(run_id)["status"]
    if status != "completed":
        sys.exit(f"run {run_id} is {status}: only a completed run lands its spec, so nothing was committed, pushed or "
                 "opened. Next step: resume the run until it completes; a rejected run lands nothing.")
    return run_inputs(run_id)["issue"]


def _current_branch():
    branch = _run("git", "rev-parse", "--abbrev-ref", "HEAD")
    if branch == "HEAD":
        sys.exit("the checkout is on no branch. Next step: run from the worktree of the branch the spec lands on.")
    return branch


def _from_checkout(folder):
    return Path(_run("git", "rev-parse", "--show-prefix"), folder).as_posix()


def _commit_and_push(folder, message):
    _run("git", "add", "--", folder)
    _run("git", "commit", "--quiet", "-m", message, "--", folder)
    _run("git", "push", "--quiet", "--set-upstream", "origin", "HEAD")


def land(run_id, folder):
    issue = _completed_run_issue(run_id)
    branch = spec_branch(issue)
    current = _current_branch()
    if current != branch:
        sys.exit(f"the checkout is on {current}, not {branch}: a new scope lands its spec on its spec branch. "
                 f"Next step: run from the worktree `spec_branch.py create {issue}` made.")
    shown = _from_checkout(folder)
    origin = _origin()
    base = _default_branch(origin)
    _commit_and_push(folder, f"docs(#{issue}): spec {shown}")
    pr = _run("gh", "pr", "create", "--repo", origin, "--draft", "--base", base, "--head", branch,
              "--title", f"docs(#{issue}): spec {Path(folder).name}",
              "--body", f"Part of #{issue}\n\nSpec folder: `{shown}`\n")
    return {"folder": shown, "branch": branch, "pr": pr}


def push(run_id, folder):
    issue = _completed_run_issue(run_id)
    branch = _current_branch()
    shown = _from_checkout(folder)
    _commit_and_push(folder, f"docs(#{issue}): rescope {shown}")
    return {"folder": shown, "branch": branch}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("create").add_argument("issue")
    for action in ("land", "push"):
        p = sub.add_parser(action)
        p.add_argument("run_id")
        p.add_argument("folder")
    args = parser.parse_args()
    if args.action == "create":
        out = create(args.issue)
    else:
        out = {"land": land, "push": push}[args.action](args.run_id, args.folder)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
