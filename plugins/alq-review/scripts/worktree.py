"""Read-only git facts about a checkout."""
from __future__ import annotations

import hashlib
import os
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


def _run(root: str, *args: str, timeout: float | None = None) -> subprocess.CompletedProcess:
    try:
        # Untranslated, because the watch reads git's messages.
        return subprocess.run(["git", "-C", root, *args], capture_output=True, text=True, timeout=timeout,
                              env=dict(os.environ, LC_ALL="C"))
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(f"git {' '.join(args)} could not run in {root}: {exc}") from exc


def _failure(root: str, args: tuple[str, ...], done: subprocess.CompletedProcess) -> RuntimeError:
    return RuntimeError(f"git {' '.join(args)} failed in {root}: {done.stderr.strip()}")


def git(root: str, *args: str, check: bool = True) -> str:
    done = _run(root, *args)
    if check and done.returncode != 0:
        raise _failure(root, args, done)
    return done.stdout.strip()


def locate(path: str) -> Worktree | None:
    """The GitHub repo and branch a path belongs to; None when it is not on a branch of one."""
    directory = Path(path)
    while not directory.is_dir():
        if directory == directory.parent:
            return None
        directory = directory.parent
    found = _run(str(directory), "rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD")
    if found.returncode != 0:
        return None
    root, branch = found.stdout.strip().split("\n")
    remote = _GITHUB_REMOTE.search(git(root, "config", "--get", "remote.origin.url", check=False))
    if branch == "HEAD" or remote is None:
        return None
    return Worktree(root, remote.group(1), branch)


def head_sha(root: str) -> str:
    return git(root, "rev-parse", "HEAD")


@dataclass(frozen=True)
class Snapshot:
    """What a held checkout looked like. `digests` maps every path that differs from the tip to its sha256,
    or None when the path is gone; `unverified` holds the paths whose content could not be read, and
    `contents_unverified` what git said when it could not say which: then no file content is trusted."""
    tip: str
    digests: dict[str, str | None]
    unverified: frozenset[str]
    contents_unverified: str | None = None

    def to_json(self) -> dict:
        return {"tip": self.tip, "digests": self.digests, "unverified": sorted(self.unverified),
                "contents_unverified": self.contents_unverified}

    @classmethod
    def from_json(cls, data: dict) -> Snapshot:
        return cls(data["tip"], data["digests"], frozenset(data["unverified"]), data["contents_unverified"])


def contents(root: str, branch: str) -> Snapshot:
    """The tip of `branch` and, while `root` has it checked out, every path that differs from it, untracked
    included and ignored excluded: whatever moves the branch changes this, however it was done. Checking
    another branch out does not move it. RuntimeError when git cannot run or read the checkout, reads it as
    part of an enclosing repo, or the tip, branch or status lookup fails. Only a branch git says is not there reads as
    deleted. What git says on the side narrows which contents are trusted, never whether the tip is."""
    toplevel = git(root, "rev-parse", "--show-toplevel")
    if Path(toplevel).resolve() != Path(root).resolve():
        raise RuntimeError(f"git reads {root} as part of {toplevel}: its own .git is gone")
    args = ("rev-parse", "--verify", "--quiet", f"refs/heads/{branch}")
    tip = _run(root, *args)
    if tip.returncode == 1:
        return Snapshot("deleted", {}, frozenset())
    if tip.returncode != 0:
        raise _failure(root, args, tip)
    if git(root, "branch", "--show-current") != branch:
        return Snapshot(tip.stdout.strip(), {}, frozenset())
    # Not git(): its strip() would eat the status column of the first entry.
    args = ("status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames")
    listing = _run(root, *args)
    if listing.returncode != 0:
        raise _failure(root, args, listing)
    unverified, complaints = set(), []
    for line in filter(None, listing.stderr.splitlines()):
        found = next(filter(None, (pattern.match(line) for pattern in _STATUS_UNREADABLE)), None)
        if found:
            unverified.add(found.group(1))
        else:
            complaints.append(line)
    digests = {}
    for name in (entry[3:] for entry in listing.stdout.split("\0") if entry):
        path = Path(root, name)
        if not path.is_file():
            digests[name] = None
            continue
        try:
            digests[name] = hashlib.sha256(path.read_bytes()).hexdigest()
        except OSError:
            unverified.add(name)
    return Snapshot(tip.stdout.strip(), digests, frozenset(unverified), "; ".join(complaints) or None)


# git status exits 0 on a path it cannot read and names it only on stderr, quoted in a warning or bare.
_STATUS_UNREADABLE = (re.compile(r"^warning: [^']*'(.+)': Permission denied$"),
                      re.compile(r"^(?!(?:warning|error|fatal): )(.+): Permission denied$"))


def compare(before: Snapshot, after: Snapshot) -> tuple[list[str], list[str]]:
    """What moved between two snapshots, and which paths could not be compared. Only what differs from the tip
    afterwards can have moved: a path back as the tip has it was put back. Content unreadable on either side is
    never a move: the gate reports it and does not block on it."""
    unverified = before.unverified | after.unverified
    moved = ["tip"] if before.tip != after.tip else []
    if before.contents_unverified or after.contents_unverified:
        return moved, sorted(unverified)
    for path, digest in sorted(after.digests.items()):
        if path not in unverified and (path not in before.digests or before.digests[path] != digest):
            moved.append(path)
    return moved, sorted(unverified)


def is_dirty(root: str) -> bool:
    return bool(git(root, "status", "--porcelain", "--untracked-files=no"))


def is_ignored(root: str, path: str) -> bool:
    return _run(root, "check-ignore", "-q", path).returncode == 0


def review_base(root: str, target: str) -> str:
    """Where HEAD left `target`, the branch its PR merges into, as the remote has it now. A remote-tracking
    ref is only as fresh as the checkout's last fetch; a stale one puts already-merged commits under review."""
    tracking = f"refs/remotes/origin/{target}"
    fetched = _run(root, "fetch", "--quiet", "--no-tags", "origin", f"+refs/heads/{target}:{tracking}", timeout=30)
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
