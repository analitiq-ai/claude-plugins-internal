"""The claim check's hook handlers: the commit decision, the workflow launch, the agents' outputs, the contest
judge's fetches, and the user's release. The rules they apply are claimcheck's and the mapping of words from one
version of a file to the next is lineage's; this module reads git and the ledger for them and records what they
decide. Nothing here is keyed on HEAD, a tree or a commit: a claim's count belongs to its lineage on a branch."""
from __future__ import annotations

import os
from datetime import datetime, timezone
from types import SimpleNamespace

import briefs
import claimcheck
import config
import ledger
import lineage
import worktree
from hookio import deny, record, refuse_claim, session_state
from shell import Action

CHECK = "alq-review:claim-check"
_AGENTS = (briefs.CLAIM_READER, briefs.CLAIM_JUDGE, briefs.CLAIM_CONTEST_JUDGE)


def _logged(repo: str, root: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(repo=repo, branch=None, pr=None, root=root)


def _reader_of(root: str, tree: str):
    """(located, text_of) over tree `tree`, each file read from git once."""
    texts: dict[str, str | None] = {}

    def text(path: str) -> str | None:
        if path not in texts:
            texts[path] = worktree.tree_text(root, tree, path)
        return texts[path]

    def located(path: str) -> int | None:
        found = text(path)
        return None if found is None else len(found.splitlines())

    def text_of(path: str) -> list[str] | None:
        found = text(path)
        return None if found is None else found.splitlines()
    return located, text_of


def _spans(hunks: list[dict], text_of) -> list[dict]:
    return [claimcheck.span(h, text_of(h["file"]) or []) for h in hunks]


def _files(hunks: list[dict]) -> list[str]:
    return sorted({h["file"] for h in hunks})


def _carried(claims: ledger.Claims, root: str, tree: str, branch: str, file: str, read: list[dict], ref: str):
    """(open lineages of `file` before, after, {claim id: [lineage id]}, the file's text) once the lineages are carried
    from the text a completed check last saw to the text in `tree`, `read` being the claims found in it. The callers ask
    only for files the staged change touched, which `tree` has. Saves no lineage and no text."""
    text = worktree.tree_text(root, tree, file)
    before = claims.open_lineages(branch, file)
    if not before:
        return before, [], {}, text
    seen = claims.seen(branch, "claim", file)
    if seen is None:
        raise RuntimeError(f"{file} has open lineages on {branch} and no saved text to carry them from")
    after, inherited = lineage.succeed(before, seen["text"], text, worktree.text_hunks(root, seen["text"], text), read,
                                       claimcheck.count, ref)
    return before, after, inherited, text


def _held(claims: ledger.Claims, root: str, tree: str, branch: str, hunks: list[dict]) -> tuple[list[dict], set[str]]:
    """The lineages that still have words in the staged files and are held, and the ids of the words the user released
    in them. Saves no lineage and no text: a hold is decided before any reader runs."""
    held, released = [], set()
    for file in _files(hunks):
        found = _carried(claims, root, tree, branch, file, [], "")
        for item in found[1]:
            if item["state"] == "open":
                held += [item] if claimcheck.held(item) else []
                released |= set(item["released"]["claims"]) if item["released"] else set()
    return held, released


def _mint(claim: dict, ref: str, text: str) -> dict:
    found = claimcheck.new_lineage(claim, ref)
    start, end = lineage.span_of(text, claim["line"], claim["quote"])
    found["places"] = [{"start": start, "end": end, "claim": claim["id"]}]
    return found


def _end_gone(claims: ledger.Claims, check: dict) -> None:
    """Ends the open lineages of each file the staged tree and the checkout both lack: a moved file starts again
    (ADR-0013), and a deleted one has no hunk to say so. A file only unstaged is still on disk and keeps its lineages."""
    root, tree, branch = check["root"], check["tree"], check["branch"]
    for item in claims.open_lineages(branch):
        if worktree.tree_text(root, tree, item["file"]) is None and not worktree.on_disk(root, item["file"]):
            claimcheck.end(item, "deleted", check["ref"])
            claims.save_lineage(branch, item)


def _completed(payload: dict, claims: ledger.Claims, check: dict) -> None:
    """A check that just completed moves each file's lineages to the text it checked, enters its rulings in their
    chains once, starts a lineage for each WRONG claim that continues none, and keeps that text to carry from next."""
    branch, ref = check["branch"], check["ref"]
    lineages = {}
    _end_gone(claims, check)
    for file in _files(check["hunks"]):
        read = sorted((c for c in check["claims"].values() if c["file"] == file), key=lambda c: (c["line"], c["id"]))
        before, after, inherited, text = _carried(claims, check["root"], check["tree"], branch, file, read, ref)
        claimcheck.keep_holds(before, after)
        by_id = {item["id"]: item for item in after}
        for claim in read:
            verdict = check["verdicts"].get(claim["id"])
            if verdict is None:
                continue
            found = by_id[inherited[claim["id"]][0]] if claim["id"] in inherited else None
            if found is None and verdict["verdict"] == "WRONG":
                found = by_id[claim["id"]] = _mint(claim, ref, text)
                after.append(found)
            if found is None:
                continue
            inherited[claim["id"]] = [found["id"]]
            claimcheck.enter(found, ref, claim, verdict)
        for item in after:
            claims.save_lineage(branch, item)
        if any(item["state"] == "open" for item in after):
            claims.save_seen(branch, "claim", file, {"text": text, "ref": ref})
        lineages.update({cid: owned[0] for cid, owned in inherited.items()})
    check["lineages"] = lineages
    verdicts = [v["verdict"] for v in check["verdicts"].values()]
    record(payload, "claim-check", "complete",
           f"{check['ref']}: {check['cost']['judged']} judged, {check['cost']['agents']} agents, "
           f"{verdicts.count('WRONG')} WRONG, {verdicts.count('UNSURE')} UNSURE", _logged(check["repo"], check["root"]))


def _settle(payload: dict, claims: ledger.Claims, check: dict) -> None:
    """A check is settled once: a contest answered after it completed replaces a verdict without completing the
    check again, so its rulings are not entered twice."""
    if check["status"] == "complete":
        return
    claimcheck.settle(check)
    if check["status"] == "complete":
        _completed(payload, claims, check)


# --- the commit ---------------------------------------------------------------------------

def on_commit(payload: dict, action: Action) -> dict | None:
    where = worktree.locate(action.cwd)
    if where is None:
        return None
    root = where.root
    tree, base = worktree.staged_tree(root), worktree.head_tree(root)
    empty = tree == base and not action.staging
    concluding = worktree.concluding(root)
    decided = claimcheck.commit_preconditions(empty=empty, concluding=concluding, staging=action.staging,
                                              alone=action.alone)
    held, released, refusal = [], set(), None
    with ledger.open_claims(where.slug) as claims:
        check = claims.check(tree)
        if check is not None and check["base"] != base:
            check = None
        hunks = [] if decided else (check["hunks"] if check else worktree.tree_hunks(root, base, tree))
        if hunks:
            try:
                lineage.differ()
                held, released = _held(claims, root, tree, where.branch, hunks)
            except (lineage.Unavailable, lineage.BudgetExceeded) as exc:
                refusal = str(exc)
    if refusal:
        return refuse_claim(payload, "commit", refusal, _logged(where.slug, root))
    decision = claimcheck.commit_decision(check, empty=empty, concluding=concluding, staging=action.staging,
                                          alone=action.alone, held=held, released=released, root=root)
    if not decision.allow:
        return refuse_claim(payload, "commit", decision.reason, _logged(where.slug, root))
    return None


# --- the launch ---------------------------------------------------------------------------------------

def _new_check(repo: str, root: str, branch: str, tree: str, base: str, hunks: list[dict]) -> dict:
    return {"repo": repo, "root": root, "branch": branch, "tree": tree, "base": base,
            "ref": claimcheck.check_ref(repo, tree),
            "status": "reading", "hunks": hunks, "batches": [], "labels": {}, "claims": {}, "verdicts": {},
            "contests": {}, "cost": {"judged": 0, "agents": 0}}


def _reuse(claims: ledger.Claims, check: dict, earlier: dict | None) -> list[dict]:
    """Fill in what earlier checks settled; return the hunks that still need a reader. A stored read is reused only
    under the current reader brief, and a cached CORRECT only while its claim keeps its category."""
    _, text_of = _reader_of(check["root"], check["tree"])
    to_read = []
    for hunk in check["hunks"]:
        read = claims.read(hunk["patch_id"])
        if read is not None and read.get("brief") == briefs.READER_BRIEF:
            claims_now = [{"line": hunk["new_start"] + c["offset"], "quote": c["quote"], "category": c["category"]}
                          for c in read["claims"]]
            output = {"hunks": [{"id": hunk["id"], "kind": read["kind"], "claims": claims_now}]}
            if not claimcheck.validate_reader(output, _spans([hunk], text_of)):
                claimcheck.add_read(check, hunk, read["kind"], claims_now)
                continue
        to_read.append(hunk)
    for cid, claim in check["claims"].items():
        if earlier and cid in earlier["verdicts"]:
            check["verdicts"][cid] = earlier["verdicts"][cid]
            continue
        cached = claims.verdict(cid) if claim["category"] in claimcheck.JUDGED else None
        if cached and claimcheck.still_correct(cached, claim, lambda p: worktree.tree_blob(check["root"], check["tree"], p)):
            check["verdicts"][cid] = cached["verdict"]
    return to_read


def _accepted_contests(check: dict | None, contests, located) -> tuple[list[dict], list[str]]:
    """The accepted contests, each naming its claim by id, and the reason each other contest is refused."""
    if not isinstance(contests, list) or not all(isinstance(c, dict) for c in contests):
        return [], ["args.contests is a list of {claim, evidence}"]
    if check is None or check["status"] != "complete":
        return [], ["a contest answers the completed check of the staged change; there is none to contest"]
    accepted, errors = [], []
    for contest in contests:
        cid, refused = claimcheck.accept_contest(contest, check, located)
        if cid is None:
            errors += refused
        else:
            accepted.append(dict(contest, claim=cid))
    return accepted, errors


def on_launch(payload: dict, call: dict) -> dict | None:
    args = call.get("args") if isinstance(call.get("args"), dict) else {}
    root = args.get("worktree")
    where = worktree.locate(root) if isinstance(root, str) and os.path.isabs(root) else None
    if where is None:
        return deny(f"{CHECK} needs args.worktree: the absolute path of the checkout whose staged change is checked, "
                    "with a GitHub origin.")
    root, repo, logged = where.root, where.slug, _logged(where.slug, where.root)
    try:
        lineage.differ()
    except lineage.Unavailable as exc:
        return refuse_claim(payload, "claim-launch", str(exc), logged)
    unstaged = worktree.unstaged(root)
    if unstaged:
        return refuse_claim(payload, "claim-launch", "The check reads the staged change from the checkout, and these "
                            f"tracked files differ from what is staged: {', '.join(unstaged)}. Stage or discard them, "
                            "then launch again.", logged)
    contests = args.get("contests") or []
    tree, base = worktree.staged_tree(root), worktree.head_tree(root)
    if tree == base:
        return refuse_claim(payload, "claim-launch", "Nothing is staged, so there is nothing to check. Stage the "
                            "change with `git add`, then launch again.", logged)
    with ledger.open_claims(repo) as claims:
        earlier = claims.check(tree)
        if earlier is not None and earlier["base"] != base:
            earlier = None
        hunks = earlier["hunks"] if earlier else worktree.tree_hunks(root, base, tree)
        try:
            held, _ = _held(claims, root, tree, where.branch, hunks)
        except lineage.BudgetExceeded as exc:
            return refuse_claim(payload, "claim-launch", str(exc), logged)
        if held:
            return refuse_claim(payload, "claim-launch", claimcheck.user_question(held), logged)
        if contests:
            located, _ = _reader_of(root, tree)
            contests, errors = _accepted_contests(earlier, contests, located)
            if errors:
                return refuse_claim(payload, "claim-launch", "The contest was refused:\n- " + "\n- ".join(errors), logged)
            check = earlier
            check["contests"].update({c["claim"]: "pending" for c in contests})
            with session_state(payload, ".fetch") as fetch:
                fetch["hosts"] = sorted(set(fetch.get("hosts", [])) | set(claimcheck.cited_hosts(contests)))
            injected = briefs.claim_check_args(check, to_read=[], contests=contests,
                                               warn_over=config.load()["claim_warn_over"])
            injected["claims"] = []
        else:
            if earlier is not None and earlier["status"] == "complete":
                return refuse_claim(payload, "claim-launch", f"This staged change was already checked ({earlier['ref']}). "
                                    "Commit it, change it, or contest a WRONG verdict with evidence.", logged)
            check = _new_check(repo, root, where.branch, tree, base, hunks)
            to_read = _reuse(claims, check, earlier)
            injected = briefs.claim_check_args(check, to_read=to_read, contests=[],
                                               warn_over=config.load()["claim_warn_over"])
            _settle(payload, claims, check)
        claims.save_check(check)
    record(payload, "claim-launch", "allow", check["ref"], logged)
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow",
                                   "updatedInput": dict(call, args=injected)}}


# --- what the agents answer ------------------------------------------------------------------------------

def owns(payload: dict) -> bool:
    return payload.get("agent_type") in _AGENTS and "check_ref" in payload["tool_input"]


def _verdict_errors(body: dict, check: SimpleNamespace, located, contest: bool) -> list[str]:
    cid = claimcheck.claim_id(body["file"], body["quote"])
    if cid not in check.judged:
        return [f"{body['file']}: \"{body['quote']}\" is not a claim this check judges; give file and quote exactly "
                "as you were given them"]
    if contest and cid not in check.contested:
        return [f"{claimcheck.claim_ref(cid)} is not under contest"]
    if not contest and not check.open:
        return [f"{check.ref} takes no more verdicts"]
    return claimcheck.validate_verdict(body, located, contest=contest)


def _reader_errors(body: dict, check: SimpleNamespace, waiting: dict[int, list[dict]]) -> list[str]:
    batch = waiting.get(body["batch"])
    if batch is None:
        return [f"{check.ref} has no batch {body['batch']} waiting to be read"]
    return claimcheck.validate_reader(body, batch)


def _waiting(check: dict, text_of) -> dict[int, list[dict]]:
    """Each batch a reader may still answer, as the spans of its hunks."""
    if check["status"] == "complete":
        return {}
    hunks = {h["id"]: h for h in check["hunks"]}
    return {i: _spans([hunks[hid] for hid in ids], text_of) for i, ids in enumerate(check["batches"])}


def _as_read(check: dict) -> SimpleNamespace:
    """What the verdict rules need from the stored check, read before the agent's body is."""
    return SimpleNamespace(
        ref=check["ref"], open=check["status"] in ("reading", "judging"),
        judged={cid for cid, c in check["claims"].items() if c["category"] in claimcheck.JUDGED},
        contested={cid for cid, state in check["contests"].items() if state == "pending"})


def on_output(payload: dict) -> dict | None:
    body, agent_type = payload["tool_input"], payload["agent_type"]
    parsed = claimcheck.parse_check_ref(body.get("check_ref"))
    stored = None
    if parsed is not None:
        with ledger.open_claims(parsed[0]) as claims:
            stored = claims.check(parsed[1])
    if stored is None:
        errors = [f"check_ref {body.get('check_ref')!r} names no open claim check; answer with the check_ref you "
                  "were given"]
    else:
        check = _as_read(stored)
        located, text_of = _reader_of(stored["root"], stored["tree"])
        waiting = _waiting(stored, text_of) if agent_type == briefs.CLAIM_READER else {}
        try:
            if agent_type == briefs.CLAIM_READER:
                errors = _reader_errors(body, check, waiting)
            else:
                errors = _verdict_errors(body, check, located, contest=agent_type == briefs.CLAIM_CONTEST_JUDGE)
        except (KeyError, TypeError) as exc:
            # The harness checks the JSON Schema after this hook and sends an ill-shaped body back itself.
            record(payload, "claim-output", "ill-shaped", f"{type(exc).__name__}: {exc}")
            return None
    if not errors:
        return None
    record(payload, "claim-output", "deny", "; ".join(errors))
    return deny("Your output was rejected. Correct it and submit again:\n- " + "\n- ".join(errors))


def after_output(payload: dict) -> None:
    body, agent_type = payload["tool_input"], payload["agent_type"]
    repo, tree = claimcheck.parse_check_ref(body["check_ref"])
    with ledger.open_claims(repo) as claims:
        check = claims.check(tree)
        check["cost"]["agents"] += 1
        if agent_type == briefs.CLAIM_READER:
            hunks = {h["id"]: h for h in check["hunks"]}
            for entry in body["hunks"]:
                hunk = hunks[entry["id"]]
                claimcheck.add_read(check, hunk, entry["kind"], entry["claims"])
                claims.save_read(hunk["patch_id"], {"brief": briefs.READER_BRIEF, "kind": entry["kind"], "claims": [
                    {"offset": c["line"] - hunk["new_start"], "quote": c["quote"], "category": c["category"]}
                    for c in entry["claims"]]})
            outcome = f"read batch {body['batch']}"
        else:
            cid = claimcheck.claim_id(body["file"], body["quote"])
            verdict = {k: v for k, v in body.items() if k != "check_ref"}
            if agent_type == briefs.CLAIM_CONTEST_JUDGE:
                found = claims.open_lineage(check["branch"], check["lineages"][cid])
                if found is None:
                    raise RuntimeError(f"{claimcheck.claim_ref(cid)} has no open lineage on {check['branch']} to enter "
                                       "the contest in")
                outcome = f"contest of {claimcheck.claim_ref(cid)} {claimcheck.contest_outcome(check, found, cid, verdict)}"
                claims.save_lineage(check["branch"], found)
            else:
                check["verdicts"][cid] = verdict
                check["cost"]["judged"] += 1
                outcome = f"{claimcheck.claim_ref(cid)} {verdict['verdict']}"
            if claimcheck.cacheable(check["claims"][cid], verdict):
                located, _ = _reader_of(check["root"], check["tree"])
                claims.save_verdict(cid, {"category": check["claims"][cid]["category"], "verdict": verdict, "evidence_blobs": {
                    path: worktree.tree_blob(check["root"], check["tree"], path)
                    for path in claimcheck.cited_paths(verdict, located)}})
        _settle(payload, claims, check)
        claims.save_check(check)
    record(payload, "claim-output", "recorded", f"{check['ref']}: {outcome}; {check['status']}",
           _logged(repo, check["root"]))


# --- the contest judge's reading, and the user's release ----------------------------------------------

def on_webfetch(payload: dict) -> dict | None:
    """The contest judge reads only the hosts its contests cite; no other agent's fetches are the gate's business."""
    if payload.get("agent_type") != briefs.CLAIM_CONTEST_JUDGE:
        return None
    with session_state(payload, ".fetch") as fetch:
        hosts = fetch.get("hosts", [])
    url = str(payload["tool_input"].get("url", ""))
    if claimcheck.fetch_allowed(url, hosts):
        return None
    return refuse_claim(payload, "fetch", f"The contest judge reads only the https:// hosts the contest cites "
                        f"({', '.join(hosts) or 'none'}), not {url}.")


def on_prompt(payload: dict, word: str) -> dict | None:
    """Answers `unlock <word>` where the word is a claim's name; None where it is not, and the unlock is a branch's.
    The name may be a lineage's id or the id of words a lineage holds now."""
    cid = claimcheck.parse_claim_ref(word)
    if cid is None:
        return None
    at, released = ledger.stamp(datetime.now(timezone.utc)), []
    for repo, branch, lineage_id in ledger.claim_lineage_holders(cid):
        with ledger.open_claims(repo) as claims:
            found = claims.open_lineage(branch, lineage_id)
            if found is None or not claimcheck.held(found):
                continue
            claimcheck.release(found, at)
            claims.save_lineage(branch, found)
        released.append(f"{repo} {found['file']}")
    if released:
        record(payload, "claim-unlock", "released", f"{claimcheck.claim_ref(cid)}: {', '.join(released)}")
        said = (f"The user released {claimcheck.claim_ref(cid)} in {', '.join(released)}: the words it holds now may be "
                "committed. Its count stays, so one more WRONG ruling on any version of it holds it again.")
    else:
        said = f"`unlock {word}` names no claim a check is holding, so nothing was released."
    return {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": f"[alq-review] {said}"}}
