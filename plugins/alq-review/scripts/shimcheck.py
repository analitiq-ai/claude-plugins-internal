"""The shim check's rules (spec 006). No I/O: git, the ledger and Jev reach these functions as arguments."""
from __future__ import annotations

import hashlib
import re

import claimcheck
from claimcheck import Located
from policy import Decision

LISTS = ("same_operation", "callers")
RULINGS = ("shares", "not_shared", "deferred")
RULED_OUT = ("not_shared", "deferred")
DEEP_AT, HOLD_AT = 3, 4
SWEPT = ("CODE", "MIXED")
CALL = "Workflow(name='alq-review:shim-check', args={worktree: '%s'})"
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
    return hashlib.sha256(f"{file}\0{function}".encode()).hexdigest()[:16]


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
    """Reasons `contests` is refused before any judge runs (R8)."""
    if not isinstance(contests, list) or not contests or not all(isinstance(c, dict) for c in contests):
        return ["args.contests is a non-empty list of {site, reason}"]
    if check is None or check["status"] != "complete" or check["verdict"] != "patch" or chain is None:
        return ["a contest answers the patch verdict of the staged change; there is none to contest"]
    listed = {site_id(s["file"], s["function"]) for s in check["same_operation"]}
    errors, named = [], set()
    for contest in contests:
        site, reason = contest.get("site"), contest.get("reason")
        if site not in listed:
            errors.append(f"site {site!r} is not in this check's SAME OPERATION list")
        elif site in ruled:
            errors.append(f"site {site} was already ruled for this bug; a site is ruled once")
        elif site in named:
            errors.append(f"site {site} is contested twice")
        if not isinstance(reason, str) or not reason.strip():
            errors.append(f"site {site!r}: the reason is empty")
        named.add(site)
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


def overlaps(ranges: list[dict], hunks: list[dict]) -> bool:
    return any(claimcheck.touches(r, h) for r in ranges for h in hunks)


def touched(sites: list[dict], hunks: list[dict]) -> dict[str, bool]:
    """Per site id, whether `claimcheck.touches` holds for a hunk and the site's line."""
    return {site_id(s["file"], s["function"]): overlaps([site_range(s)], hunks) for s in sites}


def _with_ranges(chain: dict, ranges: list[dict]) -> dict:
    kept = list(chain["ranges"])
    for r in ranges:
        r = {"file": r["file"], "old_start": r["old_start"], "old_count": r["old_count"]}
        if r not in kept:
            kept.append(r)
    return dict(chain, ranges=kept)


def new_chain(repo: str, branch: str, head: str, tree: str, ranges: list[dict], state: str = "open") -> dict:
    """A bug chain opened by `tree` (R9); `members` are the trees counted in it."""
    return _with_ranges({"id": hashlib.sha256(f"{repo}\0{branch}\0{head}\0{tree}".encode()).hexdigest()[:16],
                         "branch": branch, "head": head, "count": 0, "members": [], "state": state, "target": None,
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


def matching_chains(chains: list[dict], hunks: list[dict]) -> list[dict]:
    return [c for c in chains if c["state"] != "ended" and overlaps(c["ranges"], hunks)]


def _listed(chain: dict, check: dict) -> dict:
    seen = {sid: list(trees) for sid, trees in chain["seen"].items()}
    for site in check["same_operation"]:
        trees = seen.setdefault(site_id(site["file"], site["function"]), [])
        if check["tree"] not in trees:
            trees.append(check["tree"])
    return dict(chain, seen=seen)


def misses(chain: dict, check: dict) -> list[tuple[str, str]]:
    """(site id, tree): for each site `check` lists, the counted trees of `chain` after the last counted tree that
    listed it (R12)."""
    order, found = chain["members"], []
    for site in check["same_operation"]:
        sid = site_id(site["file"], site["function"])
        listed = [order.index(t) for t in chain["seen"].get(sid, []) if t in order]
        found += [(sid, tree) for tree in order[max(listed, default=-1) + 1:]]
    return found


def _counted(chain: dict, tree: str) -> dict:
    count = chain["count"] + 1
    state = {DEEP_AT: "deep_due", HOLD_AT: "held"}.get(count, chain["state"])
    return dict(chain, count=count, members=[*chain["members"], tree], state=state)


def settled_chains(chains: list[dict], check: dict) -> list[dict]:
    """The chains `check` changes (R9, R10); an overridden chain is left as the user set it (FR-017). A tree is
    counted at most once per chain, so a re-run check counts nothing twice."""
    matched = matching_chains(chains, check["hunks"])
    reached = [c for c in matched if c["state"] != "overridden"]
    if check["verdict"] == "complete":
        return [dict(c, state="ended") for c in reached]
    if not matched:
        reached = [new_chain(check["repo"], check["branch"], check["head"], check["tree"], [])]
    ranges = [*check["hunks"], *map(site_range, check["same_operation"])]
    if check["mode"] == "deep":
        target = {name: check[name] for name in LISTS}
        return [dict(_listed(_with_ranges(c, ranges), check), state="deep_done", target=target) for c in reached]
    return [_counted(_listed(_with_ranges(c, ranges), check), check["tree"])
            for c in reached if check["tree"] not in c["members"]]


def _patch_report(check: dict, chain: dict | None, hunks: list[dict], root: str) -> str:
    """`hunks` are the staged hunks whatever their label: a prose edit reaching a site touches it (FR-007)."""
    sites = check["same_operation"]
    marks = touched(sites, hunks)
    listed = "".join(f"- {sid} {s['file']}:{s['line']} {s['function']} — {s['does']} "
                     f"({'touched' if marks[sid] else 'not touched'})\n"
                     for s, sid in ((s, site_id(s["file"], s["function"])) for s in sites))
    # `contest_errors` refuses any site the list does not hold, so with no site there is nothing to contest.
    next_step = (f"Next step: fix the cause at every site that has the defect, stage it and run {CALL % root} again; "
                 f"or contest a site: Workflow(name='alq-review:shim-check', args={{worktree: '{root}', contests: "
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
    chain = held or next(iter(chains), None)

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
    if any(c["state"] == "overridden" for c in chains):
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
