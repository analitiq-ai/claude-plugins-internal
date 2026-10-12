"""The accepted decisions (ADRs) that govern the files a review round reads.

adrkit's `adr check` answers per corpus and keeps ids per corpus, so each corpus is asked on its own: every `docs/adr`
the repo tracks, and the org's at $ALQ_ORG_ADR_DIR. Only accepted decisions (adrkit's `governing` bucket) bind a change,
and only an answer from a corpus adrkit evaluated in full is one: `adr check` leaves out what it could not load or
match, so a record that should govern the change would govern nothing.
"""
from __future__ import annotations

import json
import re
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

import worktree

ORG_CORPUS_VAR = "ALQ_ORG_ADR_DIR"
INSTALL = "npm install -g @adrkit/cli@0.20.0"
# adrkit's findings that mean something was not evaluated, whatever their severity. A record's own error finding is
# one too, unless the record cannot govern yet.
INCOMPLETE_RULES = ("corpus-file-skipped", "affects-bad-pattern", "affects-unknown-type", "marker-scan-capped",
                    "marker-declarations-capped")
NOT_YET_DECIDED = ("draft", "proposed")
_STATUS = re.compile(r"^status:\s*[\"']?([\w-]+)", re.M)


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
    notices: tuple[str, ...]


@dataclass(frozen=True)
class _Corpus:
    label: str
    # From the repo root for a repo corpus, as the changed files are: adrkit sees that a changed file is one of its
    # records only then.
    dir: Path
    fix: str


def _corpora(root: str, org: str | None) -> list[_Corpus]:
    """Each corpus to check; an org corpus that is also one of the repo's is the repo's."""
    tracked = sorted({str(Path(f).parent) for f in worktree.tracked(root, "*docs/adr/*")
                      if Path(f).parent.parts[-2:] == ("docs", "adr")})
    corpora = [_Corpus(label, Path(label), "fix them, commit, and launch again") for label in tracked]
    if org is None:
        return corpora
    if not Path(org).is_absolute():
        raise Unavailable(f"{ORG_CORPUS_VAR} names {org}, which is not an absolute path; the hook and adr run from "
                          f"different directories. Next step: set {ORG_CORPUS_VAR} to the org's docs/adr as an "
                          "absolute path, or unset it.")
    if not Path(org).is_dir():
        raise Unavailable(f"{ORG_CORPUS_VAR} names {org}, which is not a directory, so the org's decisions cannot "
                          f"be checked. Next step: point {ORG_CORPUS_VAR} at the org's docs/adr, or unset it.")
    if Path(org).resolve() not in {(Path(root) / c.dir).resolve() for c in corpora}:
        corpora.append(_Corpus(f"org ({org})", Path(org),
                               f"fix them in the org's decisions, or unset {ORG_CORPUS_VAR}, and launch again"))
    return corpora


def _report(root: str, what: str, args: list[str], deadline: float) -> dict:
    """adr's JSON report. Exit 1 is a report with an error finding in it, complete like one with none."""
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


def _entries(report: dict, key: str, fields: tuple[str, ...], what: str) -> list:
    """`report[key]`: a list whose every entry holds a string at each of `fields` (a list of strings for no
    fields); Unavailable for any other shape, which is an adrkit this module was not written against."""
    entries = report.get(key)
    well_formed = isinstance(entries, list) and all(
        isinstance(e, dict) and all(isinstance(e.get(f), str) for f in fields) if fields else isinstance(e, str)
        for e in entries)
    if not well_formed:
        raise Unavailable(f"{what} reported `{key}` in a shape this plugin does not read. Next step: {INSTALL}, "
                          "then launch again.")
    return entries


def _may_govern(root: str, path: str | None) -> bool:
    """Whether the record at `path` may be accepted: its status is not one that cannot govern yet, or cannot be read.
    A finding with no path is about the corpus, which holds the records that may."""
    if path is None:
        return True
    try:
        status = _STATUS.search(Path(root, path).read_text())
    except OSError:
        return True
    return status is None or status.group(1) not in NOT_YET_DECIDED


def _not_evaluated(root: str, findings: list[dict]) -> list[str]:
    return [f"{f.get('path', '(corpus)')}: {f['message']} ({f['rule']})" for f in findings
            if (f["rule"] in INCOMPLETE_RULES or f["severity"] == "error")
            and (f["rule"] == "corpus-file-skipped" or _may_govern(root, f.get("path")))]


def _record(root: str, corpus: _Corpus, record_id: str) -> str:
    found = sorted((Path(root) / corpus.dir).glob(f"{record_id}-*.md"))
    if len(found) != 1:
        raise Unavailable(f"adr check named decision {record_id} of the {corpus.label} decisions, and {corpus.dir} "
                          f"holds {len(found)} files for it. Next step: give each record one file, <id>-<slug>.md.")
    return str(found[0])


def _check(root: str, files: list[str], corpus: _Corpus, cli: str, deadline: float) -> list[Decision]:
    finding = ("rule", "severity", "message")
    lint, check = f"adr lint of the {corpus.label} decisions", f"adr check of the {corpus.label} decisions"
    linted = _report(root, lint, [cli, "lint", "--dir", str(corpus.dir), "--json"], deadline)
    checked = _report(root, check, [cli, "check", *files, "--dir", str(corpus.dir), "--json"], deadline)
    governing = _entries(checked, "governing", ("recordId", "title"), check)
    scan = checked.get("markerScan")
    if not isinstance(scan, dict):
        raise Unavailable(f"{check} reported no `markerScan`. Next step: {INSTALL}, then launch again.")
    missed = dict.fromkeys(_not_evaluated(root, _entries(linted, "findings", finding, lint))
              + _not_evaluated(root, _entries(checked, "findings", finding, check))
              + [f"{p}: could not be scanned for decision markers" for key in ("unreadablePaths", "truncatedPaths")
                 for p in _entries(scan, key, (), check)])  # lint and check both report a broken changed record
    if missed:
        raise Unavailable(f"adrkit did not evaluate every decision in {corpus.label} that could govern this change:\n"
                          + "\n".join(missed) + f"\nNext step: {corpus.fix}.")
    return [Decision(corpus.label, d["recordId"], d["title"], _record(root, corpus, d["recordId"])) for d in governing]


def governing(root: str, files: list[str], org: str | None, cli: str | None, deadline: float) -> Governance:
    """The accepted decisions of every corpus that govern `files` (paths from `root`), every adr call ending by
    `deadline`, a `time.monotonic()`."""
    notices = () if org is not None else (
        f"{ORG_CORPUS_VAR} is not set, so the org's decisions were not checked.",)
    corpora = _corpora(root, org)
    if corpora and cli is None:
        raise Unavailable(f"Decisions in {', '.join(c.label for c in corpora)} cannot be checked without adrkit's CLI "
                          f"`adr`. Next step: {INSTALL}, then launch again.")
    return Governance(tuple(d for corpus in corpora for d in _check(root, files, corpus, cli, deadline)), notices)
