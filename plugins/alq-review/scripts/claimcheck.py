"""The claim check's rules: what a reader and a judge must say, when a check is complete, when a commit may land,
and how often one claim, followed through its rewordings, may be ruled wrong before the user decides. No I/O: git and
the ledger reach these functions as arguments, the way `policy.py` takes a ledger the gate has already read; a
function that updates a check or a lineage changes the argument in place.

A check is one staged tree's record: its hunks, the reader's label and claims per hunk, and a verdict per judged
claim. A lineage is the chain of one claim's versions, with the ruling on each; where its words sit in the file is
`lineage.py`'s business.
"""
from __future__ import annotations

import hashlib
import re
from typing import Callable
from urllib.parse import urlsplit

from policy import Decision

CATEGORIES = tuple(f"K{i}" for i in range(1, 10))
# K1, what the repo's own code, contracts, validator or CI does; K9, what a test checks (engineering#57).
JUDGED = ("K1", "K9")
VERDICTS = ("CORRECT", "WRONG", "UNSURE")
KINDS = ("CODE", "PROSE", "MIXED")
REFUSALS_BEFORE_USER = 3
CALL = "Workflow(name='alq-review:claim-check', args={worktree: '%s'})"
# A claim with one of these words is about cases no cited file can close, so its CORRECT is never reused.
_UNIVERSAL = re.compile(r"\b(every|only|all|exactly|always|never)\b", re.I)
# How agents and the user name a claim; the bare hash stays inside the plugin.
CLAIM_REF = re.compile(r"claim-(?P<claim>[0-9a-f]{16})")
_CHECK_REF = re.compile(r"(?P<repo>[\w.-]+/[\w.-]+)#tree:(?P<tree>[0-9a-f]{40}|[0-9a-f]{64})")
_CITATION = re.compile(r"(?<![\w/.:-])(?P<path>[\w./-]+):(?P<line>\d+)\b")
_URL = re.compile(r"https://[^\s<>\"'`)\]]+")
_COMMENT_MARK = re.compile(r"^\s*(?:#+|//+|/\*+|\*+/?|--|>|;+|<!--)\s?")
_WORD = re.compile(r"\S+")

Located = Callable[[str], "int | None"]  # path -> its line count in the checked tree, None when it is not there


def words(text: str) -> list[tuple[str, int, int]]:
    """Each word of a text with its start and end offset, comment markers at line starts left out."""
    found, line_start = [], 0
    for line in text.split("\n"):
        mark = _COMMENT_MARK.match(line)
        found += [(m.group(), line_start + m.start(), line_start + m.end())
                  for m in _WORD.finditer(line, mark.end() if mark else 0)]
        line_start += len(line) + 1
    return found


def plain(text: str) -> str:
    """The words of a text, each run of white space and each comment marker at a line start reduced to one space."""
    return " ".join(word for word, _, _ in words(text))


def text_id(*parts: str) -> str:
    """A short id of `parts`, from their UTF-8, so text no locale's codec can spell still has one. A byte git wrote
    that the locale's codec did not decode is hashed as git wrote it."""
    return hashlib.sha256("\0".join(parts).encode("utf-8", "surrogateescape")).hexdigest()[:16]


def claim_id(file: str, quote: str) -> str:
    return text_id(file, plain(quote))


def claim_ref(cid: str) -> str:
    return f"claim-{cid}"


def parse_claim_ref(ref: object) -> str | None:
    found = CLAIM_REF.fullmatch(ref) if isinstance(ref, str) else None
    return found["claim"] if found else None


def check_ref(repo: str, tree: str) -> str:
    return f"{repo}#tree:{tree}"


def parse_check_ref(ref) -> tuple[str, str] | None:
    found = _CHECK_REF.fullmatch(ref) if isinstance(ref, str) else None
    return (found["repo"], found["tree"]) if found else None


def paragraph(lines: list[str], hunk: dict) -> tuple[int, int]:
    """The 1-based line range of the text a hunk sits in: its new lines, or the line before what it removed, widened
    to the blank lines around them. A removal is judged by the paragraph it leaves behind."""
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
    return [c for c in check["claims"].values() if c["category"] in JUDGED and c["id"] not in check["verdicts"]]


def not_judged(check: dict) -> dict[str, int]:
    counts: dict[str, int] = {}
    for claim in check["claims"].values():
        if claim["category"] not in JUDGED:
            counts[claim["category"]] = counts.get(claim["category"], 0) + 1
    return counts


def settle(check: dict) -> dict:
    """Set the check's status from what it holds. A check whose verdicts are all UNSURE is complete: its claims
    are notes."""
    hunk_ids = {h["id"] for h in check["hunks"]}
    if not hunk_ids <= set(check["labels"]):
        check["status"] = "reading"
    elif to_judge(check):
        check["status"] = "judging"
    else:
        check["status"] = "complete"
    return check


def wrong_claims(check: dict, released: set[str] = frozenset()) -> list[dict]:
    """The claims the check ruled WRONG, but those whose words the user released."""
    return [check["claims"][cid] for cid, v in check["verdicts"].items()
            if v["verdict"] == "WRONG" and cid not in released]


# --- a claim's lineage: the chain of its versions' rulings ------------------------------------------

def new_lineage(claim: dict, ref: str) -> dict:
    """The lineage `claim` opens when ruled WRONG with no lineage to join; `ref` is the check that ruled it."""
    return {"id": claim["id"], "opened": ref, "file": claim["file"], "state": "open", "ended": None, "places": [],
            "chain": [], "released": None}


def end(lineage: dict, by: str, ref: str, into: str | None = None) -> None:
    """Close a lineage, keeping it on record: `by` is `correct`, `deleted` or `merged` (into the lineage `into`)."""
    lineage.update(state="ended", ended={"by": by, "ref": ref, "into": into})


def _broken(verdict: dict) -> dict:
    return next((e for e in verdict["assertions"] if not e["confirmed"]), verdict["assertions"][0])


def enter(lineage: dict, ref: str, claim: dict, verdict: dict) -> None:
    """Add a ruling to the chain, once per `ref` and claim: the same check ruled again, or its completion step run
    again, adds nothing, while the halves of a split claim each enter theirs. A WRONG ruling on words the user released
    is entered as released, so it counts nothing. A CORRECT ruling takes its words out of the lineage, and with none
    left the lineage ends."""
    if any(item["ref"] == ref and item["claim"] == claim["id"] for item in lineage["chain"]):
        return
    wrong = verdict["verdict"] == "WRONG"
    released = lineage["released"]
    item = {"ref": ref, "claim": claim["id"], "line": claim["line"], "words": claim["quote"],
            "ruling": verdict["verdict"], "released": wrong and bool(released) and claim["id"] in released["claims"]}
    if wrong:
        item.update(failing_case=verdict["failing_case"], evidence=_broken(verdict)["evidence"])
    lineage["chain"].append(item)
    if verdict["verdict"] == "CORRECT":
        lineage["places"] = [place for place in lineage["places"] if place["claim"] != claim["id"]]
        if not lineage["places"]:
            end(lineage, "correct", ref)


def count(lineage: dict) -> int:
    """The checks that ruled a version of the claim WRONG, a check counting once."""
    return len({item["ref"] for item in lineage["chain"] if item["ruling"] == "WRONG" and not item["released"]})


def held(lineage: dict) -> bool:
    """Only the user's release lowers the bar: after it, the count must pass the count it had then."""
    floor = lineage["released"]["count"] if lineage["released"] else 0
    return lineage["state"] == "open" and REFUSALS_BEFORE_USER <= count(lineage) and floor < count(lineage)


def keep_holds(before: list[dict], after: list[dict]) -> None:
    """A hold the user has not released survives a merge: the lineage that goes on, whatever its own release, is held
    again when any lineage it absorbed was held."""
    was_held = {item["id"] for item in before if held(item)}
    goes_on = {item["id"]: item for item in after}
    for item in after:
        if item["state"] == "ended" and item["ended"]["by"] == "merged" and item["id"] in was_held:
            goes_on[item["ended"]["into"]]["released"] = None


def release(lineage: dict, at: str) -> None:
    """The user let the words the lineage holds now stand; its chain and count stay."""
    lineage["released"] = {"count": count(lineage), "claims": sorted({p["claim"] for p in lineage["places"]}), "at": at}


# --- the commit ----------------------------------------------------------------------------------

def _named(claim: dict) -> str:
    return f"{claim['file']}:{claim['line']} \"{claim['quote']}\" ({claim_ref(claim['id'])})"


def _version(file: str, item: dict) -> str:
    return f"- {file}:{item['line']} \"{item['words']}\" - {item['ruling']} ({item['ref']})"


def _chain_text(lineage: dict) -> str:
    last = next(item for item in reversed(lineage["chain"]) if item["ruling"] == "WRONG")
    versions = "\n".join(_version(lineage["file"], item) for item in lineage["chain"])
    return (f"ruled WRONG {count(lineage)} times, version by version:\n{versions}\n"
            f"Fails when: {last['failing_case']}. Evidence: {last['evidence']}. "
            f"Release: `unlock {claim_ref(lineage['id'])}`")


def user_question(held_lineages: list[dict]) -> str:
    chains = "\n".join(_chain_text(item) for item in held_lineages)
    return ("Do not try these claims again. Stop and ask the user: is the claim wrong, or is the checker? "
            "Show them each claim's chain, with the case it last failed in and the evidence:\n"
            f"{chains}\nReleasing a claim is the user's call: they type its `unlock` line.")


def _wrong_report(check: dict, claims: list[dict]) -> str:
    def line(claim: dict) -> str:
        verdict = check["verdicts"][claim["id"]]
        return f"- {_named(claim)}. Fails when: {verdict['failing_case']}. Evidence: {_broken(verdict)['evidence']}"
    return "\n".join(line(claim) for claim in claims)


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
                        "[{claim: 'claim-<id>', evidence: '<path:line or https:// URL>'}]}).")
    return Decision(True)


# --- contests ------------------------------------------------------------------------------------

def accept_contest(contest: dict, check: dict, located: Located) -> tuple[str | None, list[str]]:
    """The id of the claim `contest` names, or why the completed `check` can't take the contest."""
    cid = parse_claim_ref(contest.get("claim"))
    if cid not in check["claims"]:
        wrong = ", ".join(_named(c) for c in wrong_claims(check)) or "none"
        return None, [f"{contest.get('claim')!r} is not a claim id of this check; its WRONG claims: {wrong}"]
    verdict = check["verdicts"].get(cid)
    if verdict is None:
        return None, [f"{claim_ref(cid)} was not judged, so it has no WRONG verdict to contest"]
    if verdict["verdict"] != "WRONG":
        return None, [f"{claim_ref(cid)} is {verdict['verdict']}, not WRONG"]
    evidence = contest.get("evidence") or ""
    if not (citations(evidence, located)[0] or _URL.search(evidence)):
        return None, [f"the contest of {claim_ref(cid)} gives no evidence the checker can verify: add a path:line of "
                      "the staged tree or an https:// page that shows the claim holds"]
    return cid, []


def cited_hosts(contests: list[dict]) -> list[str]:
    return sorted({urlsplit(url).hostname for c in contests for url in _URL.findall(c.get("evidence") or "")} - {None})


def fetch_allowed(url: str, hosts: list[str]) -> bool:
    try:
        parts = urlsplit(url)
    except ValueError:
        return False
    return parts.scheme == "https" and parts.hostname in hosts


def contest_outcome(check: dict, lineage: dict, cid: str, verdict: dict) -> str:
    """A fresh judge's ruling on a contested claim replaces its verdict and enters the claim's chain under a ref of
    its own: a rejected contest is one more WRONG, an upheld one lowers nothing (only the user's release does) and, when it
    finds the claim CORRECT, ends the lineage like any CORRECT ruling."""
    check["verdicts"][cid] = verdict
    prefix = f"{check['ref']}/contest-"
    nth = 1 + sum(1 for item in lineage["chain"] if item["claim"] == cid and item["ref"].startswith(prefix))
    enter(lineage, f"{prefix}{nth}", check["claims"][cid], verdict)
    outcome = "rejected" if verdict["verdict"] == "WRONG" else "upheld"
    check.setdefault("contests", {})[cid] = outcome
    return outcome


# --- reuse of CORRECT -----------------------------------------------------------------------------

def cacheable(claim: dict, verdict: dict) -> bool:
    return verdict["verdict"] == "CORRECT" and not _UNIVERSAL.search(claim["quote"])


def still_correct(entry: dict, claim: dict, blob_of: Callable[[str], "str | None"]) -> bool:
    """A cached CORRECT stands while the claim keeps the category it was judged under, since each judged category is
    judged against different evidence, and every file it cited has the same blob in the checked tree."""
    return (entry.get("category") == claim["category"] and bool(entry["evidence_blobs"])
            and all(blob_of(p) == b for p, b in entry["evidence_blobs"].items()))
