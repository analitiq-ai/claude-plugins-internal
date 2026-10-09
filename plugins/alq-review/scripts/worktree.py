"""Read-only git facts about a checkout."""
from __future__ import annotations

import hashlib
import os
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path

_GITHUB_REMOTE = re.compile(r"github\.com[:/]([\w.-]+/[\w.-]+?)(?:\.git)?/?$")
_HUNK = re.compile(r"^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@")


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


@dataclass(frozen=True)
class Hunk:
    """One `@@` of a -U0 diff. Counts git omits are 1; `removed` and `added` are the body lines without their sign."""
    file: str
    old_start: int
    old_count: int
    new_start: int
    new_count: int
    removed: tuple[str, ...]
    added: tuple[str, ...]
    header: str  # the file's `diff --git` block, so a hunk can be fingerprinted on its own

    def patch(self) -> str:
        body = [f"-{line}" for line in self.removed] + [f"+{line}" for line in self.added]
        return "\n".join([self.header, f"@@ -{self.old_start},{self.old_count} +{self.new_start},{self.new_count} @@",
                          *body, ""])


def _hunks(diff: str) -> list[Hunk]:
    """Every hunk of a -U0 diff of files git reads as text; a file with no `+++` side (deleted) has none."""
    found: list[Hunk] = []
    header: list[str] = []
    path, current = None, None
    for line in diff.split("\n"):
        if line.startswith("diff --git "):
            header, path, current = [line], None, None
        elif current is None and not line.startswith("@@"):
            header.append(line)
            if line.startswith("+++ "):
                # Git ends the name with a TAB when it holds a space.
                path = line[6:].removesuffix("\t") if line.startswith("+++ b/") else None
        elif hunk := _HUNK.match(line):
            current = None
            if path:
                current = Hunk(path, int(hunk[1]), int(hunk[2] or 1), int(hunk[3]), int(hunk[4] or 1), (), (),
                               "\n".join(header))
                found.append(current)
        elif current is not None and line[:1] in ("-", "+"):
            side = "removed" if line[0] == "-" else "added"
            found[-1] = current = _extend(current, side, line[1:])
    return found


def _extend(hunk: Hunk, side: str, line: str) -> Hunk:
    return Hunk(**{**hunk.__dict__, side: getattr(hunk, side) + (line,)})


def added_lines(root: str, since: str) -> dict[str, list[tuple[int, int]]]:
    """Per file, the line ranges (in today's numbering) written after `since`."""
    ranges: dict[str, list[tuple[int, int]]] = {}
    for hunk in _hunks(git(root, "diff", "-U0", f"{since}..HEAD")):
        if hunk.new_count:
            ranges.setdefault(hunk.file, []).append((hunk.new_start, hunk.new_start + hunk.new_count - 1))
    return ranges


EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904"  # `git hash-object -t tree /dev/null`


def head_tree(root: str) -> str:
    """The tree a commit made now would be measured against: HEAD's, or the empty tree before the first commit."""
    found = _run(root, "rev-parse", "--verify", "--quiet", "HEAD^{tree}")
    return found.stdout.strip() if found.returncode == 0 else EMPTY_TREE


def staged_tree(root: str) -> str:
    return git(root, "write-tree")


def tree_hunks(root: str, base: str, tree: str) -> list[dict]:
    """The hunks that turn tree `base` into tree `tree`, each with git's whitespace-blind fingerprint of its own text
    (`git patch-id --stable`). Files marked linguist-generated are left out; binary files have no hunks."""
    hunks = _hunks(git(root, "diff", "-U0", "-M", base, tree))
    generated = _generated(root, tree, sorted({h.file for h in hunks}))
    hunks = [h for h in hunks if h.file not in generated]
    if not hunks:
        return []
    # One patch-id call for all hunks: each is fed as its own "commit", named by its index.
    stream = "".join(f"commit {i:040x}\n{h.patch()}" for i, h in enumerate(hunks))
    ids = dict(reversed(row.split()) for row in _stdin(root, stream, "patch-id", "--stable").split("\n") if row)
    return [{"id": f"h{i + 1}", "file": h.file, "old_start": h.old_start, "old_count": h.old_count,
             "new_start": h.new_start, "new_count": h.new_count, "removed": list(h.removed), "added": list(h.added),
             "patch_id": ids[f"{i:040x}"]} for i, h in enumerate(hunks)]


def on_disk(root: str, file: str) -> bool:
    """Whether the checkout still has `file`. A file taken out of the stage but still on disk is not gone; a moved or deleted one is,
    and the staged tree cannot tell the two apart for a file no commit ever held."""
    return os.path.exists(os.path.join(root, file))


def text_hunks(root: str, old: str, new: str) -> list[Hunk]:
    """The hunks that turn text `old` into text `new`, as git diffs them. Both are written as blobs first, so the
    answer never depends on which objects the repository kept."""
    blobs = [_stdin(root, text, "hash-object", "-w", "--stdin").strip() for text in (old, new)]
    return _hunks(git(root, "diff", "-U0", *blobs))


def tree_diff(root: str, base: str, tree: str, paths: list[str]) -> str:
    """The diff from tree `base` to tree `tree`, of `paths` when any are named, with three lines of context."""
    return git(root, "diff", "-U3", "-M", base, tree, "--", *paths)


def tree_text(root: str, tree: str, path: str) -> str | None:
    """`path` as tree `tree` records it; None when the tree has no such file."""
    found = _run(root, "cat-file", "blob", f"{tree}:{path}")
    return found.stdout if found.returncode == 0 else None


def tree_blob(root: str, tree: str, path: str) -> str | None:
    found = _run(root, "rev-parse", "--verify", "--quiet", f"{tree}:{path}")
    return found.stdout.strip() if found.returncode == 0 else None


def unstaged(root: str) -> list[str]:
    """Tracked files whose checkout differs from the index."""
    return [p for p in git(root, "diff", "--name-only").split("\n") if p]


def concluding(root: str) -> bool:
    """Whether the next commit concludes a merge, cherry-pick or revert: its content was settled by that operation."""
    return any(os.path.exists(git(root, "rev-parse", "--path-format=absolute", "--git-path", ref))
               for ref in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD"))


def _generated(root: str, tree: str, paths: list[str]) -> set[str]:
    if not paths:
        return set()
    out = _stdin(root, "\0".join(paths) + "\0", "check-attr", "--source", tree, "-z", "--stdin", "linguist-generated")
    fields = out.split("\0")
    return {fields[i] for i in range(0, len(fields) - 2, 3) if fields[i + 2] in ("set", "true")}


def _stdin(root: str, text: str, *args: str) -> str:
    try:
        done = subprocess.run(["git", "-C", root, *args], input=text, capture_output=True, text=True,
                              env=dict(os.environ, LC_ALL="C"))
    except OSError as exc:
        raise RuntimeError(f"git {' '.join(args)} could not run in {root}: {exc}") from exc
    if done.returncode != 0:
        raise _failure(root, args, done)
    return done.stdout


def additions(root: str, since: str, until: str) -> int:
    rows = [r.split("\t") for r in git(root, "diff", "--numstat", f"{since}..{until}").split("\n") if r]
    return sum(int(r[0]) for r in rows if r[0] != "-")


def commits_per_file(root: str, since: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for name in git(root, "log", "--name-only", "--format=", f"{since}..HEAD").split("\n"):
        if name:
            counts[name] = counts.get(name, 0) + 1
    return counts
