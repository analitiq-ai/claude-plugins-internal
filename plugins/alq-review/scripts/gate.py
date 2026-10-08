#!/usr/bin/env python3
"""Hook entrypoint: one Claude Code hook payload on stdin, at most one decision on stdout.

In `log` mode every refusal is recorded and nothing is blocked. Two things act in both modes,
because the workflows cannot run without them: argument injection at workflow launch, and
validation of the structured output that lands in the ledger.
"""
from __future__ import annotations

import json
import os
import sys
import traceback
from dataclasses import dataclass
from functools import partial
from datetime import datetime, timedelta, timezone
from pathlib import Path

import assessment
import briefs
import claimgate
import config
import facts
import github
from hookio import deny, log_error, mode, record, refuse, refuse_spec, session_file, session_state, set_switch, switch_state
import ledger
import policy
from pre_merge_gate import PullRequest, first_line, first_words
import settled_design
import shimgate
import shell
import worktree

REVIEW_ROUND, ASSESS_ROUND = "alq-review:review-round", "alq-review:assess-round"
REVIEW_SKILLS = {"pr-review-toolkit:review-pr": "internal", "alq-anti-pattern:pr-audit": "audit"}  # -> the round they bypass
INFLIGHT_TTL = timedelta(minutes=45)   # a reviewer that never reported a stop must not block forever
# Claude Code also runs the skill by its bare name, while no other command has it.
RESCOPE_SKILLS = (f"/{policy.PLUGIN}:{policy.RESCOPE_SKILL}", f"/{policy.RESCOPE_SKILL}")


@dataclass(frozen=True)
class Target:
    """What one gate event is judged against: the PR a checkout's branch means, or the PR a command names.
    `branch` and `root` are known only when a checkout means that PR."""
    repo: str
    pr: int | None
    branch: str | None = None
    root: str | None = None


def track_subagent(payload: dict, now: datetime) -> None:
    if payload.get("agent_type") not in briefs.REVIEWERS:
        return
    with session_state(payload) as inflight:
        if payload["hook_event_name"] == "SubagentStart":
            inflight[payload["agent_id"]] = ledger.stamp(now)
        else:
            inflight.pop(payload["agent_id"], None)


def inflight_count(payload: dict, now: datetime) -> int:
    path = session_file(payload)
    if not path.exists():
        return 0
    oldest = ledger.stamp(now - INFLIGHT_TTL)
    return sum(1 for started in json.loads(path.read_text()).values() if started > oldest)


# --- which PR an event is judged against ------------------------------------------------------------

def pr_of(where: worktree.Worktree) -> int | None:
    """The PR a checkout means: its branch's open PR on GitHub. GitHub is asked only when a ledger names the branch,
    and once per commit once it names a PR. RuntimeError when it cannot answer: one of those ledgers may hold the
    branch."""
    if not ledger.names(where.slug, where.branch):
        return None

    def ask() -> int | None:
        found = github.pr_target(where.slug, where.branch)
        return found and found[0]
    return ledger.open_pr(where.slug, where.branch, worktree.head_sha(where.root), ask)


def target(where: worktree.Worktree | None, repo: str | None = None, pr: int | None = None) -> Target | None:
    """What an event is judged against: the checkout's PR (pr None when it has none, judged on an empty ledger), or
    the PR a command names, taken as named when the checkout does not mean it; None when there is neither a
    checkout of the repo nor a named PR. RuntimeError when GitHub cannot say the checkout's PR."""
    repo = repo or (where.slug if where else None)
    if repo is None:
        return None
    if where is not None and where.slug == repo:
        mine = pr_of(where)
        if pr in (None, mine):
            return Target(repo, mine, where.branch, where.root)
    return None if pr is None else Target(repo, pr)


def _unknown_pr(payload: dict, action: str, where: worktree.Worktree, exc: RuntimeError) -> dict | None:
    return refuse(payload, action, f"alq-review cannot tell which open PR {where.slug} {where.branch} has ({exc}), and "
                  "review ledgers name that branch, so it refuses rather than guess. Next step: check `gh auth status`, "
                  "then retry.", Target(where.slug, None, where.branch, where.root))


def decide(payload: dict, target: Target, rule, **facts_for_rule) -> policy.Decision:
    """Judging reads the ledger and never writes it; a PR with no ledger is judged on an empty one."""
    state = ledger.new_state(target.repo, None) if target.pr is None else ledger.read(target.repo, target.pr)
    return rule(state, inflight=inflight_count(payload, datetime.now(timezone.utc)), **facts_for_rule)


# --- the user hands a locked branch back ---------------------------------------------------------

def _names(state: dict, word: str) -> bool:
    """Whether `word`, typed after `unlock` or the rescope, means this locked PR: its branch, `#` and its number,
    or its name."""
    named = PullRequest.named(word)
    return (word in (state["branch"], f"#{state['pr']}")
            or (named is not None and named == PullRequest.named(f"{state['repo']}#{state['pr']}")))


def _rescope_brief(state: dict, ruling: dict) -> str:
    """What the alq-review:design-doc skill re-scopes from: the ruling, and the checkout whose spec folder it rewrites."""
    gaps = "; ".join(f"{f['mechanism']} ({f['spec_ref']})" for f in ruling["findings"] if f["kind"] == "spec_gap")
    return (f"Re-scope its spec from this RESHAPE_SPEC ruling. Worktree: {ledger.current_round(state)['root']}. Open decision: "
            f"{ruling['user_decision']} Why: {ruling['rationale']} Spec gaps: {gaps or 'none named'}.")


SWITCHED_OFF_WORKFLOWS = (REVIEW_ROUND, ASSESS_ROUND, claimgate.CHECK, shimgate.CHECK)


def _tell(event: str, said: str, user: bool = True) -> dict:
    out = {"hookSpecificOutput": {"hookEventName": event, "additionalContext": f"[alq-review] {said}"}}
    return {"systemMessage": f"[alq-review] {said}", **out} if user else out


def on_switch(payload: dict, line: str, switch: str) -> dict:
    """Answers a prompt whose first word is the plugin's name: `on` or `off` alone after it on that line is the
    switch, and anything else is told the two forms."""
    typed = first_words(line, 3)
    to = typed[1] if len(typed) == 2 else None
    line = line[:200]
    if to not in ("on", "off"):
        decision = "unknown"
        said = f'"{line}" is not a switch, so nothing changed. Type alq-review off or alq-review on.'
    elif switch == to:
        decision, said = "unchanged", f"alq-review was already {to}."
    else:
        set_switch(payload, to == "off", line)
        decision = to
        said = ("alq-review is off for this session. It stays off until the user types alq-review on. Its workflows "
                "do not run; carry on without them." if to == "off"
                else "alq-review is on again. Its rules apply from where its records stand.")
    record(payload, "switch", decision, line)
    return _tell("UserPromptSubmit", said)


def _unreadable_switch(payload: dict) -> dict:
    return {"systemMessage": "[alq-review] this session's switch file could not be opened or is not one the plugin "
            f"wrote, so the plugin counts as on ({session_file(payload, '.off')}; errors.log says which). Type "
            "alq-review off or alq-review on to rewrite it."}


def on_session_start(payload: dict, switch: str) -> dict | None:
    if switch == "unreadable":
        return _unreadable_switch(payload)
    if switch != "off":
        return None
    # A resume opens on the user's side of the screen; a compaction happens mid-turn, where only the agent lost it.
    return _tell("SessionStart", "alq-review is off in this session.", user=payload.get("source") != "compact")


def launch_while_off(payload: dict) -> dict | None:
    name = payload["tool_input"].get("name")
    if name not in SWITCHED_OFF_WORKFLOWS:
        return None
    # Refused in log mode too: the gate supplies these workflows' arguments, and off it supplies none.
    reason = (f"alq-review is off for this session, so {name} does not run. Carry on without it. Only the user turns "
              "it on, with alq-review on; do not ask them to.")
    record(payload, "workflow", "deny", reason)
    return deny(reason)


def on_prompt(payload: dict, switch: str) -> dict | None:
    """A typed command is a prompt's first words, each read whole: the cron bot's prompts quote issue and PR text
    anyone can write, and a word read in part is judged in part."""
    prompt = payload.get("prompt", "")
    if first_words(prompt, 1) == [policy.PLUGIN]:
        return on_switch(payload, first_line(prompt), switch)
    out = _on_release(payload, prompt)
    if switch == "unreadable":
        out = {**(out or {}), **_unreadable_switch(payload)}
    return out


def _on_release(payload: dict, prompt: str) -> dict | None:
    typed = first_words(prompt, 3)
    if len(typed) >= 2 and typed[0] == "unlock":
        return claimgate.on_prompt(payload, typed[1]) or _unlock(payload, typed[:2], rescope=False)
    if len(typed) >= 2 and typed[0] == "override":
        return shimgate.on_prompt(payload, typed[1])
    if len(typed) == 3 and typed[0] in RESCOPE_SKILLS and typed[1] == "rescope":
        return _unlock(payload, typed, rescope=True)
    return None


def _unlock(payload: dict, typed: list[str], rescope: bool) -> dict:
    """Answers an unlock or a rescope: releases the one locked branch its last word names."""
    typed_as = " ".join(typed)
    held = [state for state in ledger.all_states() if policy.locked(state)]
    named = [state for state in held if _names(state, typed[-1])]

    def refs(states):
        return ", ".join(f"{s['repo']}#{s['pr']}" for s in states)
    if len(named) == 1 and rescope and not policy.reshape_spec_ruling(named[0]):
        said = (f"`{typed_as}` releases only a RESHAPE_SPEC lock, and {refs(named)} is held for another reason, "
                f"so nothing was unlocked. Its release is `unlock {policy.unlock_ref(named[0])}`.")
    elif len(named) == 1:
        brief = _rescope_brief(named[0], policy.reshape_spec_ruling(named[0])) if rescope else ""
        with ledger.open_ledger(named[0]["repo"], named[0]["pr"]) as state:
            ledger.unlock(state, f"user prompt: {first_line(payload['prompt'])[:200]}", datetime.now(timezone.utc))
        said = f"The user unlocked {state['repo']}#{state['pr']} ({state['branch']}); its code may change again. {brief}".rstrip()
    elif named:
        command = policy.RESCOPE if rescope else "unlock"
        said = (f"`{command}` could mean {refs(named)}, so nothing was unlocked. Ask the user to repeat it naming the "
                f"repo: `{command} <owner>/<repo>#<number>`.")
    else:
        said = f"`{typed_as}` names no locked PR, so nothing was unlocked. Locked now: {refs(held) or 'none'}."
    return {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": f"[alq-review] {said}"}}


# --- a held branch does not move, whichever tool moves it ------------------------------------------

def _held(session: str) -> list[tuple[dict, str]]:
    """(ledger, checkout) of every PR whose code may not move now, where `session` launched its round and the
    checkout is still on the branch that means that PR. Reviewers in flight are left out: they hold every branch
    of their session, and only for minutes. Another session's command is not watched, since nothing ties a
    change in that checkout to it; its edits and git moves on the branch are still refused."""
    found = []
    for state in ledger.all_states():
        rnd = ledger.current_round(state)
        root = rnd and rnd.get("root")
        if (not root or rnd.get("session") != session or not os.path.isdir(root)
                or policy.mutation(state, inflight=0).allow):
            continue
        here = worktree.locate(root)
        if here is None or (here.slug, here.branch) != (state["repo"], state["branch"]):
            continue
        try:
            if pr_of(here) != state["pr"]:
                continue
        except RuntimeError:
            pass  # GitHub cannot say the checkout moved to another PR, so it stays watched
        found.append((state, root))
    return found


def _unwatched(root: str, exc: RuntimeError) -> str:
    return f"alq-review cannot verify {root}: {exc}. Nothing the command does there is watched."


def _unverified(root: str, paths) -> list[str]:
    if not paths:
        return []
    return [f"alq-review cannot verify {', '.join(sorted(paths))} in {root}; the branch tip and every other change "
            "there are still watched."]


def _contents_unverified(root: str, said: str | None) -> list[str]:
    if not said:
        return []
    return [f"alq-review cannot verify files in {root}: {said}; the branch tip is still watched."]


def _report(messages: list[str]) -> dict:
    return {"systemMessage": " ".join(messages)} if messages else {}


def hold(payload: dict) -> dict | None:
    """Before a Bash command: which checkouts it is judged against and what they look like, so afterwards
    nothing the command did can change which ones are compared. A checkout git cannot read is reported, not
    refused: the command itself was allowed."""
    held, messages = {}, []
    for state, root in _held(payload["session_id"]):
        try:
            snapshot = worktree.contents(root, state["branch"])
        except RuntimeError as exc:
            messages.append(_unwatched(root, exc))
            continue
        messages += _unverified(root, snapshot.unverified) + _contents_unverified(root, snapshot.contents_unverified)
        held[root] = {"repo": state["repo"], "branch": state["branch"], "why": policy.mutation(state, inflight=0).reason,
                      "snapshot": snapshot.to_json()}
    if held:
        with session_state(payload, ".held") as pending:
            pending[payload["tool_use_id"]] = held
    return _report(messages) or None


def after_bash(payload: dict) -> dict | None:
    with session_state(payload, ".held") as pending:
        before = pending.pop(payload["tool_use_id"], None)
    if not before:
        return None
    moves, messages = [], []
    for root, held in before.items():
        was = worktree.Snapshot.from_json(held["snapshot"])
        try:
            now = worktree.contents(root, held["branch"])
        except RuntimeError as exc:
            messages.append(_unwatched(root, exc))
            continue
        moved, unverified = worktree.compare(was, now)
        messages += _unverified(root, unverified) + _contents_unverified(root, now.contents_unverified or was.contents_unverified)
        if moved:
            tip = f" (its tip was {was.tip[:10]})" if "tip" in moved else ""
            moves.append(f"{held['repo']} {held['branch']} at {root}: {', '.join(moved)}{tip}. {held['why']}")
    out = _report(messages)
    if moves:
        record(payload, "bash-write", "caught", " | ".join(moves))
        out.update(decision="block", reason="[alq-review] That command changed a branch whose code may not move. " +
                   " ".join(moves) + " Put it back now: restore changed tracked files with `git checkout -- <file>`, delete "
                   "new untracked ones, and reset the branch to its old tip if it moved. Do not look for another way around the lock.")
    return out or None


# --- PreToolUse handlers -----------------------------------------------------------------------

def _inside(path: str, directory: Path) -> bool:
    return Path(path).resolve().is_relative_to(directory.resolve())


def on_edit(payload: dict) -> dict | None:
    path = payload["tool_input"].get("file_path") or payload["tool_input"].get("notebook_path")
    if not path:
        return None
    if _inside(path, ledger.state_root()):
        return refuse(payload, "state", "The review ledger is written by the gate only.")
    where = worktree.locate(path)
    if where is None:
        return None
    try:
        event = target(where)
    except RuntimeError as exc:
        return _unknown_pr(payload, "edit", where, exc)
    decision = decide(payload, event, policy.mutation)
    if decision.allow or worktree.is_ignored(where.root, path):
        return None
    return refuse(payload, "edit", decision.reason, event)


def on_bash(payload: dict) -> dict | None:
    command = payload["tool_input"].get("command", "")
    for action in shell.classify(command, payload.get("cwd") or os.getcwd()):
        if action.kind == "unlock":
            return refuse(payload, "unlock", "Only the user unlocks a branch. Tell them why it is locked and stop.")
        # A commit is claim-checked whether or not a PR is open.
        refused = action.kind == "commit" and (claimgate.on_commit(payload, action)
                                               or shimgate.on_commit(payload, action))
        if refused:
            return refused
        where = worktree.locate(action.cwd)
        try:
            event = target(where, action.repo, action.pr)
        except RuntimeError as exc:
            refused = _unknown_pr(payload, action.kind, where, exc)
            if refused:
                return refused
            continue
        if event is None:
            continue
        if action.kind == "ready":
            commit = worktree.head_sha(event.root) if event.root else (github.pr_head(event.repo, action.pr) or ("", ""))[1]
            decision = decide(payload, event, policy.mark_ready, head_sha=commit,
                              released=bool(commit) and github.released(event.repo, commit) is not None)
        elif action.kind == "rerequest":
            decision = decide(payload, event, policy.rerequest)
        else:
            decision = decide(payload, event, policy.mutation)
        if not decision.allow:
            refused = refuse(payload, action.kind, decision.reason, event)
            if refused:
                return refused
    return hold(payload)


def on_agent(payload: dict) -> dict | None:
    if payload.get("agent_id") or payload["tool_input"].get("subagent_type") not in briefs.INTERNAL_REVIEWERS:
        return None
    return refuse(payload, "dispatch",
                  "Reviewers run together behind a barrier and are assessed as one round; dispatched one by one, the "
                  f"first report gets fixed before the rest arrive. Next step: {policy.REVIEW_CALL % 'internal'}.")


def on_skill(payload: dict) -> dict | None:
    stage = REVIEW_SKILLS.get(payload["tool_input"].get("skill"))
    if stage is None:
        return None
    return refuse(payload, "dispatch", f"The {stage} review runs as a workflow, so its findings are assessed as one round "
                                       f"before anything is fixed. Next step: {policy.REVIEW_CALL % stage}.")


def _open_pr(where: worktree.Worktree) -> tuple[int, str]:
    """(number, branch it merges into) of the checkout's open PR, which every round is recorded against.
    RuntimeError, saying why and what to do, when there is none or GitHub cannot say."""
    try:
        found = github.pr_target(where.slug, where.branch)
    except RuntimeError as exc:
        raise RuntimeError(f"gh could not say which open PR {where.slug} {where.branch} has and which branch it merges "
                           f"into ({exc}), so no round can be recorded. Next step: check `gh auth status`, then launch "
                           "again.") from exc
    if found is None:
        raise RuntimeError(f"{where.slug} {where.branch} has no open PR, and a review round is recorded against its PR. "
                           "Next step: open the PR as a draft, then launch again.")
    return found


def _review_base(where: worktree.Worktree, target: str) -> str:
    """The commit a round's change is measured from; RuntimeError saying why when it cannot be read."""
    try:
        return worktree.review_base(where.root, target)
    except RuntimeError as exc:
        raise RuntimeError(f"The change under review is measured from {target} as the remote has it, and it could "
                           f"not be read: {exc}") from exc


def _spec_problems(root: str, base: str) -> str | None:
    """Why this branch's design is not settled (spec 004 FR-004); None when it is."""
    try:
        found = settled_design.branch_problems(root, base, config.load()["design_documents"])
    except Exception as exc:  # FR-021: a check that cannot run refuses what it was deciding
        return f"The settled-design check could not run: {type(exc).__name__}: {exc}"
    if not found:
        return None
    return ("The first internal round needs a settled design: a design-document change comes with a spec folder, "
            "and every mechanism its plan.md lists cites a research.md decision that says what was chosen, why, and "
            "the existing tools looked at. Then launch again.\n" + "\n".join(found))


def on_workflow(payload: dict) -> dict | None:
    call = payload["tool_input"]
    if call.get("name") == claimgate.CHECK:
        return claimgate.on_launch(payload, call)
    if call.get("name") == shimgate.CHECK:
        return shimgate.on_launch(payload, call)
    if call.get("name") not in (REVIEW_ROUND, ASSESS_ROUND):
        return None
    args = call.get("args") if isinstance(call.get("args"), dict) else {}
    root, stage = args.get("worktree"), args.get("stage", "internal")
    where = worktree.locate(root) if isinstance(root, str) and os.path.isabs(root) else None
    if where is None or stage not in ("internal", "audit"):
        return deny(f"{call['name']} needs args.worktree: the absolute path of the checkout under review, on its PR "
                    "branch, with a GitHub origin. For review-round, args.stage is 'internal' (default) or 'audit'.")
    now = datetime.now(timezone.utc)
    action = "assess" if call["name"] == ASSESS_ROUND else "launch"
    try:
        pr, merges_into = _open_pr(where)
    except RuntimeError as exc:
        return refuse(payload, action, str(exc), Target(where.slug, None, where.branch, where.root))
    event = Target(where.slug, pr, where.branch, where.root)
    head = worktree.head_sha(where.root)
    with ledger.open_checkouts_ledger(where.slug, pr, where.branch, head) as state:
        if call["name"] == ASSESS_ROUND:
            decision = policy.launch_assess(state)
            if not decision.allow:
                return refuse(payload, action, decision.reason, event)
            rnd = ledger.current_round(state)
            if rnd["base_sha"] is None:
                try:
                    rnd["base_sha"] = _review_base(where, merges_into)
                except RuntimeError as exc:
                    return refuse(payload, action, str(exc), event)
            rnd.update(root=where.root, session=payload["session_id"])
            injected = briefs.assess_args(state, rnd, where)
        else:
            decision = policy.launch_round(state, stage, head_sha=head,
                                           dirty=worktree.is_dirty(where.root), inflight=inflight_count(payload, now))
            if not decision.allow:
                refused = refuse(payload, action, decision.reason, event)
                if refused:
                    return refused
            try:
                base = _review_base(where, merges_into)
            except RuntimeError as exc:
                return refuse(payload, action, str(exc), event)
            if stage == "internal" and policy.first_internal_round(state):
                unsettled = _spec_problems(where.root, base)
                if unsettled:
                    refused = refuse_spec(payload, action, unsettled, event)
                    if refused:
                        return refused
            spec = None
            if stage == "internal":
                try:
                    spec = briefs.branch_spec(where.slug, where.branch)
                except RuntimeError as exc:
                    refused = refuse(payload, action, f"The spec of this branch's issue could not be settled: {exc}. "
                                     "Next step: check `gh auth status`, or leave exactly one spec comment on the "
                                     "issue, then launch again.", event)
                    if refused:
                        return refused
            waves = briefs.AUDIT_WAVES if stage == "audit" else [briefs.INTERNAL_REVIEWERS]
            rnd = ledger.open_round(state, stage, head_sha=head,
                                    base_sha=base, scope=decision.scope or "full",
                                    expected=[t for wave in waves for t in wave], escalation=decision.escalation, now=now)
            rnd.update(root=where.root, session=payload["session_id"])
            injected = briefs.review_args(state, rnd, where, decision, spec)
    record(payload, "launch", "allow", rnd["ref"], event)
    # "allow" doubles as the permission a headless run needs to start a workflow at all.
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "allow",
                                   "updatedInput": dict(call, args=injected)}}


def _round_output(payload: dict) -> tuple[str, str] | None:
    """(round_ref, agent_type) when this StructuredOutput call belongs to a review round."""
    ref = payload["tool_input"].get("round_ref")
    if isinstance(ref, str) and ledger.ROUND_REF.fullmatch(ref):
        return ref, str(payload.get("agent_type"))
    return None


def _awaits(rnd: dict, agent_type: str) -> bool:
    if agent_type == briefs.ASSESSOR:
        return rnd["status"] == "awaiting_assessment"
    return agent_type in rnd["expected"] and rnd["status"] == "collecting"


def _misdirected(session: str, ref: str, agent_type: str, rnd: dict | None) -> str:
    """Why `ref` is not `agent_type`'s round, and which ref is: the agent wrote the ref, but only the session ties
    it to the round that dispatched it."""
    what = f"{ref} names no round" if rnd is None else f"{agent_type} has nothing to submit to {ref} while it is {rnd['status']}"
    awaiting = [r["ref"] for state in ledger.all_states() for r in state["rounds"]
                if r.get("session") == session and _awaits(r, agent_type)]
    if not awaiting:
        return f"{what}, and no round launched in this session awaits output from {agent_type}"
    expected = awaiting[0] if len(awaiting) == 1 else f"one of {', '.join(awaiting)}"
    return f"{what}; round_ref must be {expected}, as your prompt gives it"


def on_structured_output(payload: dict) -> dict | None:
    if claimgate.owns(payload):
        return claimgate.on_output(payload)
    if shimgate.owns(payload):
        return shimgate.on_output(payload)
    found = _round_output(payload)
    if found is None:
        return None
    ref, agent_type = found
    body = payload["tool_input"]
    # Read, not opened: a ref naming the wrong PR must not create that PR's ledger.
    state = ledger.read(*ledger.parse_ref(ref))
    rnd = ledger.named_round(state, ref)
    if rnd is None or not _awaits(rnd, agent_type):
        validate, errors = None, [_misdirected(payload["session_id"], ref, agent_type, rnd)]
    elif agent_type == briefs.ASSESSOR:
        measured = facts.round_facts(state, rnd, rnd["root"])
        admissible = policy.admissible_verdicts(rnd, churned=bool(measured["files_at_third_edit"]))
        finding_ids, token = [f["id"] for f in rnd["findings"]], briefs.brief_token(rnd)
        validate = partial(assessment.validate_assessment, finding_ids=finding_ids, admissible=admissible,
                           burden=measured["burden"], token=token)
    else:
        validate = partial(assessment.validate_report, short=briefs.short(agent_type))
    if validate:
        try:
            errors = validate(body)
        except (KeyError, TypeError) as exc:
            # The harness checks the JSON Schema after this hook and sends an ill-shaped body back itself.
            record(payload, "output", "ill-shaped", f"{type(exc).__name__}: {exc}")
            return None
    if not errors:
        return None
    record(payload, "output", "deny", "; ".join(errors))
    return deny("Your output was rejected. Correct it and submit again:\n- " + "\n- ".join(errors))


def after_structured_output(payload: dict) -> None:
    if claimgate.owns(payload):
        return claimgate.after_output(payload)
    if shimgate.owns(payload):
        return shimgate.after_output(payload)
    found = _round_output(payload)
    if found is None:
        return
    ref, agent_type = found
    now = datetime.now(timezone.utc)
    with ledger.open_ledger(*ledger.parse_ref(ref)) as state:
        if agent_type == briefs.ASSESSOR:
            rnd = ledger.record_assessment(state, ref, payload["tool_input"], now)
        else:
            rnd = ledger.record_report(state, ref, agent_type, payload["tool_input"], now)
    record(payload, "output", "recorded", f"{ref} is {rnd['status']}")


PRE = {"Edit": on_edit, "Write": on_edit, "NotebookEdit": on_edit, "Bash": on_bash, "Agent": on_agent,
       "Skill": on_skill, "Workflow": on_workflow, "StructuredOutput": on_structured_output,
       "WebFetch": claimgate.on_webfetch}


def handle(payload: dict) -> dict | None:
    switch = switch_state(payload)
    off = switch == "off"
    if not off:
        ledger.ingest_inbox(datetime.now(timezone.utc))
    event = payload["hook_event_name"]
    if event == "UserPromptSubmit":
        return on_prompt(payload, switch)
    if event == "SessionStart":
        return on_session_start(payload, switch)
    if off and event not in ("SubagentStart", "SubagentStop"):
        # Off, no rule judges. What is left keeps the plugin's own agents confined and its workflows from
        # starting without the arguments the gate gives them.
        if event == "PreToolUse" and payload["tool_name"] == "WebFetch":
            return claimgate.on_webfetch(payload)
        if event == "PreToolUse" and payload["tool_name"] == "Workflow":
            return launch_while_off(payload)
        return None
    if event == "PostToolUse" and payload["tool_name"] == "Bash":
        return after_bash(payload)
    if event in ("SubagentStart", "SubagentStop"):
        return track_subagent(payload, datetime.now(timezone.utc))
    if event == "PreToolUse" and payload["tool_name"] in PRE:
        return PRE[payload["tool_name"]](payload)
    if event == "PostToolUse" and payload["tool_name"] == "StructuredOutput":
        return after_structured_output(payload)
    return None


def _refuses(payload: dict) -> bool:
    """Whether this call was one the gate might have refused.

    Everywhere else the gate only records, so a crash there must not stand between a session and
    its work. Here it was deciding, and a decision it never reached must not be read as a yes.
    """
    if payload.get("hook_event_name") != "PreToolUse" or payload.get("tool_name") not in PRE:
        return False
    try:
        return mode() == "enforce"
    except Exception:
        return True  # a gate that cannot read its own mode is not one to trust with a yes


def main() -> None:
    payload = json.load(sys.stdin)
    try:
        out = handle(payload)
    except Exception as exc:  # a broken gate must never stall a session; it says so instead
        trace = traceback.format_exc()
        print(trace, file=sys.stderr)
        try:
            log_error(f"{payload.get('tool_name')}\n{trace}")
        except OSError:
            pass  # the trace is already on stderr
        where = payload.get("tool_name") or payload.get("hook_event_name")
        if _refuses(payload):
            out = deny(f"the gate crashed deciding this {where}, so it refuses rather than letting it through "
                       f"unchecked: {type(exc).__name__}: {exc}. The trace is in "
                       f"{ledger.state_root() / 'errors.log'}. To work while it is broken, set ALQ_REVIEW_MODE=log.")
        else:
            out = {"systemMessage": f"alq-review gate failed open on {where}: {type(exc).__name__}: {exc}"}
    if out:
        print(json.dumps(out))


if __name__ == "__main__":
    main()
