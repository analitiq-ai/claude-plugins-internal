"""The `HEAD` copy a shim sweeper reads (spec 006 R3)."""
from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
import tempfile

from worktree import git

_NAME = re.compile(r"shim-[0-9a-f]{12}")


def snapshot_of(path: str) -> str | None:
    """The `.claude/worktrees/shim-<12 hex>` folder that `path`'s real path lies in, or None."""
    parts = os.path.realpath(path).split(os.sep)
    for i in range(2, len(parts)):
        if _NAME.fullmatch(parts[i]) and parts[i - 2:i] == [".claude", "worktrees"]:
            return os.sep.join(parts[:i + 1])
    return None


def folder(checkout: str, tree: str) -> str:
    """The snapshot folder of the check of staged `tree` at `checkout`'s `HEAD`; no two checks share one."""
    main = os.path.dirname(git(checkout, "rev-parse", "--path-format=absolute", "--git-common-dir"))
    head = git(checkout, "rev-parse", "HEAD")
    name = hashlib.sha256(f"{head}\0{tree}".encode()).hexdigest()[:12]
    return os.path.join(main, ".claude", "worktrees", f"shim-{name}")


def export(checkout: str, tree: str) -> str:
    """The snapshot folder of `checkout`'s `HEAD` for the check of `tree`, written unless it exists."""
    target = folder(checkout, tree)
    head = git(checkout, "rev-parse", "HEAD")
    parent = os.path.dirname(target)
    if os.path.isdir(target):
        return target
    os.makedirs(parent, exist_ok=True)
    # Written aside and renamed in, so a killed export leaves no partial folder under the snapshot's name.
    staging = tempfile.mkdtemp(prefix=f".{os.path.basename(target)}-", dir=parent)
    try:
        archive = subprocess.Popen(["git", "-C", checkout, "archive", head], stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE)
        untar = subprocess.run(["tar", "-x", "-C", staging], stdin=archive.stdout, capture_output=True)
        archive.stdout.close()
        with archive.stderr:
            said = archive.stderr.read().decode(errors="replace")
        if archive.wait() != 0 or untar.returncode != 0:
            raise RuntimeError(f"the snapshot of {head} could not be written: {said}{untar.stderr.decode(errors='replace')}")
        try:
            os.rename(staging, target)
        except OSError:
            if not os.path.isdir(target):
                raise
    finally:
        if os.path.isdir(staging):
            shutil.rmtree(staging)
    return target


def remove(path: str) -> None:
    """Delete the snapshot folder at `path`; nothing when `path` does not exist. Raises, deleting nothing, when
    `path` is not a snapshot folder or reaches one through a symlink."""
    if not os.path.lexists(path):
        return
    real = os.path.realpath(path)
    if real != os.path.abspath(path) or snapshot_of(real) != real:
        raise ValueError(f"{path} is not a shim snapshot folder, so it is not deleted")
    shutil.rmtree(real)
