"""The accepted decisions (ADRs) that govern the files a review round reads.

adrkit's `adr check` answers per corpus and keeps ids per corpus, so each corpus is asked on its own: every `docs/adr`
the repo tracks, and the org's at $ALQ_ORG_ADR_DIR. Only accepted decisions (adrkit's `governing` bucket) bind a change.
"""
from __future__ import annotations

import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import worktree

ORG_CORPUS_VAR = "ALQ_ORG_ADR_DIR"
INSTALL = "npm install -g @adrkit/cli"
_CHECK_TIMEOUT = 120


class Unavailable(RuntimeError):
    """A corpus that should be checked cannot be."""


@dataclass(frozen=True)
class Decision:
    corpus: str
    record_id: str
    title: str
    record: str


@dataclass(frozen=True)
class Governance:
    decisions: tuple[Decision, ...]
    # adrkit's error findings on records the change itself edits.
    record_errors: tuple[str, ...]
    notices: tuple[str, ...]


def _corpora(root: str, org: str | None) -> list[tuple[str, Path]]:
    """(label, directory) of each corpus; an org corpus that is also one of the repo's is the repo's. A repo corpus is
    named from `root`, as the changed files are: adrkit sees that a changed file is one of its records only then."""
    tracked = sorted({str(Path(f).parent) for f in worktree.tracked(root, "*docs/adr/*")
                      if Path(f).parent.parts[-2:] == ("docs", "adr")})
    corpora = [(label, Path(label)) for label in tracked]
    if org is not None and Path(org).resolve() not in {(Path(root) / path).resolve() for _, path in corpora}:
        if not Path(org).is_dir():
            raise Unavailable(f"{ORG_CORPUS_VAR} names {org}, which is not a directory, so the org's decisions cannot "
                              f"be checked. Next step: point {ORG_CORPUS_VAR} at the org's docs/adr, or unset it.")
        corpora.append((f"org ({org})", Path(org)))
    return corpora


def _check(root: str, files: list[str], label: str, corpus: Path, cli: str) -> dict:
    try:
        done = subprocess.run([cli, "check", *files, "--dir", str(corpus), "--json"], cwd=root, capture_output=True,
                              text=True, timeout=_CHECK_TIMEOUT)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Unavailable(f"adr check of the {label} decisions failed: {exc}. "
                          "Next step: fix it and launch again.") from exc
    # 1 is a changed record with an error finding; the report is complete either way.
    if done.returncode not in (0, 1):
        raise Unavailable(f"adr check of the {label} decisions exited {done.returncode}: {done.stderr.strip()}. "
                          "Next step: fix it and launch again.")
    try:
        return json.loads(done.stdout)
    except json.JSONDecodeError as exc:
        raise Unavailable(f"adr check of the {label} decisions printed no JSON report ({exc}). "
                          "Next step: fix it and launch again.") from exc


def _record(root: str, label: str, corpus: Path, record_id: str) -> str:
    found = sorted((Path(root) / corpus).glob(f"{record_id}-*.md"))
    if len(found) != 1:
        raise Unavailable(f"adr check named decision {record_id} of the {label} decisions, and {corpus} holds "
                          f"{len(found)} files for it. Next step: give each record one file, <id>-<slug>.md.")
    return str(found[0])


def governing(root: str, files: list[str], org: str | None, cli: str | None) -> Governance:
    """The accepted decisions of every corpus that govern `files` (paths from `root`)."""
    notices = () if org is not None else (
        f"{ORG_CORPUS_VAR} is not set, so the org's decisions were not checked.",)
    corpora = _corpora(root, org)
    if corpora and cli is None:
        raise Unavailable(f"Decisions in {', '.join(label for label, _ in corpora)} cannot be checked without "
                          f"adrkit's CLI `adr`. Next step: {INSTALL}, then launch again.")
    decisions, errors = [], []
    for label, corpus in corpora:
        report = _check(root, files, label, corpus, cli)
        decisions += [Decision(label, d["recordId"], d["title"], _record(root, label, corpus, d["recordId"]))
                      for d in report["governing"]]
        errors += [f"{f['path']}: {f['message']} ({f['rule']})" for f in report["findings"] if f["severity"] == "error"]
    return Governance(tuple(decisions), tuple(errors), notices)
