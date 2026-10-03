"""The claim check's rules: what a reader and a judge must say, when a check is complete, when a commit may land,
and how often one hunk may be refused before the user decides. No I/O: git and the ledger reach these functions as
arguments, the way `policy.py` takes a ledger the gate has already read; a function that updates a check or its
holds changes the argument in place.

A check is one staged tree's record (see specs/005-claim-check-gate/data-model.md): its hunks, the reader's label
and claims per hunk, and a verdict per judged claim.
"""
from __future__ import annotations

import hashlib
import re
from typing import Callable
from urllib.parse import urlsplit

from policy import Decision

CATEGORIES = tuple(f"K{i}" for i in range(1, 9))
JUDGED = "K1"  # what the repo's own code, contracts, validator or CI does (spec FR-005)
VERDICTS = ("CORRECT", "WRONG", "UNSURE")
KINDS = ("CODE", "PROSE", "MIXED")
REFUSALS_BEFORE_USER = 3
CALL = "Workflow(name='alq-review:claim-check', args={worktree: '%s'})"
# A claim with one of these words is about cases no cited file can close, so its CORRECT is never reused.
_UNIVERSAL = re.compile(r"\b(every|only|all|exactly|always|never)\b", re.I)
_CHECK_REF = re.compile(r"(?P<repo>[\w.-]+/[\w.-]+)#tree:(?P<tree>[0-9a-f]{40}|[0-9a-f]{64})")
_CITATION = re.compile(r"(?<![\w/.:-])(?P<path>[\w./-]+):(?P<line>\d+)\b")
_URL = re.compile(r"https://[^\s<>\"'`)\]]+")
_COMMENT_MARK = re.compile(r"^\s*(?:#+|//+|/\*+|\*+/?|--|>|;+|<!--)\s?")

Located = Callable[[str], "int | None"]  # path -> its line count in the checked tree, None when it is not there


def plain(text: str) -> str:
    """The words of a text: comment markers at line starts and every run of whitespace reduced to one space."""
    return " ".join(" ".join(_COMMENT_MARK.sub("", line) for line in text.split("\n")).split())


def claim_id(file: str, quote: str) -> str:
    return hashlib.sha256(f"{file}\0{plain(quote)}".encode()).hexdigest()[:16]


def check_ref(repo: str, tree: str) -> str:
    return f"{repo}#tree:{tree}"


def parse_check_ref(ref) -> tuple[str, str] | None:
    found = _CHECK_REF.fullmatch(ref) if isinstance(ref, str) else None
    return (found["repo"], found["tree"]) if found else None


def paragraph(lines: list[str], hunk: dict) -> tuple[int, int]:
    """The 1-based line range of the text a hunk sits in: its new lines, or the line before what it removed, widened
    to the blank lines around them. A removal is judged by the paragraph it leaves behind (spec US1-5)."""
    first = max(1, min(hunk["new_start"], len(lines)))
    last = max(first, min(hunk["new_start"] + max(hunk["new_count"], 1) - 1, len(lines)))
    while first > 1 and lines[first - 2].strip():
        first -= 1
    while last < len(lines) and lines[last].strip():
        last += 1
    return first, last


def citations(text: str, located: Located) -> tuple[list[str], list[str]]:
    """The `path:line` citations in `text` that name a line of the checked tree, and those that do not."""
    good, bad = [], []
    for found in _CITATION.finditer(_URL.sub(" ", text or "")):
        path = found["path"].removeprefix("./")
        size = located(path)
        if size is not None and 1 <= int(found["line"]) <= size:
            good.append(f"{path}:{found['line']}")
        elif size is not None or "/" in path or "." in path:  # "1:2" or "step:3" is not a citation
            bad.append(found.group(0))
    return good, bad


# --- what an agent must say -----------------------------------------------------------------------

def span(hunk: dict, lines: list[str]) -> dict:
    """What the reader rules need of a hunk: its file's staged lines and the range a claim in it must sit in."""
    first, last = paragraph(lines, hunk)
    return {"id": hunk["id"], "file": hunk["file"], "lines": lines, "first": first, "last": last}


def validate_reader(output: dict, batch: list[dict]) -> list[str]:
    """Reasons a reader's labels and claims for one batch of hunks, each given as its `span`, are not accepted."""
    errors = []
    by_id = {h["id"]: h for h in batch}
    seen = [h["id"] for h in output["hunks"]]
    missing, extra = sorted(set(by_id) - set(seen)), sorted(set(seen) - set(by_id))
    if missing or extra or len(seen) != len(set(seen)):
        errors.append(f"label every hunk of your batch exactly once: expected {sorted(by_id)}, got {seen}")
    for entry in output["hunks"]:
        hunk = by_id.get(entry["id"])
        if hunk is None:
            continue
        if entry["kind"] not in KINDS:
            errors.append(f"{entry['id']}: kind must be one of {list(KINDS)}")
        if entry["kind"] == "CODE" and entry["claims"]:
            errors.append(f"{entry['id']}: a CODE hunk states no claim; label it MIXED if it holds prose")
        lines, first, last = hunk["lines"], hunk["first"], hunk["last"]
        for claim in entry["claims"]:
            where = f"{hunk['file']}:{claim['line']}"
            if claim["category"] not in CATEGORIES:
                errors.append(f"{where}: category must be one of {list(CATEGORIES)}")
            words = plain(claim["quote"])
            if not words:
                errors.append(f"{where}: the quote is empty")
            elif not first <= claim["line"] <= last:
                errors.append(f"{where}: the claim must sit in the text around {entry['id']}, lines {first}-{last}")
            elif (words not in plain("\n".join(lines[claim["line"] - 1:last]))
                  or words.split()[0] not in plain(lines[claim["line"] - 1])):
                errors.append(f"{where}: the quote is not the staged text starting on that line; copy the words exactly")
    return errors


def validate_verdict(output: dict, located: Located, *, contest: bool) -> list[str]:
    """Reasons a judge's verdict is not accepted. Evidence is a `path:line` of the checked tree; a contest judge may
    also cite an https:// page it read."""
    errors = []
    assertions = output["assertions"]
    if not assertions:
        errors.append("split the claim into its assertions; there must be at least one")

    def supported(evidence: str) -> bool:
        return bool(citations(evidence, located)[0] or (contest and _URL.search(evidence or "")))

    for entry in assertions:
        bad = citations(entry["evidence"], located)[1]
        if bad:
            errors.append(f"{', '.join(bad)} is not a line of a file in the staged tree; cite only what will be committed")
        if not contest and _URL.search(entry["evidence"] or ""):
            errors.append("a web page is not evidence here; cite the file and line of the staged tree that settles it")
    kind = output["verdict"]
    # In an UNSURE verdict an unconfirmed assertion is the open question, so it has nothing to cite.
    if not all(supported(e["evidence"]) for e in assertions if e["confirmed"] or kind != "UNSURE"):
        errors.append("every assertion you settled needs the path:line that settles it; a conclusion drawn from "
                      "another assertion is not one, so leave it out")
    if kind == "CORRECT" and not all(e["confirmed"] for e in assertions):
        errors.append("CORRECT needs every assertion confirmed")
    if kind == "WRONG":
        if not (output.get("failing_case") or "").strip():
            errors.append("WRONG needs failing_case: the input or situation in which the claim is false")
        if not any(not e["confirmed"] and supported(e["evidence"]) for e in assertions):
            errors.append("WRONG needs an assertion that is not confirmed, with the path:line that breaks it")
    if kind == "UNSURE" and not (output.get("gap") or "").strip():
        errors.append("UNSURE needs gap: what you could not find or read")
    return errors


def cited_paths(verdict: dict, located: Located) -> set[str]:
    return {c.rsplit(":", 1)[0] for e in verdict["assertions"] for c in citations(e["evidence"], located)[0]}


# --- a check's progress -----------------------------------------------------------------------------

def add_read(check: dict, hunk: dict, kind: str, claims: list[dict]) -> None:
    """Record a hunk's label and claims; `claims` carry `line` in the checked tree's numbering."""
    check["labels"][hunk["id"]] = kind
    for claim in claims:
        cid = claim_id(hunk["file"], claim["quote"])
        check["claims"][cid] = {"id": cid, "hunk": hunk["id"], "file": hunk["file"], "line": claim["line"],
                                "quote": claim["quote"], "category": claim["category"]}


def to_judge(check: dict) -> list[dict]:
    return [c for c in check["claims"].values() if c["category"] == JUDGED and c["id"] not in check["verdicts"]]


def not_judged(check: dict) -> dict[str, int]:
    counts: dict[str, int] = {}
    for claim in check["claims"].values():
        if claim["category"] != JUDGED:
            counts[claim["category"]] = counts.get(claim["category"], 0) + 1
    return counts


def settle(check: dict) -> dict:
    """Set the check's status from what it holds. A check whose verdicts are all UNSURE is complete: its claims
    are notes (FR-015)."""
    hunk_ids = {h["id"] for h in check["hunks"]}
    if not hunk_ids <= set(check["labels"]):
        check["status"] = "reading"
    elif to_judge(check):
        check["status"] = "judging"
    else:
        check["status"] = "complete"
    return check


def wrong_claims(check: dict, released: set[str] = frozenset()) -> list[dict]:
    return [check["claims"][cid] for cid, v in check["verdicts"].items()
            if v["verdict"] == "WRONG" and check["claims"][cid]["hunk"] not in released]


# --- the commit ----------------------------------------------------------------------------------

def _old_side(hold: dict) -> str:
    if hold["old_count"]:
        return f"old lines {hold['old_start']}-{hold['old_start'] + hold['old_count'] - 1}"
    return "new file" if hold["old_start"] == 0 else f"added after old line {hold['old_start']}"


def user_question(held: list[dict]) -> str:
    claims = sorted({cid for hold in held for cid in hold["claims"]})
    places = ", ".join(f"{h['file']} ({_old_side(h)})" for h in held)
    return (f"These claims were refused {REFUSALS_BEFORE_USER} times in {places}, and an agent may not try again. "
            "Stop and ask the user: is the claim wrong, or is the checker? Show them each claim and its last verdict. "
            f"Only the user releases it, by typing {' or '.join(f'`unlock claim-{c}`' for c in claims)}.")


def _wrong_report(check: dict, claims: list[dict]) -> str:
    lines = []
    for claim in claims:
        verdict = check["verdicts"][claim["id"]]
        broken = next((e for e in verdict["assertions"] if not e["confirmed"]), verdict["assertions"][0])
        lines.append(f"- {claim['file']}:{claim['line']} \"{claim['quote']}\" (claim-{claim['id']}). Fails when: "
                     f"{verdict['failing_case']}. Evidence: {broken['evidence']}")
    return "\n".join(lines)


def commit_preconditions(*, empty: bool, concluding: bool, staging: bool, alone: bool) -> Decision | None:
    """What every commit check decides before reading its own record; None when that record decides. Shared, so a
    check whose sibling only logs still refuses a commit that could change what is staged."""
    if empty or concluding:
        return Decision(True)
    if staging or not alone:
        return Decision(False, "A commit is checked as the exact staged tree, and this command could change what is "
                               "staged. Stage with `git add` in an earlier command, then run `git commit` alone (only "
                               "`cd` may come before it).")
    return None


def commit_decision(check: dict | None, *, empty: bool, concluding: bool, staging: bool, alone: bool,
                    held: list[dict], released: set[str], root: str) -> Decision:
    settled = commit_preconditions(empty=empty, concluding=concluding, staging=staging, alone=alone)
    if settled is not None:
        return settled
    if held:
        return Decision(False, user_question(held))
    call = CALL % root
    if check is None:
        return Decision(False, f"The staged change has not been claim-checked. Next step: {call}, then commit again.")
    if check["status"] != "complete":
        return Decision(False, f"The claim check of this staged tree is {check['status']}: a checker did not report, "
                               f"not that a claim is wrong. Next step: {call}.")
    wrong = wrong_claims(check, released)
    if wrong:
        return Decision(False, "The claim check ruled these claims WRONG:\n" + _wrong_report(check, wrong) +
                        "\nNext step: fix the claim or the code, stage it and run the check again; or contest a verdict "
                        f"with evidence: Workflow(name='alq-review:claim-check', args={{worktree: '{root}', contests: "
                        "[{claim: '<id>', evidence: '<path:line or https:// URL>'}]}).")
    return Decision(True)


# --- the bound on refusals, per git hunk ------------------------------------------------------------

def _old_range(item: dict) -> tuple[int, int]:
    return item["old_start"], item["old_start"] + max(item["old_count"], 1) - 1


def touches(hold: dict, hunk: dict) -> bool:
    """Whether two old-side ranges of one file overlap or are adjacent, a pure insertion counting as the line it follows;
    the caller passes both in the numbering of one base."""
    (a, b), (c, d) = _old_range(hold), _old_range(hunk)
    return hold["file"] == hunk["file"] and a <= d + 1 and c <= b + 1


def find_hold(holds: list[dict], hunk: dict) -> dict | None:
    return next((h for h in holds if touches(h, hunk)), None)


def hunk_state(holds: list[dict], hunk: dict) -> str:
    """open: the check may run and refuse; held: only the user can release it; released: the user let these words
    stand, so their WRONG verdicts do not refuse."""
    hold = find_hold(holds, hunk)
    if hold is None:
        return "open"
    if hold["released_patch_id"]:
        return "released" if hold["released_patch_id"] == hunk["patch_id"] else "open"
    return "held" if hold["refusals"] >= REFUSALS_BEFORE_USER else "open"


def _refuse_hunk(holds: list[dict], hunk: dict, claim_ids: list[str]) -> list[dict]:
    hold = find_hold(holds, hunk)
    if hold is None:
        hold = {"file": hunk["file"], "old_start": hunk["old_start"], "old_count": hunk["old_count"], "refusals": 0,
                "claims": [], "patch_id": hunk["patch_id"], "released_patch_id": None}
        holds = holds + [hold]
    elif hold["released_patch_id"] == hunk["patch_id"]:
        return holds
    elif hold["released_patch_id"]:
        hold.update(refusals=0, released_patch_id=None)
    (a, b), (c, d) = _old_range(hold), _old_range(hunk)
    start, end = min(a, c), max(b, d)
    hold.update(old_start=start, old_count=end - start + 1 if hold["old_count"] or hunk["old_count"] else 0,
                refusals=hold["refusals"] + 1, claims=sorted(claim_ids), patch_id=hunk["patch_id"])
    return holds


def count_refusals(holds: list[dict], check: dict) -> list[dict]:
    """One refusal per hunk for a completed check that ruled any claim in it WRONG (spec FR-017)."""
    by_hunk: dict[str, list[str]] = {}
    for claim in wrong_claims(check):
        by_hunk.setdefault(claim["hunk"], []).append(claim["id"])
    for hunk in check["hunks"]:
        if hunk["id"] in by_hunk:
            holds = _refuse_hunk(holds, hunk, by_hunk[hunk["id"]])
    return holds


def standing(holds: list[dict], hunks: list[dict]) -> tuple[list[dict], set[str]]:
    """The holds that stop these hunks until the user answers, and the ids of the hunks the user released."""
    held, released = [], set()
    for hunk in hunks:
        state = hunk_state(holds, hunk)
        if state == "held":
            hold = find_hold(holds, hunk)
            if hold not in held:
                held.append(hold)
        elif state == "released":
            released.add(hunk["id"])
    return held, released


def release(hold: dict) -> None:
    hold["released_patch_id"] = hold["patch_id"]


# --- contests ------------------------------------------------------------------------------------

def accept_contest(contest: dict, check: dict | None, located: Located) -> list[str]:
    cid = contest.get("claim")
    verdict = (check or {}).get("verdicts", {}).get(cid)
    if verdict is None or verdict["verdict"] != "WRONG":
        return [f"claim {cid!r} has no WRONG verdict in the check of this staged tree to contest"]
    evidence = contest.get("evidence") or ""
    if not (citations(evidence, located)[0] or _URL.search(evidence)):
        return [f"the contest of claim-{cid} gives no evidence the checker can verify: add a path:line of the staged "
                "tree or an https:// page that shows the claim holds"]
    return []


def cited_hosts(contests: list[dict]) -> list[str]:
    return sorted({urlsplit(url).hostname for c in contests for url in _URL.findall(c.get("evidence") or "")} - {None})


def fetch_allowed(url: str, hosts: list[str]) -> bool:
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return parts.scheme == "https" and parts.hostname in hosts


def contest_outcome(check: dict, holds: list[dict], cid: str, verdict: dict) -> str:
    """A fresh judge's ruling on a contested claim: upheld replaces the WRONG; rejected is one more refusal of its
    hunk (critique P2). `holds` are the holds of every file in the check, changed in place."""
    claim = check["claims"][cid]
    if verdict["verdict"] == "WRONG":
        hunk = next(h for h in check["hunks"] if h["id"] == claim["hunk"])
        holds[:] = _refuse_hunk(holds, hunk, [cid])
        outcome = "rejected"
    else:
        check["verdicts"][cid] = verdict
        outcome = "upheld"
    check.setdefault("contests", {})[cid] = outcome
    return outcome


# --- reuse of CORRECT -----------------------------------------------------------------------------

def cacheable(claim: dict, verdict: dict) -> bool:
    return verdict["verdict"] == "CORRECT" and not _UNIVERSAL.search(claim["quote"])


def still_correct(entry: dict, blob_of: Callable[[str], "str | None"]) -> bool:
    """A cached CORRECT stands while every file it cited has the same blob in the checked tree."""
    return bool(entry["evidence_blobs"]) and all(blob_of(p) == b for p, b in entry["evidence_blobs"].items())
