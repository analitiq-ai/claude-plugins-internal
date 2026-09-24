"""Read-only git facts about a checkout."""
from __future__ import annotations

import hashlib
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

_GITHUB_REMOTE = re.compile(r"github\.com[:/]([\w.-]+/[\w.-]+?)(?:\.git)?/?$")
_HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


@dataclass(frozen=True)
class Worktree:
    root: str
    slug: str
    branch: str


def git(root: str, *args: str, check: bool = True) -> str:
    done = subprocess.run(["git", "-C", root, *args], capture_output=True, text=True)
    if check and done.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} failed in {root}: {done.stderr.strip()}")
    return done.stdout.strip()


def locate(path: str) -> Worktree | None:
    """The GitHub repo and branch a path belongs to; None when it is not on a branch of one."""
    directory = Path(path)
    while not directory.is_dir():
        if directory == directory.parent:
            return None
        directory = directory.parent
    found = subprocess.run(["git", "-C", str(directory), "rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"],
                           capture_output=True, text=True)
    if found.returncode != 0:
        return None
    root, branch = found.stdout.strip().split("\n")
    remote = _GITHUB_REMOTE.search(git(root, "config", "--get", "remote.origin.url", check=False))
    if branch == "HEAD" or remote is None:
        return None
    return Worktree(root, remote.group(1), branch)


def head_sha(root: str) -> str:
    return git(root, "rev-parse", "HEAD")


def contents(root: str) -> dict[str, str]:
    """HEAD, and a hash of every path that differs from it, untracked included and ignored excluded:
    whatever moves the branch changes this, however it was done."""
    # Not git(): its strip() would eat the status column of the first entry.
    listing = subprocess.run(["git", "-C", root, "status", "--porcelain=v1", "-z", "--untracked-files=all",
                              "--no-renames"], capture_output=True, text=True, check=True).stdout
    found = {"HEAD": head_sha(root)}
    for entry in filter(None, listing.split("\0")):
        path = Path(root, entry[3:])
        found[entry[3:]] = hashlib.sha256(path.read_bytes()).hexdigest() if path.is_file() else "absent"
    return found


def is_dirty(root: str) -> bool:
    return bool(git(root, "status", "--porcelain", "--untracked-files=no"))


def is_ignored(root: str, path: str) -> bool:
    return subprocess.run(["git", "-C", root, "check-ignore", "-q", path], capture_output=True).returncode == 0


def review_base(root: str, target: str) -> str:
    """Where HEAD left `target`, the branch its PR merges into, as the remote has it now. A remote-tracking
    ref is only as fresh as the checkout's last fetch; a stale one puts already-merged commits under review."""
    tracking = f"refs/remotes/origin/{target}"
    try:
        fetched = subprocess.run(["git", "-C", root, "fetch", "--quiet", "--no-tags", "origin", f"+refs/heads/{target}:{tracking}"],
                                 capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError(f"git fetch of {target} timed out in {root}") from exc
    if fetched.returncode != 0:
        raise RuntimeError(f"git fetch of {target} failed in {root}: {fetched.stderr.strip()}")
    return git(root, "merge-base", tracking, "HEAD")


def changed_files(root: str, base: str) -> list[str]:
    return [f for f in git(root, "diff", "--name-only", f"{base}...HEAD").split("\n") if f]


def added_lines(root: str, since: str) -> dict[str, list[tuple[int, int]]]:
    """Per file, the line ranges (in today's numbering) written after `since`."""
    ranges: dict[str, list[tuple[int, int]]] = {}
    path = None
    for line in git(root, "diff", "-U0", f"{since}..HEAD").split("\n"):
        if line.startswith("+++ "):
            path = line[6:] if line.startswith("+++ b/") else None
        elif path and (hunk := _HUNK.match(line)):
            start, count = int(hunk.group(1)), int(hunk.group(2) or 1)
            if count:
                ranges.setdefault(path, []).append((start, start + count - 1))
    return ranges


def additions(root: str, since: str, until: str) -> int:
    rows = [r.split("\t") for r in git(root, "diff", "--numstat", f"{since}..{until}").split("\n") if r]
    return sum(int(r[0]) for r in rows if r[0] != "-")


def commits_per_file(root: str, since: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for name in git(root, "log", "--name-only", "--format=", f"{since}..HEAD").split("\n"):
        if name:
            counts[name] = counts.get(name, 0) + 1
    return counts
