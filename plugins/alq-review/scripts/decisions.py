"""The decision check's rules: what adrkit's answer for one corpus means for a round, the round's `decisions` block, and
the refusal texts. Pure: adrkit.py makes the calls, the gate refuses.

adrkit decides what a record is, its status, what governs a change and whether a changed record is broken. This module
only sorts its findings, by the rule names of the one adrkit version the plugin is built for (adrkit.VERSION): adrkit
exports no list of them.
"""
from __future__ import annotations

from dataclasses import dataclass

NOTICE_RULES = ("affects-unresolvable", "affects-repo-not-applicable")   # inert in a one-repo check
CAPPED_RULES = ("marker-scan-capped", "marker-declarations-capped")
COULD_NOT_RUN, TOO_BIG = "could not run", "too big"
FAILED = "The decision check failed, not the change"


@dataclass(frozen=True)
class Corpus:
    """A folder of decision records. `path` is its realpath, which is its identity."""
    label: str
    path: str
    org: bool


@dataclass(frozen=True)
class Finding:
    rule: str
    severity: str
    message: str
    id: str | None = None
    path: str | None = None
    field: str | None = None
    pattern: str | None = None


@dataclass(frozen=True)
class Answer:
    """`adr check --json`, read: `governing` holds (id, title) pairs."""
    ok: bool
    governing: tuple[tuple[str, str], ...]
    findings: tuple[Finding, ...]


@dataclass(frozen=True)
class Judged:
    corpus: Corpus
    governing: tuple[dict, ...]
    notices: tuple[dict, ...]
    broken: tuple[dict, ...]


@dataclass(frozen=True)
class NotChecked:
    """`reason` ends with the next step."""
    corpus: Corpus
    cause: str
    reason: str


Outcome = Judged | NotChecked


def judge(corpus: Corpus, answer: Answer) -> Outcome:
    capped = [f for f in answer.findings if f.rule in CAPPED_RULES]
    if capped:
        said = "; ".join(f"{f.message} ({f.rule})" for f in capped)
        return NotChecked(corpus, COULD_NOT_RUN, f"adrkit capped its marker scan of {corpus.label}: {said}. "
                                                 "Next step: split the change.")
    # adrkit fails a check only on a changed record's error, so with `ok` every error is about some other file.
    broken = tuple(_broken(corpus, f) for f in answer.findings if not answer.ok and f.severity == "error")
    unbriefed = {b["id"] for b in broken if "id" in b}
    return Judged(corpus,
                  tuple({"corpus": corpus.label, "id": i, "title": t} for i, t in answer.governing if i not in unbriefed),
                  tuple({"corpus": corpus.label, "id": f.id, "matcher": f'{f.field} "{f.pattern}"', "reason": f.message}
                        for f in answer.findings if f.rule in NOTICE_RULES),
                  broken)


def _broken(corpus: Corpus, finding: Finding) -> dict:
    named = {"corpus": corpus.label, "file": finding.path}
    if finding.id is not None:
        named["id"] = finding.id
    return {**named, "rule": finding.rule, "message": finding.message}


def timed_out(corpus: Corpus, deadline_seconds: float, spent: dict[str, float]) -> NotChecked:
    """`spent`: the seconds each step of the launch took, in the order they ran."""
    steps = ", ".join(f"{step} {seconds:.1f} s" for step, seconds in spent.items())
    slowest = max(spent, key=spent.get)
    return NotChecked(corpus, COULD_NOT_RUN,
                      f"adr check of {corpus.label} did not end by the launch's deadline, {deadline_seconds:.0f} s "
                      f"after the hook started. Seconds each step spent: {steps}. Next step: {slowest} spent the "
                      "most; launch again once it is faster.")


def too_big(count: int, limit: int, scope: str) -> str:
    step = "commit in smaller steps and launch after each" if scope == "delta" else "split the PR"
    return (f"{FAILED}: this round reviews {count} files and max_review_files is {limit}, so no decision was checked. "
            f"Next step: {step}.")


def result(outcomes: list[Outcome], org_corpus: str) -> dict:
    """The round's `decisions` block (data-model § Round arguments and result)."""
    judged = [o for o in outcomes if isinstance(o, Judged)]
    return {"corpora": [o.corpus.label for o in judged],
            "governing": [g for o in judged for g in o.governing],
            "notices": [n for o in judged for n in o.notices],
            "broken": [b for o in judged for b in o.broken],
            "not_checked": [{"corpus": o.corpus.label, "cause": o.cause, "reason": o.reason}
                            for o in outcomes if isinstance(o, NotChecked)],
            "org_corpus": org_corpus}


def not_checked_refusal(outcomes: list[Outcome]) -> str | None:
    unrun = [o for o in outcomes if isinstance(o, NotChecked) and o.cause == COULD_NOT_RUN]
    if not unrun:
        return None
    return (f"{FAILED}: the decision check could not run, so no round was opened.\n"
            + "\n".join(f"- {o.corpus.label}: {o.reason}" for o in unrun))


def broken_refusal(outcomes: list[Outcome]) -> str | None:
    lines = [f"- {_named(o.corpus, b)}: {b['message']} ({b['rule']}). Next step: {_fix(o.corpus)}."
             for o in outcomes if isinstance(o, Judged) for b in o.broken]
    if not lines:
        return None
    return f"{FAILED}: adrkit fails on decision records this change touches.\n" + "\n".join(lines)


def _named(corpus: Corpus, broken: dict) -> str:
    return f"{corpus.label} {broken['file']}" + (f" (id {broken['id']})" if "id" in broken else "")


def _fix(corpus: Corpus) -> str:
    if corpus.org:
        return f"correct the record in the org corpus, {corpus.path}, then launch again"
    return "correct the record in this repo, commit and launch again"
