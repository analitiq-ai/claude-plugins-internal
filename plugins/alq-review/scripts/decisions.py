"""The accepted decisions (ADRs) that govern the files a review round reads.

adrkit's `adr check` answers per corpus and keeps ids per corpus, so each corpus is asked on its own: every `docs/adr`
the repo tracks, and the org's at $ALQ_ORG_ADR_DIR. Only accepted decisions (adrkit's `governing` bucket) bind a change.
"""
from __future__ import annotations

import json
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

import worktree

ORG_CORPUS_VAR = "ALQ_ORG_ADR_DIR"
INSTALL = "npm install -g @adrkit/cli@0.20.0"
# Seconds for every adr call of one launch: the launch hook gets 60, and gh and git fetch spend part of them first.
BUDGET = 20.0


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
    # adrkit's lint errors, in any corpus checked: `adr check` leaves out a record it cannot load, so a broken record
    # that should govern the change would govern nothing.
    record_errors: tuple[str, ...]
    notices: tuple[str, ...]


def _corpora(root: str, org: str | None) -> list[tuple[str, Path]]:
    """(label, directory) of each corpus; an org corpus that is also one of the repo's is the repo's. A repo corpus is
    named from `root`, as the changed files are: adrkit sees that a changed file is one of its records only then."""
    tracked = sorted({str(Path(f).parent) for f in worktree.tracked(root, "*docs/adr/*")
                      if Path(f).parent.parts[-2:] == ("docs", "adr")})
    corpora = [(label, Path(label)) for label in tracked]
    if org is None:
        return corpora
    if not Path(org).is_absolute():
        raise Unavailable(f"{ORG_CORPUS_VAR} names {org}, which is not an absolute path; the hook and adr run from "
                          f"different directories. Next step: set {ORG_CORPUS_VAR} to the org's docs/adr as an "
                          "absolute path, or unset it.")
    if not Path(org).is_dir():
        raise Unavailable(f"{ORG_CORPUS_VAR} names {org}, which is not a directory, so the org's decisions cannot "
                          f"be checked. Next step: point {ORG_CORPUS_VAR} at the org's docs/adr, or unset it.")
    if Path(org).resolve() not in {(Path(root) / path).resolve() for _, path in corpora}:
        corpora.append((f"org ({org})", Path(org)))
    return corpora


def _report(root: str, label: str, args: list[str], deadline: float) -> dict:
    """adr's JSON report. Exit 1 is a report with an error finding in it, complete like one with none."""
    what = f"adr {args[1]} of the {label} decisions"
    try:
        done = subprocess.run(args, cwd=root, capture_output=True, text=True,
                              timeout=max(deadline - time.monotonic(), 0))
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise Unavailable(f"{what} failed: {exc}. Next step: fix it and launch again.") from exc
    if done.returncode not in (0, 1):
        raise Unavailable(f"{what} exited {done.returncode}: {done.stderr.strip()}. Next step: fix it and launch again.")
    try:
        report = json.loads(done.stdout)
    except json.JSONDecodeError as exc:
        raise Unavailable(f"{what} printed no JSON report ({exc}). Next step: fix it and launch again.") from exc
    if not isinstance(report, dict):
        raise Unavailable(f"{what} printed a report that is not an object. Next step: {INSTALL}, then launch again.")
    return report


def _entries(report: dict, key: str, fields: tuple[str, ...], what: str) -> list[dict]:
    """`report[key]`, each entry holding a string at every one of `fields`; Unavailable for any other shape, which
    is an adrkit this module was not written against."""
    entries = report.get(key)
    if not (isinstance(entries, list)
            and all(isinstance(e, dict) and all(isinstance(e.get(f), str) for f in fields) for e in entries)):
        raise Unavailable(f"{what} reported `{key}` in a shape this plugin does not read. Next step: {INSTALL}, "
                          "then launch again.")
    return entries


def _record(root: str, label: str, corpus: Path, record_id: str) -> str:
    found = sorted((Path(root) / corpus).glob(f"{record_id}-*.md"))
    if len(found) != 1:
        raise Unavailable(f"adr check named decision {record_id} of the {label} decisions, and {corpus} holds "
                          f"{len(found)} files for it. Next step: give each record one file, <id>-<slug>.md.")
    return str(found[0])


def governing(root: str, files: list[str], org: str | None, cli: str | None, deadline: float) -> Governance:
    """The accepted decisions of every corpus that govern `files` (paths from `root`), every adr call ending by
    `deadline`, a `time.monotonic()`."""
    notices = () if org is not None else (
        f"{ORG_CORPUS_VAR} is not set, so the org's decisions were not checked.",)
    corpora = _corpora(root, org)
    if corpora and cli is None:
        raise Unavailable(f"Decisions in {', '.join(label for label, _ in corpora)} cannot be checked without "
                          f"adrkit's CLI `adr`. Next step: {INSTALL}, then launch again.")
    decisions, errors = [], []
    for label, corpus in corpora:
        linted = _report(root, label, [cli, "lint", "--dir", str(corpus), "--json"], deadline)
        errors += [f"{f['path']}: {f['message']} ({f['rule']})"
                   for f in _entries(linted, "findings", ("path", "message", "rule", "severity"), f"adr lint of {label}")
                   if f["severity"] == "error"]
        checked = _report(root, label, [cli, "check", *files, "--dir", str(corpus), "--json"], deadline)
        decisions += [Decision(label, d["recordId"], d["title"], _record(root, label, corpus, d["recordId"]))
                      for d in _entries(checked, "governing", ("recordId", "title"), f"adr check of {label}")]
    return Governance(tuple(decisions), tuple(errors), notices)
