"""The shim check's hook handlers (spec 006): the commit decision. The rules are shimcheck's; this module reads git
and the ledger for them and records what they decide."""
from __future__ import annotations

import os
import re
import time
from types import SimpleNamespace

import briefs
import github
import jev
import ledger
import shimcheck
import snapshot
import worktree
from hookio import deny, record, refuse_shim
from shell import Action

CHECK = "alq-review:shim-check"
# Below the 60 s hooks.json gives the gate, so a Jev that stops answering fails the check before the hook is killed.
JEV_SECONDS = 40
OVERRIDE = re.compile(r"override\s+shim-(?P<id>[0-9a-f]{16}|[0-9a-f]{12})\b")


def _logged(repo: str, root: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(repo=repo, branch=None, pr=None, root=root)


def _hunks_and_labels(repo: str, root: str, tree: str, base: str) -> tuple[list[dict], dict[str, str]]:
    """The staged hunks and the claim check's labels for them (R2); no labels until that check has read the tree."""
    with ledger.open_claims(repo) as claims:
        claim = claims.check(tree)
    if claim is None or claim["base"] != base:
        return worktree.tree_hunks(root, base, tree), {}
    return claim["hunks"], claim["labels"]


def on_commit(payload: dict, action: Action) -> dict | None:
    where = worktree.locate(action.cwd)
    if where is None:
        return None
    root, repo = where.root, where.slug
    tree, base = worktree.staged_tree(root), worktree.head_tree(root)
    empty = tree == base and not action.staging
    concluding = worktree.concluding(root)
    hunks, labels = ([], {}) if empty or concluding else _hunks_and_labels(repo, root, tree, base)
    head = worktree.head_sha(root)
    with ledger.open_shims(repo) as shims:
        check = shims.check(tree)
        if check is not None and check["head"] != head:
            check = None
        chains = shimcheck.matching_chains(shims.chains_at(where.branch, head), shimcheck.swept(hunks, labels))
    decision = shimcheck.commit_decision(check, chains, empty=empty, concluding=concluding, staging=action.staging,
                                         alone=action.alone, hunks=hunks, labels=labels, tree=tree, root=root)
    if not decision.allow:
        return refuse_shim(payload, "shim-commit", decision.reason, _logged(repo, root))
    return None


# --- the launch ---------------------------------------------------------------------------------------

def _new_check(where: worktree.Worktree, tree: str, head: str, chain: dict | None, code: list[dict], diff: str) -> dict:
    return {"ref": shimcheck.check_ref(where.slug, tree), "repo": where.slug, "root": where.root, "tree": tree,
            "head": head, "branch": where.branch, "chain": chain and chain["id"], "hunks": code, "diff": diff,
            "mode": None, "kind": None, "expected": [], "outputs": {}, "same_operation": [], "callers": [],
            "level": None, "coverage": None, "verdict": None, "status": "sweeping", "reason": None,
            "contests": {}, "snapshot": None, "started": time.time(),
            "cost": {"agents": 0, "seconds": 0, "jev_usd": 0.0}}


def _finish(check: dict, status: str, reason: str | None = None) -> None:
    """A check that ends gives back its snapshot (R3); its seconds run from the launch."""
    check["status"], check["reason"] = status, reason
    check["cost"]["seconds"] = round(time.time() - check["started"])
    if check["snapshot"]:
        snapshot.remove(check["snapshot"])
        check["snapshot"] = None


def _end_replaced(payload: dict, check: dict) -> None:
    """Sweeping or judging checks of another tree or `HEAD` at this checkout can no longer commit, so they end and
    give back their snapshots (R3)."""
    with ledger.open_shims(check["repo"]) as shims:
        replaced = [old for old in shims.unfinished_at(check["root"])
                    if (old["tree"], old["head"]) != (check["tree"], check["head"])]
        for old in replaced:
            _finish(old, "failed", f"replaced by {check['ref']}")
            shims.save_check(old)
    for old in replaced:
        _logged_check(payload, old)


def _failure(exc: Exception) -> str:
    if isinstance(exc, jev.TooLarge):
        return f"{exc}. Split the change into smaller commits, each checked on its own"
    return str(exc)


def _is_fix(check: dict, deadline: float) -> bool:
    """Ask `kind` unless an earlier launch of this tree has; anything but a fix is complete."""
    if check["kind"] is None:
        check["kind"], cost = jev.ask_kind(check["diff"], deadline)
        check["cost"]["jev_usd"] += cost
    if check["kind"] == "not_fix":
        check["mode"], check["verdict"] = "not_fix", "complete"
        _finish(check, "complete")
        return False
    return True


def _sweep(check: dict, mode: str) -> None:
    """Sweep from a snapshot of `HEAD` with the mode's briefs; lists from an earlier sweep of the tree are dropped."""
    check["mode"], check["expected"], check["outputs"] = mode, list(briefs.SHIM_SWEEPS[mode]), {}
    check["status"], check["reason"] = "sweeping", None
    check["snapshot"] = snapshot.export(check["root"], check["tree"])


def _rejudge(check: dict, lists: dict, deadline: float) -> None:
    check["mode"], check["status"] = "rejudge", "judging"
    check["same_operation"], check["callers"] = lists["same_operation"], lists["callers"]
    _judge(check, deadline)


def _lists_recorded(check: dict) -> bool:
    return bool(check["expected"]) and len(check["outputs"]) >= len(check["expected"])


def on_launch(payload: dict, call: dict) -> dict | None:
    args = call.get("args") if isinstance(call.get("args"), dict) else {}
    root = args.get("worktree")
    where = worktree.locate(root) if isinstance(root, str) and os.path.isabs(root) else None
    if where is None:
        return deny(f"{CHECK} needs args.worktree: the absolute path of the checkout whose staged change is checked, "
                    "with a GitHub origin.")
    root, repo, logged = where.root, where.slug, _logged(where.slug, where.root)
    deadline = time.monotonic() + JEV_SECONDS
    unstaged = worktree.unstaged(root)
    if unstaged:
        return refuse_shim(payload, "shim-launch", "The check reads the staged change, and these tracked files differ "
                           f"from what is staged: {', '.join(unstaged)}. Stage or discard them, then launch again.", logged)
    tree, base = worktree.staged_tree(root), worktree.head_tree(root)
    if tree == base:
        return refuse_shim(payload, "shim-launch", "Nothing is staged, so there is nothing to check. Stage the change "
                           "with `git add`, then launch again.", logged)
    hunks, labels = _hunks_and_labels(repo, root, tree, base)
    if any(h["id"] not in labels for h in hunks):
        return refuse_shim(payload, "shim-launch", "The claim check has not labelled every staged hunk as code or prose, "
                           f"and this check sweeps only code. Next step: Workflow(name='alq-review:claim-check', "
                           f"args={{worktree: '{root}'}}), then launch this check again.", logged)
    head = worktree.head_sha(root)
    code = shimcheck.swept(hunks, labels)
    with ledger.open_shims(repo) as shims:
        earlier = shims.check(tree)
        chains = shimcheck.matching_chains(shims.chains_at(where.branch, head), code)
    held = next((c for c in chains if c["state"] == "held"), None)
    overridden = next((c for c in chains if c["state"] == "overridden"), None)
    unread = _drop_closed_deferrals(payload, repo, chains, logged)
    if unread:
        return refuse_shim(payload, "shim-launch", unread, logged)
    deep_due = any(c["state"] == "deep_due" for c in chains)
    target = next((c["target"] for c in chains if c["state"] == "deep_done"), None)
    if held:
        return refuse_shim(payload, "shim-launch",
                           shimcheck.with_override(shimcheck.user_question(held), held, tree), logged)
    if overridden:
        return refuse_shim(payload, "shim-launch", f"The user switched the shim check off for this bug "
                           f"(override shim-{overridden['id']}), so it is not checked again. Run `git commit` alone.",
                           logged)
    if "contests" in args:
        current = earlier if earlier is not None and earlier["head"] == head else None
        return _contest(payload, call, current, chains, args["contests"], logged)
    # A complete tree is checked again only for its bug's deep sweep (R10), and a stopped contest resumes.
    if earlier is not None and earlier["head"] == head and earlier["status"] == "ruling":
        return _allowed(payload, call, earlier, "contest", logged)
    if earlier is not None and earlier["head"] == head and earlier["status"] == "complete" and not deep_due:
        return refuse_shim(payload, "shim-launch", f"This staged change was already checked ({earlier['ref']}). "
                           "Commit it or change it.", logged)
    # A check that stopped is restarted, not begun again: what it recorded stands (R13).
    restarted = earlier is not None and earlier["head"] == head
    if restarted:
        check = earlier
        check["started"] = time.time()
    else:
        diff = worktree.tree_diff(root, base, tree, sorted({h["file"] for h in code})) if code else ""
        check = _new_check(where, tree, head, next(iter(chains), None), code, diff)
    _end_replaced(payload, check)
    mode = None
    try:
        if not code:
            check["mode"], check["verdict"] = "none", "complete"
            _finish(check, "complete")
        elif restarted and check["status"] != "complete" and _lists_recorded(check):
            mode, check["status"] = "rejudge", "judging"
            _judge(check, deadline)
        elif _is_fix(check, deadline):
            if target:
                _rejudge(check, target, deadline)
            else:
                _sweep(check, "deep" if deep_due else "sweep")
    except (jev.JevError, RuntimeError) as exc:
        _finish(check, "failed", _failure(exc))
    mode = mode or check["mode"]
    _save(payload, check)
    if check["status"] in ("complete", "failed") and check["mode"] != "none":
        _logged_check(payload, check)
    if check["status"] == "failed":
        return refuse_shim(payload, "shim-launch", f"The check failed, not the fix: {check['reason']}. Next step: "
                           f"{shimcheck.CALL % root}.", logged)
    return _allowed(payload, call, check, mode, logged)


def _allowed(payload: dict, call: dict, check: dict, mode: str, logged) -> dict:
    record(payload, "shim-launch", "allow", f"{check['ref']}: {mode}", logged)
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow",
                                   "updatedInput": dict(call, args=briefs.shim_check_args(check, mode))}}


def _drop_closed_deferrals(payload: dict, repo: str, chains: list[dict], logged) -> str | None:
    """A deferral lasts while its issue is open (R8); the reason to refuse when an issue's state cannot be read."""
    for chain in chains:
        with ledger.open_shims(repo) as shims:
            deferred = {sid: r for sid, r in shims.rulings(chain["id"]).items() if r["ruling"] == "deferred"}
        for sid, ruling in deferred.items():
            state = github.issue_state(repo, ruling["issue"])
            if state is None:
                return (f"Site {sid} was deferred to issue #{ruling['issue']}, but "
                        f"{shimcheck.unread_issue(ruling['issue'])}. Launch again once gh answers.")
            if state != "OPEN":
                with ledger.open_shims(repo) as shims:
                    shims.drop_ruling(chain["id"], sid)
                record(payload, "shim-contest", "dropped", f"chain {chain['id']}: site {sid}, issue "
                       f"#{ruling['issue']} is {state.lower()}", logged)
    return None


def _contest(payload: dict, call: dict, check: dict | None, chains: list[dict], contests, logged) -> dict | None:
    """Accept a contest of listed sites and run one judge per site; the tree is judged again once all are ruled."""
    chain = next((c for c in chains if check and check["tree"] in c["members"]), None)
    with ledger.open_shims(logged.repo) as shims:
        ruled = set(shims.rulings(chain["id"])) if chain else set()
    errors = shimcheck.contest_errors(contests, check, chain, ruled)
    if errors:
        return refuse_shim(payload, "shim-launch", "The contest was refused:\n- " + "\n- ".join(errors), logged)
    check.update(chain=chain["id"], contests={c["site"]: c["reason"] for c in contests}, status="ruling",
                 started=time.time())
    with ledger.open_shims(check["repo"]) as shims:
        shims.save_check(check)
    record(payload, "shim-contest", "accepted", f"{check['ref']}: {', '.join(check['contests'])}", logged)
    return _allowed(payload, call, check, "contest", logged)


# --- what the sweepers answer ------------------------------------------------------------------------------

def owns(payload: dict) -> bool:
    return (payload.get("agent_type") in (briefs.SHIM_SWEEPER, briefs.SHIM_SITE_JUDGE)
            and "check_ref" in payload["tool_input"])


def _stored(ref) -> dict | None:
    """The check a ref names; refs carry a tree prefix, so it must name exactly one check of its repo."""
    parsed = shimcheck.parse_check_ref(ref)
    if parsed is None:
        return None
    repo, prefix = parsed
    trees = [tree for r, tree in ledger.shim_trees(prefix) if r == repo]
    if len(trees) != 1:
        return None
    with ledger.open_shims(repo) as shims:
        return shims.check(trees[0])


def _located_in_head(check: dict):
    def located(path: str) -> int | None:
        text = worktree.tree_text(check["root"], check["head"], path)
        return None if text is None else len(text.splitlines())
    return located


def _located_in_staged(check: dict):
    def located(path: str) -> int | None:
        text = worktree.tree_text(check["root"], check["tree"], path)
        return None if text is None else len(text.splitlines())
    return located


def _errors(payload: dict, check: dict) -> list[str]:
    body = payload["tool_input"]
    if payload["agent_type"] == briefs.SHIM_SWEEPER:
        if check["status"] != "sweeping":
            return [f"{check['ref']} takes no more sweeps"]
        return shimcheck.validate_sweep(body, _located_in_head(check))
    if check["status"] != "ruling" or body["site"] not in check["contests"]:
        return [f"site {body['site']} of {check['ref']} is not awaiting a ruling"]
    return shimcheck.validate_ruling(body, _located_in_staged(check),
                                     lambda issue: github.issue_state(check["repo"], issue))


def on_output(payload: dict) -> dict | None:
    body = payload["tool_input"]
    check = _stored(body.get("check_ref"))
    if check is None:
        errors = [f"check_ref {body.get('check_ref')!r} names no shim check; answer with the check_ref you were given"]
    else:
        try:
            errors = _errors(payload, check)
        except (KeyError, TypeError, AttributeError) as exc:
            # The harness checks the JSON Schema after this hook and sends an ill-shaped body back itself.
            record(payload, "shim-output", "ill-shaped", f"{type(exc).__name__}: {exc}")
            return None
    if not errors:
        return None
    record(payload, "shim-output", "deny", "; ".join(errors))
    return deny("Your output was rejected. Correct it and submit again:\n- " + "\n- ".join(errors))


def _merged(outputs: list[dict], name: str) -> list[dict]:
    """One entry per site id across every sweeper's list, the first sweeper's wording kept."""
    sites = {}
    for output in outputs:
        for site in output[name]:
            sites.setdefault(shimcheck.site_id(site["file"], site["function"]), site)
    return list(sites.values())


def _judge(check: dict, deadline: float) -> None:
    """Ask Jev `level` and `coverage` over the recorded lists less the sites ruled out of the bug, and compose the
    verdict (R6, R7, R8)."""
    if check["chain"]:
        with ledger.open_shims(check["repo"]) as shims:
            out = shimcheck.ruled_out(shims.rulings(check["chain"]))
        check["same_operation"] = [s for s in check["same_operation"]
                                   if shimcheck.site_id(s["file"], s["function"]) not in out]
    try:
        answers, cost = jev.ask_fix(check["diff"], check["same_operation"], check["callers"], deadline)
    except jev.JevError as exc:
        _finish(check, "failed", _failure(exc))
        return
    check["cost"]["jev_usd"] += cost
    check["level"], check["coverage"] = answers["level"], answers["coverage"]
    check["verdict"] = shimcheck.verdict(check["kind"], check["level"], check["coverage"],
                                         sites_left=bool(check["same_operation"]))
    _finish(check, "complete")


def _save(payload: dict, check: dict) -> None:
    """Store the check; one that completed settles the bug chains it reaches (R9), and logs the sites its list adds
    to one of them as the misses of the earlier checks (R12)."""
    found = []
    with ledger.open_shims(check["repo"]) as shims:
        shims.save_check(check)
        if check["status"] == "complete":
            before = {c["id"]: c for c in shims.chains_at(check["branch"], check["head"])}
            for chain in shimcheck.settled_chains(list(before.values()), check):
                # A refusal's list, or the deep sweep's whatever its verdict (FR-018).
                if chain["id"] in before and (check["verdict"] == "patch" or check["mode"] == "deep"):
                    found += [(chain["id"], sid, tree) for sid, tree in shimcheck.misses(before[chain["id"]], check)]
                shims.save_chain(chain)
    for chain_id, sid, tree in found:
        record(payload, "shim-miss", sid, f"chain {chain_id}: left out by {shimcheck.check_ref(check['repo'], tree)}",
               _logged(check["repo"], check["root"]))


def _logged_check(payload: dict, check: dict) -> None:
    cost = check["cost"]
    record(payload, "shim-check", check["verdict"] or check["status"],
           f"{check['ref']}: {check['mode']}, level {check['level']}, coverage {check['coverage']}, "
           f"{len(check['same_operation'])} sites, {cost['agents']} agents, {cost['seconds']} s, "
           f"${cost['jev_usd']:.4f}" + (f"; {check['reason']}" if check["reason"] else ""),
           _logged(check["repo"], check["root"]))


def _after_ruling(payload: dict) -> None:
    body = payload["tool_input"]
    found = _stored(body["check_ref"])
    repo, site = found["repo"], body["site"]
    with ledger.open_shims(repo) as shims:
        check = shims.check(found["tree"])
        ruling = {"ruling": body["ruling"], "reason": check["contests"].pop(site), "evidence": body["evidence"],
                  **({"issue": body["issue"]} if body["ruling"] == "deferred" else {})}
        shims.save_ruling(check["chain"], site, ruling)
        check["cost"]["agents"] += 1
        ready = not check["contests"]
        if ready:
            check["mode"], check["status"] = "rejudge", "judging"
        shims.save_check(check)
    record(payload, "shim-contest", body["ruling"], f"{check['ref']}: site {site}", _logged(repo, check["root"]))
    if not ready:
        return
    _judge(check, time.monotonic() + JEV_SECONDS)
    _save(payload, check)
    _logged_check(payload, check)


def after_output(payload: dict) -> None:
    if payload["agent_type"] == briefs.SHIM_SITE_JUDGE:
        _after_ruling(payload)
        return
    body = payload["tool_input"]
    found = _stored(body["check_ref"])
    repo = found["repo"]
    with ledger.open_shims(repo) as shims:
        check = shims.check(found["tree"])
        check["outputs"][payload.get("agent_id") or str(len(check["outputs"]))] = {
            name: body[name] for name in shimcheck.LISTS}
        check["cost"]["agents"] += 1
        ready = len(check["outputs"]) >= len(check["expected"])
        if ready:
            outputs = list(check["outputs"].values())
            check["same_operation"], check["callers"] = (_merged(outputs, name) for name in shimcheck.LISTS)
            check["status"] = "judging"
        shims.save_check(check)
    record(payload, "shim-output", "recorded", f"{check['ref']}: {check['status']}", _logged(repo, check["root"]))
    if not ready:
        return
    # Jev is asked outside the ledger's transaction, so other hooks are not held up for the call.
    _judge(check, time.monotonic() + JEV_SECONDS)
    _save(payload, check)
    _logged_check(payload, check)


# --- the user's override ----------------------------------------------------------------------------------

def _override_chain(chain_id: str) -> list[str]:
    overridden = []
    for repo in ledger.shim_chain_repos(chain_id):
        with ledger.open_shims(repo) as shims:
            chain = shims.chain(chain_id)
            chain["state"] = "overridden"
            shims.save_chain(chain)
        overridden.append(repo)
    return overridden


def _override_tree(prefix: str) -> list[str]:
    """Override the bugs of each staged tree the prefix names: every chain it reaches, or one seeded with its hunks."""
    overridden = []
    for repo, tree, root in ledger.checked_roots(prefix):
        where = worktree.locate(root)
        if where is None or worktree.staged_tree(root) != tree:
            continue
        hunks, labels = _hunks_and_labels(repo, root, tree, worktree.head_tree(root))
        # With no labels yet every hunk may be code, so every hunk marks the bug.
        code = shimcheck.swept(hunks, labels) if labels else hunks
        head = worktree.head_sha(root)
        with ledger.open_shims(repo) as shims:
            for chain in (shimcheck.matching_chains(shims.chains_at(where.branch, head), code)
                          or [shimcheck.new_chain(repo, where.branch, head, tree, code)]):
                shims.save_chain(dict(chain, state="overridden"))
        overridden.append(repo)
    return overridden


def on_prompt(payload: dict, typed: re.Match) -> dict:
    named = typed["id"]
    overridden = _override_chain(named) if len(named) == 16 else _override_tree(named)
    if overridden:
        record(payload, "shim-override", "overridden", f"shim-{named}: {', '.join(overridden)}")
        said = (f"The user switched the shim check off for bug shim-{named} in {', '.join(overridden)}: staged changes "
                "of that bug commit without the check until HEAD moves.")
    else:
        said = f"`{typed.group(0)}` names no bug the shim check knows, so nothing was switched off."
    return {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": f"[alq-review] {said}"}}
