#!/usr/bin/env python3
"""The spec branch a new scope runs on, and the checks around the session landing a completed run's spec folder.

    spec_branch.py create <issue>                         # branch <issue>-spec from origin's default branch
    spec_branch.py check new|rescope <run id> <folder>    # before the session commits and pushes the folder
    spec_branch.py open-pr <run id> <folder>              # a new scope, once pushed: a draft PR into the default branch
    spec_branch.py discard <issue>                        # a new scope that did not land: its worktree and branch

The session runs `git commit` and `git push` itself, never this script, so the commit gate sees every commit.
`check` and `open-pr` run from the run's project, with the folder relative to it, and refuse a run that has not
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


def _exists_locally(branch):
    local = subprocess.run(["git", "show-ref", "--verify", "--quiet", f"refs/heads/{branch}"],
                           capture_output=True, text=True)
    if local.returncode not in (0, 1):
        sys.exit(f"`git show-ref` failed:\n{local.stderr}")
    return local.returncode == 0


def _exists_on_origin(branch):
    remote = subprocess.run(["git", "ls-remote", "--exit-code", "--heads", "origin", branch],
                            capture_output=True, text=True)
    # ls-remote --exit-code exits 2 when origin has no such branch, and otherwise when it could not ask.
    if remote.returncode not in (0, 2):
        sys.exit(f"`git ls-remote origin` failed:\n{remote.stderr}")
    return remote.returncode == 0


def create(issue):
    if not re.fullmatch(r"[1-9]\d*", issue):
        sys.exit(f"the issue must be a number as GitHub writes it, got {issue!r}")
    branch = spec_branch(issue)
    where = "locally" if _exists_locally(branch) else "on origin" if _exists_on_origin(branch) else None
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
        sys.exit(f"run {run_id} is {status}: only a completed run lands its spec, so nothing is to be committed, "
                 "pushed or opened. Next step: resume the run until it completes; a rejected run lands nothing.")
    return run_inputs(run_id)["issue"]


def _current_branch():
    branch = _run("git", "rev-parse", "--abbrev-ref", "HEAD")
    if branch == "HEAD":
        sys.exit("the checkout is on no branch. Next step: run from the worktree of the branch the spec lands on.")
    return branch


def _on_spec_branch(issue):
    branch, current = spec_branch(issue), _current_branch()
    if current != branch:
        sys.exit(f"the checkout is on {current}, not {branch}: a new scope lands its spec on its spec branch. "
                 f"Next step: run from the worktree `spec_branch.py create {issue}` made.")
    return branch


def _from_checkout(folder):
    return Path(_run("git", "rev-parse", "--show-prefix"), folder).as_posix()


def check(kind, run_id, folder):
    issue = _completed_run_issue(run_id)
    branch = _on_spec_branch(issue) if kind == "new" else _current_branch()
    shown = _from_checkout(folder)
    # The session commits what is staged, so anything else staged would land with the spec.
    others = [path for path in _run("git", "diff", "--cached", "--name-only").splitlines()
              if not path.startswith(f"{shown}/")]
    if others:
        sys.exit(f"staged outside {shown}: {', '.join(others)}. Next step: unstage them (`git restore --staged "
                 "<path>`); only the spec folder lands.")
    verb = "spec" if kind == "new" else "rescope"
    return {"folder": shown, "branch": branch, "message": f"docs(#{issue}): {verb} {shown}"}


def open_pr(run_id, folder):
    issue = _completed_run_issue(run_id)
    branch = _on_spec_branch(issue)
    shown = _from_checkout(folder)
    head = _run("git", "rev-parse", "HEAD")
    pushed = _run("git", "ls-remote", "--heads", "origin", branch).split("\t")[0]
    if pushed != head:
        sys.exit(f"origin's {branch} is {pushed or 'missing'}, not HEAD {head}: the PR would not hold the spec. "
                 "Next step: commit the folder and push the branch, then open the PR.")
    origin = _origin()
    pr = _run("gh", "pr", "create", "--repo", origin, "--draft", "--base", _default_branch(origin), "--head", branch,
              "--title", f"docs(#{issue}): spec {Path(folder).name}",
              "--body", f"Part of #{issue}\n\nSpec folder: `{shown}`\n")
    return {"folder": shown, "branch": branch, "pr": pr}


def discard(issue):
    branch = spec_branch(issue)
    root = Path(_run("git", "rev-parse", "--path-format=absolute", "--git-common-dir")).parent
    if not _exists_locally(branch):
        sys.exit(f"there is no branch {branch} to discard.")
    if _exists_on_origin(branch):
        sys.exit(f"{branch} is on origin, so it is not only this session's. Next step: ask the user whether its PR "
                 "or branch should go; nothing was removed.")
    base = f"origin/{_default_branch(_origin())}"
    beyond = _run("git", "-C", str(root), "log", "--format=%h %s", f"{base}..{branch}")
    if beyond:
        sys.exit(f"{branch} holds commits beyond {base}: {'; '.join(beyond.splitlines())}. Next step: land them, or "
                 "ask the user before removing the branch; nothing was removed.")
    worktree = root / ".claude" / "worktrees" / branch
    # A run that stopped leaves its folder and run files uncommitted; they go with the scope that did not land.
    _run("git", "-C", str(root), "worktree", "remove", "--force", str(worktree))
    _run("git", "-C", str(root), "branch", "--delete", "--force", branch)
    return {"discarded": branch, "worktree": str(worktree)}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)
    for action in ("create", "discard"):
        sub.add_parser(action).add_argument("issue")
    c = sub.add_parser("check")
    c.add_argument("kind", choices=("new", "rescope"))
    for p in (c, sub.add_parser("open-pr")):
        p.add_argument("run_id")
        p.add_argument("folder")
    args = parser.parse_args()
    if args.action == "check":
        out = check(args.kind, args.run_id, args.folder)
    elif args.action == "open-pr":
        out = open_pr(args.run_id, args.folder)
    else:
        out = {"create": create, "discard": discard}[args.action](args.issue)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
