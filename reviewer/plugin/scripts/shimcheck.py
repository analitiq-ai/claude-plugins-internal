"""The shim check's rules. No I/O: git, the ledger and Jev reach these functions as arguments."""
from __future__ import annotations

import re

import claimcheck
import lineage
from claimcheck import Located
from policy import Decision

LISTS = ("same_operation", "callers")
RULINGS = ("shares", "not_shared", "deferred")
RULED_OUT = ("not_shared", "deferred")
DEEP_AT, HOLD_AT = 3, 4
SWEPT = ("CODE", "MIXED")
CALL = "Workflow(name='reviewer:shim-check', args={worktree: '%s'})"
_CHECK_REF = re.compile(r"shim-(?P<repo>[\w.-]+/[\w.-]+)-(?P<tree>[0-9a-f]{12})")
# The file name patterns are taken from the runners' default discovery (pytest, go test, Jest, terraform test).
# Counting every file under a `tests`, `test` or `__tests__` folder is our addition, so that fixtures and helpers
# kept there count as test files too; Jest's own `__tests__` default matches only JS/TS files.
_TEST_DIRS = {"tests", "test", "__tests__"}
_TEST_NAME = re.compile(r"test_.*\.py|.*_test\.(?:py|go)|.*\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs)|.*\.tftest\.hcl")


def check_ref(repo: str, tree: str) -> str:
    return f"shim-{repo}-{tree[:12]}"


def parse_check_ref(ref) -> tuple[str, str] | None:
    """(repo, tree prefix) of a check ref."""
    found = _CHECK_REF.fullmatch(ref) if isinstance(ref, str) else None
    return (found["repo"], found["tree"]) if found else None


def site_id(file: str, function: str) -> str:
    return claimcheck.text_id(file, function)


def validate_sweep(output: dict, located: Located) -> list[str]:
    """Reasons a sweeper's two lists are not accepted; `located` gives a path's line count, or None."""
    errors = []
    for name in LISTS:
        seen = set()
        for entry in output[name]:
            size = located(entry["file"])
            where = f"{name}: {entry['file']}:{entry['line']}"
            if size is None:
                errors.append(f"{where}: {entry['file']} is not a file of HEAD; name only what the snapshot holds")
            elif not 1 <= entry["line"] <= size:
                errors.append(f"{where}: {entry['file']} has lines 1-{size} in HEAD")
            for field in ("function", "does"):
                if not entry[field].strip():
                    errors.append(f"{where}: {field} is empty")
            key = (entry["file"], entry["function"])
            if key in seen:
                errors.append(f"{name}: {entry['file']} {entry['function']} is listed twice; list each site once")
            seen.add(key)
    return errors


def contest_errors(contests, check: dict | None, chain: dict | None, ruled: set[str]) -> list[str]:
    """Reasons `contests` is refused before any judge runs."""
    if not isinstance(contests, list) or not contests or not all(isinstance(c, dict) for c in contests):
        return ["args.contests is a non-empty list of {site, reason}"]
    if check is None or check["status"] != "complete" or check["verdict"] != "patch" or chain is None:
        return ["a contest answers the patch verdict of the staged change; there is none to contest"]
    listed = {site_id(s["file"], s["function"]) for s in check["same_operation"]}
    errors, named = [], set()
    for contest in contests:
        site, reason = contest.get("site"), contest.get("reason")
        if not isinstance(site, str) or site not in listed:
            errors.append(f"site {site!r} is not in this check's SAME OPERATION list")
        elif site in ruled:
            errors.append(f"site {site} was already ruled for this bug; a site is ruled once")
        elif site in named:
            errors.append(f"site {site} is contested twice")
        else:
            named.add(site)
        if not isinstance(reason, str) or not reason.strip():
            errors.append(f"site {site!r}: the reason is empty")
    return errors


def unread_issue(number) -> str:
    """gh fails alike for a number that is no issue of the repo and for a GitHub it cannot reach."""
    return f"issue #{number} could not be read: it is not an issue of this repo, or gh could not reach GitHub"


def validate_ruling(body: dict, located: Located, issue_state) -> list[str]:
    """Reasons a site judge's ruling is not accepted; `issue_state` gives an issue's state, or None as `unread_issue`
    says."""
    errors = []
    if body["ruling"] == "deferred":
        if "issue" not in body:
            errors.append("a deferred ruling needs the number of an open issue the site moves to")
        elif (state := issue_state(body["issue"])) is None:
            errors.append(f"{unread_issue(body['issue'])}. Name an open issue of this repo")
        elif state != "OPEN":
            errors.append(f"issue #{body['issue']} is not open in this repo")
    for evidence in body["evidence"]:
        good, bad = claimcheck.citations(evidence, located)
        errors += [f"evidence {c}: {c.rsplit(':', 1)[0]} is not a file of the staged tree, or has no such line"
                   for c in bad]
        if not good and not bad:
            errors.append(f"evidence {evidence!r} names no path:line of the staged tree")
    return errors


def ruled_out(rulings: dict[str, dict]) -> set[str]:
    return {sid for sid, r in rulings.items() if r["ruling"] in RULED_OUT}


def verdict(kind: str, level: str | None, coverage: str | None, *, sites_left: bool) -> str:
    """`coverage` is defined over listed sites (`jev.FIX`), so with no SAME OPERATION site left it is not read."""
    if kind == "not_fix" or (level == "cause" and (not sites_left or coverage in ("all", "none_other"))):
        return "complete"
    return "patch"


def site_range(site: dict) -> dict:
    return {"file": site["file"], "old_start": site["line"], "old_count": 1}


def _old_range(item: dict) -> tuple[int, int]:
    return item["old_start"], item["old_start"] + max(item["old_count"], 1) - 1


def touches(a: dict, b: dict) -> bool:
    """Whether two old-side ranges of one file overlap or are adjacent, a pure insertion counting as the line it follows;
    the caller passes both in the numbering of one base."""
    (start_a, end_a), (start_b, end_b) = _old_range(a), _old_range(b)
    return a["file"] == b["file"] and start_a <= end_b + 1 and start_b <= end_a + 1


def overlaps(ranges: list[dict], hunks: list[dict]) -> bool:
    return any(touches(r, h) for r in ranges for h in hunks)


def altered(sites: list[dict], hunks: list[dict]) -> dict[str, list[tuple[int, int]] | None]:
    """Per site id, the lines the staged hunks alter in the site's file, or None when the file is not in the change. The
    gate knows a site's first line and not where it ends, so it says which lines changed and leaves the reading to
    the agent."""
    return {site_id(s["file"], s["function"]): ([_old_range(h) for h in hunks if h["file"] == s["file"]] or None)
            for s in sites}


def lines_text(lines: list[tuple[int, int]] | None) -> str:
    if lines is None:
        return "this file is not in the staged change"
    return "alters lines " + ", ".join(str(a) if a == b else f"{a}-{b}" for a, b in lines) + " of this file"


def _with_ranges(chain: dict, ranges: list[dict]) -> dict:
    kept = list(chain["ranges"])
    for r in ranges:
        r = {"file": r["file"], "old_start": r["old_start"], "old_count": r["old_count"]}
        if r not in kept:
            kept.append(r)
    return dict(chain, ranges=kept)


def new_chain(repo: str, branch: str, tree: str, ranges: list[dict], state: str = "open") -> dict:
    """A bug opened by `tree`; `members` are the trees counted in it. It belongs to its branch, not to a commit."""
    return _with_ranges({"id": claimcheck.text_id(repo, branch, tree),
                         "branch": branch, "count": 0, "members": [], "state": state, "target": None,
                         "seen": {}, "ranges": []}, ranges)


def override_id(chain: dict | None, tree: str) -> str:
    return chain["id"] if chain else tree[:12]


def is_test_file(path: str) -> bool:
    *folders, name = path.split("/")
    return bool(_TEST_DIRS.intersection(folders)) or _TEST_NAME.fullmatch(name) is not None


def swept(hunks: list[dict], labels: dict[str, str]) -> list[dict]:
    """The code hunks a fix is swept for; a tree whose code is all in test files fixes nothing yet, so it has none."""
    code = [h for h in hunks if labels.get(h["id"]) in SWEPT]
    return [] if all(is_test_file(h["file"]) for h in code) else code


def tracked(bug: dict) -> bool:
    return bug["state"] not in ("ended", "merged")


def matching_chains(chains: list[dict], hunks: list[dict]) -> list[dict]:
    return [c for c in chains if tracked(c) and overlaps(c["ranges"], hunks)]


def _listed(chain: dict, check: dict) -> dict:
    seen = {sid: list(trees) for sid, trees in chain["seen"].items()}
    for site in check["same_operation"]:
        trees = seen.setdefault(site_id(site["file"], site["function"]), [])
        if check["tree"] not in trees:
            trees.append(check["tree"])
    return dict(chain, seen=seen)


def misses(chain: dict, check: dict) -> list[tuple[str, str]]:
    """(site id, tree): for each site `check` lists, the counted trees of `chain` after the last one that listed it, or
    all of them when none did."""
    order, found = chain["members"], []
    for site in check["same_operation"]:
        sid = site_id(site["file"], site["function"])
        listed = [order.index(t) for t in chain["seen"].get(sid, []) if t in order]
        found += [(sid, tree) for tree in order[max(listed, default=-1) + 1:]]
    return found


def _state_for(count: int) -> str:
    return "held" if count >= HOLD_AT else "deep_due" if count >= DEEP_AT else "open"


def _counted(chain: dict, tree: str) -> dict:
    count = chain["count"] + 1
    state = _state_for(count) if count >= DEEP_AT else chain["state"]
    return dict(chain, count=count, members=[*chain["members"], tree], state=state)


def survivor(chains: list[dict]) -> dict:
    """The bug that goes on when several are one: the higher count, the smaller id on a tie (ADR-0014)."""
    return min(chains, key=lambda c: (-c["count"], c["id"]))


def _union(first: list, second: list) -> list:
    return first + [item for item in second if item not in first]


def _merged(chains: list[dict]) -> list[dict]:
    """The bug that goes on with the ranges, counted trees and listed sites of all, then the others as `merged` naming
    it. It is held if any was; an override on any of them is not carried."""
    keep = survivor(chains)
    others = [c for c in chains if c is not keep]
    seen = {sid: list(trees) for sid, trees in keep["seen"].items()}
    for other in others:
        for sid, trees in other["seen"].items():
            seen[sid] = _union(seen.get(sid, []), trees)
    ranges = _with_ranges(keep, [r for other in others for r in other["ranges"]])["ranges"]
    members = _union(keep["members"], [t for other in others for t in other["members"]])
    state = ("held" if any(c["state"] == "held" for c in chains) else
             _state_for(keep["count"]) if keep["state"] == "overridden" else keep["state"])
    return [dict(keep, ranges=ranges, members=members, seen=seen, state=state),
            *(dict(other, state="merged", into=keep["id"]) for other in others)]


def settled_chains(chains: list[dict], check: dict) -> list[dict]:
    """The bugs `check` changes, those it merged away included; an overridden bug the check reaches alone is left as
    the user set it, one merged with another is not (an override is not carried). A tree is counted at most
    once per bug, so a re-run check counts nothing twice."""
    matched = matching_chains(chains, check["hunks"])
    if check["verdict"] == "complete":
        return [dict(c, state="ended") for c in matched if c["state"] != "overridden"]
    gone: list[dict] = []
    if not matched:
        reached = [new_chain(check["repo"], check["branch"], check["tree"], [])]
    elif len(matched) > 1:
        reached, *gone = _merged(matched)
        reached = [reached]
    else:
        reached = [c for c in matched if c["state"] != "overridden"]
    ranges = [*check["hunks"], *map(site_range, check["same_operation"])]
    updated = [_listed(_with_ranges(c, ranges), check) for c in reached]
    if check["mode"] == "deep":
        target = {name: check[name] for name in LISTS}
        return [*gone, *(dict(c, state="deep_done", target=target) for c in updated)]
    counted = [c if check["tree"] in c["members"] else _counted(c, check["tree"]) for c in updated]
    # A bug that merged others is saved though this tree was counted in it already.
    return [*gone, *(c for c, before in zip(counted, updated) if gone or c is not before)]


def carried(bugs: list[dict], olds: dict[str, str], news: dict[str, str], gone: set[str], hunks_of) -> list[dict]:
    """`bugs` with each range moved from the text of its file in `olds` to the text in `news`; a bug with no range left
    is `ended`. A range in a file of `gone` (moved or deleted, nothing maps it) is dropped. Of the rest, a range in a
    file whose text did not change is kept as it is, one measured in empty old text becomes the whole new file once the
    file has text, and any other goes through `lineage.carry`, the lines turned to a span and back, with the hunks
    `hunks_of(file)` gives, and is dropped when it has no place in the new text. An overridden bug that keeps a range
    goes back to the state its count gives when any of its ranges was in a file of `gone`, was measured in empty old
    text in a file that now has text, or was touched by a hunk (on its lines or right beside them)."""
    moved = []
    for bug in bugs:
        ranges, reached = [], False
        for r in bug["ranges"]:
            if r["file"] in gone:
                reached = True
                continue
            old, new = olds[r["file"]], news[r["file"]]
            if new == old:
                ranges.append(r)
                continue
            if not old:
                # The range was measured in empty text. A diff from nothing maps no span, so once the
                # file has text the range widens to the whole file.
                whole = {"file": r["file"], "old_start": 1, "old_count": len(lineage.lines(new)) or 1}
                ranges += [whole] if whole not in ranges else []
                reached = True
                continue
            hunks = hunks_of(r["file"])
            reached = reached or overlaps([r], [{"file": r["file"], "old_start": h.old_start, "old_count": h.old_count}
                                                for h in hunks])
            [span] = lineage.carry([lineage.line_span(old, r["old_start"], r["old_count"])], old, new, hunks)
            if span is not None:
                first, count = lineage.lines_of(new, span)
                carried_to = {"file": r["file"], "old_start": first, "old_count": count}
                ranges += [carried_to] if carried_to not in ranges else []
        state = ("ended" if not ranges else _state_for(bug["count"]) if bug["state"] == "overridden" and reached
                 else bug["state"])
        moved.append(dict(bug, ranges=ranges, state=state))
    return moved


def _patch_report(check: dict, chain: dict | None, hunks: list[dict], root: str) -> str:
    """`hunks` are the staged hunks whatever their label: a prose edit reaching a site touches it."""
    sites = check["same_operation"]
    marks = altered(sites, hunks)
    listed = "".join(f"- {sid} {s['file']}:{s['line']} {s['function']} — {s['does']} ({lines_text(marks[sid])})\n"
                     for s, sid in ((s, site_id(s["file"], s["function"])) for s in sites))
    # `contest_errors` refuses any site the list does not hold, so with no site there is nothing to contest.
    next_step = (f"Next step: fix the cause at every site that has the defect, stage it and run {CALL % root} again; "
                 f"or contest a site: Workflow(name='reviewer:shim-check', args={{worktree: '{root}', contests: "
                 "[{site: '<id>', reason: '<why it does not share the defect>'}]})." if sites else
                 f"Next step: move the fix to the cause of the defect, stage it and run {CALL % root} again.")
    return (f"The shim check ruled this fix a patch: level {check['level']}, coverage {check['coverage']}."
            + (f" These sites do the same operation as the code it changes:\n{listed}" if sites else "\n")
            + f"This is refusal {chain['count'] if chain else 1} of this bug.\n"
            + (f"Each fix so far has left a site, so the next check runs a deep sweep: three sweepers, one starting "
               f"from the callers. Launch it: {CALL % root}.\n" if chain and chain["state"] == "deep_due" else "")
            + next_step)


def user_question(chain: dict) -> str:
    return (f"This bug has been refused {chain['count']} times, and each fix still left a site with the same defect. "
            "Stop and ask the user whether to fix every listed site in one change, or to commit as it is.")


def with_override(reason: str, chain: dict | None, tree: str) -> str:
    return (f"{reason}\nOnly the user can switch this check off for this bug, by typing "
            f"`override shim-{override_id(chain, tree)}`.")


def commit_decision(check: dict | None, chains: list[dict], *, empty: bool, concluding: bool, staging: bool,
                    alone: bool, hunks: list[dict], labels: dict[str, str], tree: str, root: str) -> Decision:
    """Whether the staged tree may be committed; the first rule that matches decides."""
    settled = claimcheck.commit_preconditions(empty=empty, concluding=concluding, staging=staging, alone=alone)
    if settled is not None:
        return settled
    held = next((c for c in chains if c["state"] == "held"), None)
    chain = held or (survivor(chains) if chains else None)

    def refuse(reason: str) -> Decision:
        return Decision(False, with_override(reason, chain, tree))

    if any(h["id"] not in labels for h in hunks):
        return refuse("The claim check has not labelled every staged hunk as code or prose, and the shim check sweeps "
                      f"only code. Next step: {claimcheck.CALL % root}.")
    code = swept(hunks, labels)
    if not code:
        return Decision(True)
    if held:
        return refuse(user_question(held))
    if chains and all(c["state"] == "overridden" for c in chains):
        return Decision(True)
    call = CALL % root
    if check is None:
        return refuse(f"The staged change has not been shim-checked. Next step: {call}, then commit again.")
    if check["status"] == "failed":
        return refuse(f"The check failed, not the fix: {check['reason']}. Next step: {call}.")
    if check["status"] != "complete":
        return refuse(f"The shim check of this staged tree is running ({check['status']}). Wait for it; if it "
                      f"stopped, relaunch it: {call}.")
    if check["verdict"] == "patch":
        return refuse(_patch_report(check, chain, hunks, root))
    return Decision(True)
