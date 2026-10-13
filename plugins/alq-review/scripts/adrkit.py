"""adrkit's CLI, `adr`: the corpora a checkout is checked against, and one outcome per corpus from `adr check`.

Every call to `adr` is made here, and its answer is read here: one this module cannot read is a corpus that could not
be checked, never a pass. No call raises for a corpus, so one that could not be checked hides nothing the others said.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import worktree
from decisions import COULD_NOT_RUN, NOTICE_RULES, Answer, Corpus, Finding, NotChecked, Outcome, judge, timed_out

VERSION = "0.20.0"
INSTALL = f"npm install -g @adrkit/cli@{VERSION}"
ORG_CORPUS_VAR = "ALQ_ORG_ADR_DIR"


@dataclass(frozen=True)
class Deadline:
    """`ends`, a `time.monotonic()`, is `seconds` after the hook started."""
    ends: float
    seconds: float


@dataclass(frozen=True)
class Corpora:
    corpora: list[Corpus]
    not_checked: list[NotChecked]
    org_corpus: str   # its label, or "unset"


def corpora(root: str) -> Corpora:
    """Every tracked `docs/adr` of the checkout at `root`, and the org corpus `ALQ_ORG_ADR_DIR` names. A folder reached
    both ways is one corpus, the org's."""
    found = {}
    for folder in worktree.decision_folders(root):
        path = os.path.realpath(os.path.join(root, folder))
        found[path] = Corpus(folder, path, org=False)
    value = os.environ.get(ORG_CORPUS_VAR) or ""
    if not value:
        return Corpora(list(found.values()), [], "unset")
    label = f"org ({value})"
    if not (os.path.isabs(value) and os.path.isdir(value) and os.access(value, os.R_OK | os.X_OK)):
        unreadable = NotChecked(Corpus(label, value, org=True), COULD_NOT_RUN,
                                f"{ORG_CORPUS_VAR} is {value}, which is not an absolute path to a readable folder, so "
                                "the org corpus could not be checked. Next step: point it at the org corpus, or unset it.")
        return Corpora(list(found.values()), [unreadable], label)
    path = os.path.realpath(value)
    found[path] = Corpus(label, path, org=True)
    return Corpora(list(found.values()), [], label)


def check(root: str, corpora: list[Corpus], files: list[str], deadline: Deadline,
          spent: dict[str, float]) -> list[Outcome]:
    """One outcome per corpus for `files`, paths from `root`, every call ending by `deadline`. `spent`: the seconds
    the launch's earlier steps took, named in a timeout's reason."""
    if not corpora:
        return []
    adr = shutil.which("adr")
    if adr is None:
        return [NotChecked(c, COULD_NOT_RUN, f"The adr command was not found, so {c.label} could not be checked. "
                                             f"Next step: {INSTALL} (node 22 or later), then launch again.")
                for c in corpora]
    # adrkit 0.20.0 misses a changed record unless its folder is given relative to the folder it runs in.
    cwd = os.path.realpath(root)
    steps = dict(spent)
    try:
        version, steps["adr --version"] = _run([adr, "--version"], cwd, deadline)
    except OSError as exc:
        return [NotChecked(c, COULD_NOT_RUN, f"adr could not be started ({exc}), so {c.label} could not be checked. "
                                             f"Next step: {INSTALL}, then launch again.") for c in corpora]
    if version is None:
        return [timed_out(c, deadline.seconds, steps) for c in corpora]
    said = version.stdout.strip()
    if version.returncode != 0 or said != VERSION:
        return [NotChecked(c, COULD_NOT_RUN, f"`adr --version` answered {said or version.stderr.strip()!r}, and this "
                                             f"plugin is built for adrkit {VERSION}, so {c.label} could not be "
                                             f"checked. Next step: {INSTALL}, then launch again.") for c in corpora]

    def ask(corpus: Corpus):
        folder = os.path.relpath(corpus.path, cwd) if Path(corpus.path).is_relative_to(cwd) else corpus.path
        try:
            return _run([adr, "check", "--dir", folder, "--json", "--", *files], cwd, deadline)
        except OSError as exc:
            return exc, 0.0

    with ThreadPoolExecutor(max_workers=len(corpora)) as pool:
        answers = list(pool.map(ask, corpora))
    for corpus, (_, seconds) in zip(corpora, answers):
        steps[f"adr check of {corpus.label}"] = seconds
    return [_outcome(corpus, done, deadline, steps) for corpus, (done, _) in zip(corpora, answers)]


def _run(args: list[str], cwd: str, deadline: Deadline) -> tuple[subprocess.CompletedProcess | None, float]:
    """(what the call did, None when it reached the deadline; the seconds it took)."""
    started = time.monotonic()
    try:
        done = subprocess.run(args, cwd=cwd, capture_output=True, text=True,
                              timeout=max(deadline.ends - started, 0))
    except subprocess.TimeoutExpired:
        done = None
    return done, time.monotonic() - started


def _outcome(corpus: Corpus, done, deadline: Deadline, steps: dict[str, float]) -> Outcome:
    if done is None:
        return timed_out(corpus, deadline.seconds, steps)
    if isinstance(done, OSError):
        return NotChecked(corpus, COULD_NOT_RUN, f"adr check of {corpus.label} could not be started ({done}). Next "
                                                 f"step: {INSTALL}, then launch again.")
    # Exit 1 is either a check that failed on a changed record, answered on stdout like exit 0, or adrkit's own
    # failure, answered on stderr alone: only the answer tells them apart.
    try:
        raw = json.loads(done.stdout) if done.returncode in (0, 1) else None
    except json.JSONDecodeError:
        raw = None
    if raw is None and done.returncode != 0:
        return NotChecked(corpus, COULD_NOT_RUN, f"adr check of {corpus.label} exited {done.returncode}: "
                                                 f"{done.stderr.strip()} Next step: fix what adr says, then launch again.")
    try:
        answer = parse(raw)
    except ValueError as exc:
        return NotChecked(corpus, COULD_NOT_RUN, f"adr check of {corpus.label} answered in a shape this plugin does "
                                                 f"not read ({exc}). Next step: {INSTALL}, then launch again.")
    return judge(corpus, answer)


_OPTIONAL = ("id", "path", "field", "pattern")


def parse(raw: object) -> Answer:
    """`adr check --json`'s `ok`, `governing` and `findings`; ValueError naming what is not as adrkit VERSION gives it."""
    if not isinstance(raw, dict) or not isinstance(raw.get("ok"), bool):
        raise ValueError("no boolean `ok`")
    governing, findings = raw.get("governing"), raw.get("findings")
    if not isinstance(governing, list) or not all(
            isinstance(g, dict) and isinstance(g.get("recordId"), str) and isinstance(g.get("title"), str)
            for g in governing):
        raise ValueError("`governing` is not a list of records with a recordId and a title")
    if not isinstance(findings, list):
        raise ValueError("`findings` is not a list")
    read = tuple(_finding(f) for f in findings)
    if not raw["ok"] and not any(f.severity == "error" for f in read):
        raise ValueError("the check failed with no error finding")
    return Answer(raw["ok"], tuple((g["recordId"], g["title"]) for g in governing), read)


def _finding(raw: object) -> Finding:
    if not isinstance(raw, dict) or not all(isinstance(raw.get(k), str) for k in ("rule", "severity", "message")):
        raise ValueError("a finding has no rule, severity or message")
    if not all(isinstance(raw[k], str) for k in _OPTIONAL if k in raw):
        raise ValueError(f"a {raw['rule']} finding has a field that is not text")
    found = Finding(raw["rule"], raw["severity"], raw["message"], **{k: raw.get(k) for k in _OPTIONAL})
    if found.rule in NOTICE_RULES and None in (found.id, found.field, found.pattern):
        raise ValueError(f"a {found.rule} finding does not name its record and matcher")
    if found.severity == "error" and found.path is None:
        raise ValueError(f"a {found.rule} error does not name its file")
    return found
