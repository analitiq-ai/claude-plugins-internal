#!/usr/bin/env python3
"""Hook entrypoint: one Claude Code hook payload on stdin, at most one decision on stdout.

In `log` mode every refusal of a rule is recorded and nothing is blocked. What the workflows
cannot run without acts in both modes: argument injection at workflow launch, the refusal of a
launch whose round cannot open, and validation of the structured output that lands in the ledger.
"""
from __future__ import annotations

import json
import os
import sys
import time
import traceback
from dataclasses import dataclass, replace
from functools import partial
from datetime import datetime, timedelta, timezone
from pathlib import Path

import adrkit
import assessment
import briefs
import claimgate
import decisions
import facts
import github
from hookio import (block, block_decision, claim_checks_mode, deny, escalate_to, log_error, max_review_files, mode,
                    record, refuse, refuse_decision, session_file, session_state, set_switch, shim_checks_mode,
                    switch_state)
import ledger
import policy
from pre_merge_gate import PullRequest, first_line, first_words
import reshape
import shimgate
import shell
import specbinding
import worktree

REVIEW_ROUND, ASSESS_ROUND = "reviewer:review-round", "reviewer:assess-round"
ROUND_WORKFLOWS = (REVIEW_ROUND, ASSESS_ROUND)
REVIEW_SKILLS = {"pr-review-toolkit:review-pr": "internal", "auditor:pr-audit": "audit"}  # -> the round they bypass
INFLIGHT_TTL = timedelta(minutes=45)   # a reviewer that never reported a stop must not block forever
HOOK_SECONDS = 60   # hooks/hooks.json's timeout for this hook: Claude Code kills it then
ANSWER_MARGIN = 5   # left after the last adrkit call to write the ledger, gate.log and the answer


def deadline(started: float) -> adrkit.Deadline:
    """When every adrkit call of a hook run that started at `started`, a `time.monotonic()`, must end."""
    return adrkit.Deadline(started + HOOK_SECONDS - ANSWER_MARGIN, HOOK_SECONDS - ANSWER_MARGIN)


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
    return refuse(payload, action, f"reviewer cannot tell which open PR {where.slug} {where.branch} has ({exc}), and "
                  "review ledgers name that branch, so it refuses rather than guess. Next step: check `gh auth status`, "
                  "then retry.", Target(where.slug, None, where.branch, where.root))


def decide(payload: dict, target: Target, rule, **facts_for_rule) -> policy.Decision:
    """Judging reads the ledger and never writes it; a PR with no ledger is judged on an empty one."""
    state = ledger.new_state(target.repo, None) if target.pr is None else ledger.read(target.repo, target.pr)
    return rule(state, inflight=inflight_count(payload, datetime.now(timezone.utc)), **facts_for_rule)


# --- the user hands a locked branch back ---------------------------------------------------------

def _names(state: dict, word: str) -> bool:
    """Whether `word`, typed after `unlock`, means this locked PR: its branch, `#` and its number, or its name."""
    named = PullRequest.named(word)
    return (word in (state["branch"], f"#{state['pr']}")
            or (named is not None and named == PullRequest.named(f"{state['repo']}#{state['pr']}")))


def _reshape_brief(state: dict, ruling: dict) -> str:
    """The RESHAPE_SPEC ruling the user carries to planning, and what its notice on the spec's issue failed to do."""
    folder = briefs.spec_folder(state)
    if folder is None:
        return (f"It was held by a RESHAPE_SPEC ruling. Open decision: {ruling['user_decision']} This PR has no spec. "
                "Close it and restart the work on a new PR bound to a spec that settles this decision.")
    failed = reshape.notice_failures(state["repo"], ledger.current_round(state))
    return f"It was held by a RESHAPE_SPEC ruling. {reshape.summary(folder, ruling)} {failed}".rstrip()


SWITCHED_OFF_WORKFLOWS = (*ROUND_WORKFLOWS, claimgate.CHECK, shimgate.CHECK)


def _tell(event: str, said: str, user: bool = True) -> dict:
    out = {"hookSpecificOutput": {"hookEventName": event, "additionalContext": f"[reviewer] {said}"}}
    return {"systemMessage": f"[reviewer] {said}", **out} if user else out


def on_switch(payload: dict, line: str, switch: str) -> dict:
    """Answers a prompt whose first word is the plugin's name: `on` or `off` alone after it on that line is the
    switch, and anything else is told the two forms."""
    typed = first_words(line, 3)
    to = typed[1] if len(typed) == 2 else None
    line = line[:200]
    if to not in ("on", "off"):
        decision = "unknown"
        said = f'"{line}" is not a switch, so nothing changed. Type reviewer off or reviewer on.'
    elif switch == to:
        decision, said = "unchanged", f"reviewer was already {to}."
    else:
        set_switch(payload, to == "off", line)
        decision = to
        said = ("reviewer is off for this session. It stays off until the user types reviewer on. Its workflows "
                "do not run; carry on without them." if to == "off"
                else "reviewer is on again. Its rules apply from where its records stand.")
    record(payload, "switch", decision, line)
    return _tell("UserPromptSubmit", said)


def _unreadable_switch(payload: dict) -> dict:
    return {"systemMessage": "[reviewer] this session's switch file could not be opened or is not one the plugin "
            f"wrote, so the plugin counts as on ({session_file(payload, '.off')}; errors.log says which). Type "
            "reviewer off or reviewer on to rewrite it."}


def on_session_start(payload: dict, switch: str) -> dict | None:
    if switch == "unreadable":
        return _unreadable_switch(payload)
    if switch != "off":
        return None
    # A resume opens on the user's side of the screen; a compaction happens mid-turn, where only the agent lost it.
    return _tell("SessionStart", "reviewer is off in this session.", user=payload.get("source") != "compact")


def launch_while_off(payload: dict) -> dict | None:
    name = payload["tool_input"].get("name")
    if name not in SWITCHED_OFF_WORKFLOWS:
        return None
    # Refused in log mode too: the gate supplies these workflows' arguments, and off it supplies none.
    reason = (f"reviewer is off for this session, so {name} does not run. Carry on without it. Only the user turns "
              "it on, with reviewer on; do not ask them to.")
    return block(payload, "workflow", reason)


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
    typed = first_words(prompt, 2)
    if len(typed) == 2 and typed[0] == "unlock":
        return claimgate.on_prompt(payload, typed[1]) or _unlock(payload, typed[1])
    if len(typed) == 2 and typed[0] == "override":
        return shimgate.on_prompt(payload, typed[1])
    return None


def _unlock(payload: dict, ref: str) -> dict:
    """Answers `unlock <ref>`: releases the one locked branch `ref` names."""
    held = [state for state in ledger.all_states() if policy.locked(state)]
    named = [state for state in held if _names(state, ref)]

    def refs(states):
        return ", ".join(f"{s['repo']}#{s['pr']}" for s in states)
    if len(named) == 1:
        # Read before the release: once unlocked, no ruling holds the branch.
        ruling = policy.reshape_spec_ruling(named[0])
        brief = _reshape_brief(named[0], ruling) if ruling else ""
        with ledger.open_ledger(named[0]["repo"], named[0]["pr"]) as state:
            ledger.unlock(state, f"user prompt: {first_line(payload['prompt'])[:200]}", datetime.now(timezone.utc))
        said = f"The user unlocked {state['repo']}#{state['pr']} ({state['branch']}); its code may change again. {brief}".rstrip()
    elif named:
        said = (f"`unlock` could mean {refs(named)}, so nothing was unlocked. Ask the user to repeat it naming the "
                "repo: `unlock <owner>/<repo>#<number>`.")
    else:
        said = f"`unlock {ref}` names no locked PR, so nothing was unlocked. Locked now: {refs(held) or 'none'}."
    return {"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext": f"[reviewer] {said}"}}


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
    return f"reviewer cannot verify {root}: {exc}. Nothing the command does there is watched."


def _unverified(root: str, paths) -> list[str]:
    if not paths:
        return []
    return [f"reviewer cannot verify {', '.join(sorted(paths))} in {root}; the branch tip and every other change "
            "there are still watched."]


def _contents_unverified(root: str, said: str | None) -> list[str]:
    if not said:
        return []
    return [f"reviewer cannot verify files in {root}: {said}; the branch tip is still watched."]


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
        out.update(decision="block", reason="[reviewer] That command changed a branch whose code may not move. " +
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
    # Judged on the branch and the path alone, before `target` can ask GitHub: a story branch with no PR yet is held to it.
    # The written file is the link's target, and one outside the checkout is no spec.md of it.
    written, root = Path(path).resolve(), Path(where.root).resolve()
    spec_edit = written.is_relative_to(root) and specbinding.story_edit_refusal(where.branch,
                                                                                 written.relative_to(root).as_posix())
    if spec_edit:
        refused = refuse(payload, "spec-edit", spec_edit, Target(where.slug, None, where.branch, where.root))
        if refused:
            return refused
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
    if (payload.get("agent_id")
            or payload["tool_input"].get("subagent_type") not in (*briefs.INTERNAL_REVIEWERS, briefs.DECISION_REVIEWER)):
        return None
    return refuse(payload, "dispatch",
                  "Reviewers run together behind a barrier and are assessed as one round; dispatched one by one, the "
                  f"first report gets fixed before the rest arrive. Next step: {policy.review_call(None, 'internal')}.")


def on_skill(payload: dict) -> dict | None:
    stage = REVIEW_SKILLS.get(payload["tool_input"].get("skill"))
    if stage is None:
        return None
    return refuse(payload, "dispatch", f"The {stage} review runs as a workflow, so its findings are assessed as one round "
                                       f"before anything is fixed. Next step: {policy.review_call(None, stage)}.")


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


def _delta_start(where: worktree.Worktree, decision: policy.Decision, base: str) -> policy.Decision:
    """A delta round diffs from the last reviewed head as it would be once it merged `base`: what the base branch
    brought in since that round is not the branch's work. RuntimeError saying why when git cannot merge them."""
    if decision.scope != "delta":
        return decision
    try:
        return replace(decision, delta_from=worktree.merged(where.root, decision.delta_from, base))
    except RuntimeError as exc:
        raise RuntimeError(f"The change since the last round is measured from its head {decision.delta_from[:7]} "
                           f"merged with {base[:7]}, and that merge could not be made: {exc}") from exc


@dataclass(frozen=True)
class SpecStep:
    """What a launch's spec check does to its PR's binding: the fields the save that lets the launch through sets,
    or the refusal, with the hold a changed spec.md puts on the PR once that refusal blocks."""
    binds: dict
    refusal: str | None = None
    holds: dict | None = None


def _spec_md_blob(root: str, head: str, folder: str) -> str | None:
    """The blob id of `folder`/spec.md at commit `head`; None when it is missing or empty there. RuntimeError, in
    git's words, when git cannot say."""
    path = f"{folder}/spec.md"
    for entry in worktree.git(root, "ls-tree", "-l", "-z", head, "--", path).split("\0"):
        meta, _, name = entry.partition("\t")
        if name == path:
            _, kind, blob, size = meta.split()
            return blob if kind == "blob" and size != "0" else None
    return None


def _head_spec_md(root: str, head: str, folder: str, restore: str) -> tuple[str | None, str | None]:
    """(the blob id of `folder`/spec.md at `head`, None), or (None, the refusal) when it is missing, empty or git
    cannot read it. `restore` is the next step when it is missing or empty."""
    try:
        blob = _spec_md_blob(root, head, folder)
    except RuntimeError as exc:
        return None, f'Step "spec.md": git could not read {folder}/spec.md at {head}: {exc}'
    if blob is None:
        return None, (f'Step "spec.md": {folder}/spec.md is missing or empty at {head}, the commit this round '
                      f"reviews, and the round is reviewed against it. Next step: {restore}.")
    return blob, None


def _spec_text(state: dict, root: str, head: str, head_blob: str) -> SpecStep:
    """HEAD's spec.md of the PR's bound folder, `head_blob`, against the text the PR is bound to."""
    bound, held = state["spec_blob"], state.get("spec_held")
    step = specbinding.text_step(bound, head_blob, None if held is None else held["at"], state["unlocked_at"])
    if step == "same":
        return SpecStep({})
    if step == "bind":
        return SpecStep({"spec_blob": head_blob})
    try:
        shown = worktree.diff(root, bound, head_blob)
    except RuntimeError as exc:
        # The blob ids already show the text changed; the diff only shows how.
        shown = f"git could not make the diff: {exc}"
    return SpecStep({}, f"{state['spec']}/spec.md at {head} is not the text this PR was bound to (blob {bound}, now "
                        f"{head_blob}):\n{shown}\nA PR is reviewed against the spec it was bound to, so it is held until "
                        "the user releases it. Stop and ask the user whether this PR now builds to the changed spec; they "
                        f"release it by starting their next prompt with `unlock {policy.unlock_ref(state)}`.",
                    holds={"bound": bound, "head": head_blob})


def _spec_step(args: dict, state: dict, stage: str, root: str, head: str) -> SpecStep:
    """A review-round launch's `spec`, checked in this order: present, null or a non-empty string, the folder's
    shape, the PR's binding, its spec.md at `head` (the commit the round reviews), then the bound text."""
    review_call = policy.review_call(state, stage)
    if "spec" not in args:
        return SpecStep({}, "args.spec is missing: a review round names the spec folder its PR is reviewed against, "
                            f"or null for a change that needs no spec. Next step: {review_call}.")
    try:
        given = specbinding.parse(args["spec"])
    except ValueError as exc:
        return SpecStep({}, f"{exc}. Next step: {review_call}.")
    value = given.path if isinstance(given, specbinding.Folder) else None
    if value is not None:
        problem = specbinding.shape_problem(value)
        if problem:
            return SpecStep({}, f'Step "shape": {problem}. Next step: name the spec folder by its path from the repo '
                                f"root, {review_call}.")
    if "spec" in state:
        other = specbinding.bind(state["spec"], value)
        if other:
            return SpecStep({}, other)
    if value is None:
        return SpecStep({} if "spec" in state else {"spec": None, "spec_blob": None})
    head_blob, unread = _head_spec_md(root, head, value, f"commit it, then {review_call}")
    if unread:
        return SpecStep({}, unread)
    if "spec" not in state:
        return SpecStep({"spec": value, "spec_blob": head_blob})
    return _spec_text(state, root, head, head_blob)


def _assess_spec_step(state: dict, root: str, head: str) -> SpecStep:
    """An assess-round launch's check of the bound spec.md at `head`; a PR bound to null or to nothing has none."""
    folder = state.get("spec")
    if folder is None:
        return SpecStep({})
    # A round awaiting assessment lets no agent commit, so only the user can put spec.md back.
    head_blob, unread = _head_spec_md(root, head, folder,
                                      "stop and ask the user to restore it with a commit of their own")
    if unread:
        return SpecStep({}, unread)
    return _spec_text(state, root, head, head_blob)


def _refuse_spec(payload: dict, action: str, spec: SpecStep, event: Target, state: dict, now: datetime) -> dict | None:
    """Refuses a launch by its spec check, recording the hold it puts on the PR once the refusal blocks."""
    refused = refuse(payload, action, spec.refusal, event)
    if refused and spec.holds:
        state.setdefault("spec_held", dict(spec.holds, at=ledger.stamp(now)))
    return refused


def _admit_spec(state: dict, spec: SpecStep) -> None:
    """Saves the binding of a launch that got through. A spec check that passed spends any hold, so the next change
    is held again; one log mode let past spends nothing, as it put nothing on."""
    if spec.refusal is None:
        state.update(spec.binds)
        state.pop("spec_held", None)


def _governance(payload: dict, action: str, event: Target, where: worktree.Worktree, decision: policy.Decision,
                base: str, deadline: adrkit.Deadline, spent: dict[str, float]) -> tuple[dict | None, dict | None]:
    """An internal round's decision check: (its `decisions` block, None), or (None, the refusal that blocks the
    launch). The refusals are taken in data-model order; one that does not block lets the round open on what was read."""
    files = worktree.files_in(where.root, briefs.review_range(decision, base))
    found = adrkit.corpora(where.root)
    limit = max_review_files()
    if len(files) > limit:
        reason = decisions.too_big(len(files), limit, decision.scope)
        refused = refuse(payload, action, reason, event)
        if refused:
            return None, refused
        checked = [decisions.NotChecked(c, decisions.TOO_BIG, reason) for c in found.corpora]
    else:
        checked = adrkit.check(where.root, found.corpora, files, deadline, spent)
    outcomes = checked + found.not_checked
    for reason, refusal in ((decisions.not_checked_refusal(outcomes), block_decision),
                            (decisions.broken_refusal(outcomes), refuse_decision)):
        refused = reason and refusal(payload, action, reason, event)
        if refused:
            return None, refused
    return decisions.result(outcomes, found.org_corpus), None


def on_workflow(payload: dict, deadline: adrkit.Deadline) -> dict | None:
    call = payload["tool_input"]
    if call.get("name") == claimgate.CHECK:
        return claimgate.on_launch(payload, call)
    if call.get("name") == shimgate.CHECK:
        return shimgate.on_launch(payload, call)
    if call.get("name") not in ROUND_WORKFLOWS:
        return None
    args = call.get("args") if isinstance(call.get("args"), dict) else {}
    root, stage = args.get("worktree"), args.get("stage", "internal")
    where = worktree.locate(root) if isinstance(root, str) and os.path.isabs(root) else None
    if where is None or stage not in ("internal", "audit"):
        return deny(f"{call['name']} needs args.worktree: the absolute path of the checkout under review, on its PR "
                    "branch, with a GitHub origin. For review-round, args.stage is 'internal' (default) or 'audit'.")
    now = datetime.now(timezone.utc)
    action = "assess" if call["name"] == ASSESS_ROUND else "launch"
    started = time.monotonic()
    try:
        pr, merges_into = _open_pr(where)
    except RuntimeError as exc:
        return block(payload, action, str(exc), Target(where.slug, None, where.branch, where.root))
    spent = {"gh calls": time.monotonic() - started}
    event = Target(where.slug, pr, where.branch, where.root)
    head = worktree.head_sha(where.root)
    with ledger.open_checkouts_ledger(where.slug, pr, where.branch, head) as state:
        if call["name"] == ASSESS_ROUND:
            decision = policy.launch_assess(state)
            if not decision.allow:
                return block(payload, action, decision.reason, event)
            spec = _assess_spec_step(state, where.root, head)
            if spec.refusal:
                refused = _refuse_spec(payload, action, spec, event, state, now)
                if refused:
                    return refused
            rnd = ledger.current_round(state)
            if rnd["base_sha"] is None:
                try:
                    rnd["base_sha"] = _review_base(where, merges_into)
                except RuntimeError as exc:
                    return block(payload, action, str(exc), event)
            _admit_spec(state, spec)
            rnd.update(root=where.root, session=payload["session_id"])
            injected = briefs.assess_args(state, rnd, where)
        else:
            spec = _spec_step(args, state, stage, where.root, head)
            if spec.refusal:
                refused = _refuse_spec(payload, action, spec, event, state, now)
                if refused:
                    return refused
            decision = policy.launch_round(state, stage, head_sha=head,
                                           dirty=worktree.is_dirty(where.root), inflight=inflight_count(payload, now))
            if not decision.allow:
                refused = refuse(payload, action, decision.reason, event)
                if refused:
                    return refused
            started = time.monotonic()
            try:
                base = _review_base(where, merges_into)
                spent["review-base fetch"] = time.monotonic() - started
                started = time.monotonic()
                decision = _delta_start(where, decision, base)
                spent["merge of the last reviewed head"] = time.monotonic() - started
            except RuntimeError as exc:
                return block(payload, action, str(exc), event)
            governance = None
            if stage == "internal":
                governance, refused = _governance(payload, action, event, where, decision, base, deadline, spent)
                if refused:
                    return refused
            waves = briefs.waves(stage, governance)
            rnd = ledger.open_round(state, stage, head_sha=head,
                                    base_sha=base, scope=decision.scope or "full",
                                    expected=[t for wave in waves for t in wave], escalation=decision.escalation, now=now)
            rnd.update(root=where.root, session=payload["session_id"])
            _admit_spec(state, spec)
            injected = briefs.review_args(state, rnd, where, decision, briefs.bound_spec(state), governance)
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


def _checked_output(payload: dict) -> bool:
    """Whether this StructuredOutput call is one the gate checks: a claim or shim check's, or a review round's."""
    return claimgate.owns(payload) or shimgate.owns(payload) or _round_output(payload) is not None


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
    owed = None
    with ledger.open_ledger(*ledger.parse_ref(ref)) as state:
        if agent_type == briefs.ASSESSOR:
            rnd = ledger.record_assessment(state, ref, payload["tool_input"], now)
            folder = briefs.spec_folder(state)
            if rnd["assessment"]["round_verdict"] == "RESHAPE_SPEC" and folder is not None:
                owed = ledger.claim_notice(state, ref, reshape.notice(folder))
        else:
            rnd = ledger.record_report(state, ref, agent_type, payload["tool_input"], now)
    record(payload, "output", "recorded", f"{ref} is {rnd['status']}")
    if agent_type == briefs.ASSESSOR and briefs.DECISION_REVIEWER in rnd["expected"]:
        # Read without the transcript, the rulings say whether the decision reviewer's brief is right.
        raised = {f["id"] for f in rnd["findings"] if f["reviewer"] == briefs.DECISION_REVIEWER}
        rulings = [{"id": f["id"], "verdict": f["verdict"]} for f in payload["tool_input"]["findings"] if f["id"] in raised]
        record(payload, "decision-review", "assessed", json.dumps(rulings),
               Target(state["repo"], state["pr"], state["branch"]))
    # Last: its gh calls may run out the hook's time, and nothing recorded above should wait on them.
    if owed is not None and owed["issue"] is not None:
        _post_notice(ref, state["repo"], owed["issue"], reshape.comment(folder, state["pr"], rnd))


def _post_notice(ref: str, slug: str, issue: int, body: str) -> None:
    """Tells the spec's issue of round `ref`'s RESHAPE_SPEC ruling: one comment, then one edit whatever the comment's
    answer, each tried once. Outside any ledger transaction: each gh call may take its whole timeout."""
    answers = {}
    try:
        github.comment_issue(slug, issue, body)
        answers["comment"] = {"done": True}
    except RuntimeError as exc:
        answers["comment"] = {"error": str(exc)}
    try:
        github.escalate_issue(slug, issue, reshape.LABEL, escalate_to())
        answers["edit"] = {"done": True}
    except (RuntimeError, ValueError) as exc:
        answers["edit"] = {"error": str(exc)}
    with ledger.open_ledger(*ledger.parse_ref(ref)) as state:
        ledger.record_notice(state, ref, answers)


PRE = {"Edit": on_edit, "Write": on_edit, "NotebookEdit": on_edit, "Bash": on_bash, "Agent": on_agent,
       "Skill": on_skill, "StructuredOutput": on_structured_output, "WebFetch": claimgate.on_webfetch}
# Every tool the gate decides on: a launch's decision check also runs against the hook's deadline.
DECIDED = (*PRE, "Workflow")


def handle(payload: dict, deadline: adrkit.Deadline) -> dict | None:
    """`deadline`: when a round launch's decision check must end."""
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
    if event == "PreToolUse" and payload["tool_name"] == "Workflow":
        return on_workflow(payload, deadline)
    if event == "PreToolUse" and payload["tool_name"] in PRE:
        return PRE[payload["tool_name"]](payload)
    if event == "PostToolUse" and payload["tool_name"] == "StructuredOutput":
        return after_structured_output(payload)
    return None


def _past_a_crash(payload: dict) -> str | None:
    """How to work past a crash deciding this call, when it was one the gate might have refused; None when it was not.

    Everywhere else the gate only records, so a crash there must not stand between a session and
    its work. Here it was deciding, and a decision it never reached must not be read as a yes.
    """
    if payload.get("hook_event_name") != "PreToolUse" or payload.get("tool_name") not in DECIDED:
        return None
    unbroken = "To work while it is broken, set REVIEWER_MODE=log."
    try:
        settings = _deciding_settings(payload)
        if not all(setting() == "enforce" for setting in settings):
            return None
    except Exception:
        return unbroken  # a gate that cannot read what governs this call is not one to trust with a yes
    return unbroken if settings else "No setting lets it through: the gate refuses it in log mode too."


def _deciding_settings(payload: dict) -> tuple:
    """The settings that must all enforce for the gate to refuse this call. A round's launch and an output the gate
    checks are refused under none: log mode lets no round start without the arguments the gate gives it, and sends
    back every output that fails its check. What only the claim or shim check judges answers to its setting too."""
    tool, call = payload["tool_name"], payload["tool_input"]
    workflow = call.get("name") if tool == "Workflow" else None
    if workflow in ROUND_WORKFLOWS or (tool == "StructuredOutput" and _checked_output(payload)):
        return ()
    if workflow == claimgate.CHECK or tool == "WebFetch":
        return mode, claim_checks_mode
    if workflow == shimgate.CHECK:
        return mode, shim_checks_mode
    return (mode,)


def main() -> None:
    payload = json.load(sys.stdin)
    ends = deadline(time.monotonic())
    try:
        out = handle(payload, ends)
    except Exception as exc:  # a broken gate must never stall a session; it says so instead
        trace = traceback.format_exc()
        print(trace, file=sys.stderr)
        try:
            log_error(f"{payload.get('tool_name')}\n{trace}")
            logged = f"The trace is in {ledger.state_root() / 'errors.log'}."
        except Exception as unlogged:  # the answer below must not depend on the log
            logged = f"The trace was not written to errors.log: {type(unlogged).__name__}: {unlogged}."
        where = payload.get("tool_name") or payload.get("hook_event_name")
        past = _past_a_crash(payload)
        if past:
            out = deny(f"the gate crashed deciding this {where}, so it refuses rather than letting it through "
                       f"unchecked: {type(exc).__name__}: {exc}. {logged} {past}")
        else:
            out = {"systemMessage": f"reviewer gate failed open on {where}: {type(exc).__name__}: {exc}. {logged}"}
    if out:
        print(json.dumps(out))


if __name__ == "__main__":
    main()
