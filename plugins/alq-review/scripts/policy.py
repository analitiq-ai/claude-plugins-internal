"""What the review process permits next. Pure functions of the ledger state: no I/O, no clock."""
from __future__ import annotations

from dataclasses import dataclass

import reshape
from ledger import COUNTED, counted, current_round, released

CAP = 4          # rounds a stage may take without settling before the anti-pattern audit is mandatory
MAX_AUDITS = 2   # escalation audits before the work goes back to the user; each unlock grants this many more
VERDICTS = ["PATCH", "CLASS_FIX", "REDESIGN", "RESHAPE_SPEC", "CONVERGED_PUSHBACK", "ESCALATE"]
# Verdicts that hand a decision to the user: the spec is wrong, or the work is theirs to judge. Code
# stays put until the user says it is settled. REDESIGN is not one: its next step is the rewrite.
LOCKING = ("RESHAPE_SPEC", "ESCALATE")
# Verdicts that answer findings with another edit. Once a file is at its third edit, they are the
# thing that put it there.
MOVING = ("PATCH", "CLASS_FIX")

REVIEW_CALL = ("Workflow(name='alq-review:review-round', args={worktree: '<absolute worktree path>', stage: '%s', "
               "spec: %s})")
PLUGIN = "alq-review"
ASSESS_CALL = "Workflow(name='alq-review:assess-round', args={worktree: '<absolute worktree path>'})"


@dataclass(frozen=True)
class Decision:
    allow: bool
    reason: str = ""
    scope: str = ""
    delta_from: str = ""
    escalation: bool = False


def review_call(state: dict | None, stage: str) -> str:
    """The review-round call for `stage`. `spec` is the PR's bound value, quoted so the agent cannot pass another;
    with no binding yet, or no state at hand, both forms the agent may choose from."""
    if state is None or "spec" not in state:
        spec = "'<spec folder>' | null"
    elif state["spec"] is None:
        spec = "null"
    else:
        spec = f"'{state['spec']}'"
    return REVIEW_CALL % (stage, spec)


def _label(rnd: dict) -> str:
    return f"{rnd['stage']} review round {rnd['n']}"


def _verdict_locked(state: dict) -> bool:
    rnd = current_round(state)
    return (rnd is not None and rnd["status"] == "assessed" and rnd["assessment"]["round_verdict"] in LOCKING
            and not released(rnd["assessed_at"], state["unlocked_at"]))


def _spec_held(state: dict) -> dict | None:
    """The hold a changed spec.md put on the PR, while no later unlock has released it."""
    held = state.get("spec_held")
    return held if held is not None and not released(held["at"], state["unlocked_at"]) else None


def _unconverged_audits(state: dict) -> list[dict]:
    """Escalation audits since the user last handed the branch back that ruled something must change. One that
    found the branch converged is not evidence it is failing to."""
    since = state["unlocked_epoch"]
    return [r for r in state["rounds"] if r["escalation"] and r["epoch"] >= since and r["status"] == "assessed"
            and r["assessment"]["round_verdict"] != "CONVERGED_PUSHBACK"]


def _audits_spent(state: dict) -> bool:
    """Lands when the last audit ends, not a cap later: the rounds a refilled budget would buy are the ones
    that audit just judged futile."""
    return len(_unconverged_audits(state)) >= MAX_AUDITS


def reshape_spec_ruling(state: dict) -> dict | None:
    """The assessment holding the branch, when the hold is a RESHAPE_SPEC ruling: the one lock whose unlock hands the
    user the ruling to plan from, whatever other hold the same unlock releases."""
    if not _verdict_locked(state):
        return None
    ruling = current_round(state)["assessment"]
    return ruling if ruling["round_verdict"] == "RESHAPE_SPEC" else None


def _holds(state: dict) -> list[tuple[str, str]]:
    """Every hold on the branch the user has not released, as why it holds and what the user must decide."""
    holds = []
    if _audits_spent(state):
        rulings = "; ".join(f"audit {i} ruled {r['assessment']['round_verdict']}: {r['assessment']['next_step']}"
                            for i, r in enumerate(_unconverged_audits(state), 1))
        holds.append((f"{MAX_AUDITS} anti-pattern audits ruled that work must change, and the branch is not "
                      "converging by patching.",
                      f"continue on this approach, change it, or split the branch? The audits: {rulings}."))
    if _verdict_locked(state):
        rnd = current_round(state)
        why = f"The {_label(rnd)} was assessed {rnd['assessment']['round_verdict']}. "
        holds.append(((why + reshape.notice_failures(state["repo"], rnd)).rstrip(), rnd["assessment"]["user_decision"]))
    held = _spec_held(state)
    if held is not None:
        holds.append((f"The spec.md of `{state['spec']}` changed after this PR was bound to it: the bound blob is "
                      f"{held['bound']} and HEAD's is {held['head']}, and review grades against the bound text.",
                      f"does this PR now build to the changed spec? `git diff {held['bound']} {held['head']}` "
                      "shows the change."))
    return holds


def locked(state: dict) -> bool:
    """The branch is with the user, by the latest round's verdict, by spent audits or by a changed spec.md, and they
    have not handed it back."""
    return bool(_holds(state))


def unlock_ref(state: dict) -> str:
    """What the user types after `unlock` to release this branch."""
    return f"#{state['pr']}" if state["pr"] else state["branch"]


def _obstacle(state: dict, inflight: int) -> str | None:
    """Why this branch's code may not move right now."""
    if inflight:
        return (f"{inflight} reviewer subagent(s) are still running. Wait for every report; "
                "acting on the first finding is what this gate exists to stop.")
    rnd = current_round(state)
    if rnd is None:
        return None
    if rnd["status"] == "collecting":
        return (f"The {_label(rnd)} did not complete: {len(rnd['reports'])}/{len(rnd['expected'])} reviewers reported. "
                f"Next step: wait for its workflow result, or if that run died, relaunch it with "
                f"{review_call(state, rnd['stage'])}.")
    if rnd["status"] == "awaiting_assessment":
        return (f"The {_label(rnd)} has {len(rnd['findings'])} finding(s) and no assessment. "
                f"Next step: {ASSESS_CALL}. Fix nothing before it returns.")
    return _lock_reason(state)


def _lock_reason(state: dict) -> str | None:
    """Why the branch is with the user, hold by hold, each ending in the question they must answer: a lock that asks
    nothing leaves them nothing to do but type unlock, and one unlock releases every hold, so each must be seen."""
    holds = _holds(state)
    if not holds:
        return None
    asked = " ".join(f"{why} Ask: {question}" for why, question in holds)
    return (f"The branch is locked until the user releases it. Stop and ask the user what each hold asks. {asked} "
            f"Once they have decided, they start their next prompt with `unlock {unlock_ref(state)}`, which releases "
            "every hold named here. Editing the spec or changing files another way does not release it.")


def mutation(state: dict, *, inflight: int) -> Decision:
    obstacle = _obstacle(state, inflight)
    return Decision(False, obstacle) if obstacle else Decision(True)


def _settled(rnd: dict) -> bool:
    """The round ended the review: nothing was found, or the assessor ruled the round converged."""
    return rnd["status"] == "clean" or (rnd["status"] == "assessed"
                                        and rnd["assessment"]["round_verdict"] == "CONVERGED_PUSHBACK")


def _capped(state: dict, stage: str) -> bool:
    """CAP rounds since the stage last settled or the last escalation audit, whichever is later. A settled round
    ends the run the cap measures, so a change pushed after it starts a new one."""
    rounds = counted(state, stage)
    last_settled = max((i for i, r in enumerate(rounds) if _settled(r)), default=-1)
    return len(rounds) - last_settled - 1 >= CAP


def _cap_reached(state: dict) -> str | None:
    return next((stage for stage in ("internal", "github") if _capped(state, stage)), None)


def _cap_refusal(state: dict, stage: str) -> Decision:
    return Decision(False, f"{CAP} {stage} review rounds have not produced a clean result, which means the findings share a "
                           f"cause the rounds are not reaching. Next step: {review_call(state, 'audit')}.")


def launch_round(state: dict, stage: str, *, head_sha: str, dirty: bool, inflight: int) -> Decision:
    rnd = current_round(state)
    dead_run = rnd is not None and rnd["status"] == "collecting" and not inflight
    obstacle = _lock_reason(state) if dead_run else _obstacle(state, inflight)
    if obstacle:
        return Decision(False, obstacle)
    if dirty:
        return Decision(False, "The checkout has uncommitted changes or new files. A round is pinned to a commit so the "
                               "next one can review exactly what changed since. Next step: commit, delete or ignore "
                               "them, then launch again.")
    capped = _cap_reached(state)
    if stage == "audit":
        return Decision(True, scope="full", escalation=capped is not None)
    if capped:
        return _cap_refusal(state, capped)
    done = counted(state, "internal")
    if not done:
        return Decision(True, scope="full")
    if done[-1]["head_sha"] == head_sha:
        return Decision(False, f"Nothing was committed since internal review round {done[-1]['n']}. Running it again on the "
                               "same code would only re-sample the reviewers. Next step: apply the assessment, or if the "
                               "round was clean or fully pushed back, move on (gh pr ready).")
    return Decision(True, scope="delta", delta_from=done[-1]["head_sha"])


def launch_assess(state: dict) -> Decision:
    rnd = current_round(state)
    if rnd is None or rnd["status"] != "awaiting_assessment":
        return Decision(False, "No review round on this branch is awaiting assessment.")
    return Decision(True)


def rerequest(state: dict, *, inflight: int) -> Decision:
    obstacle = _obstacle(state, inflight)
    if obstacle:
        return Decision(False, obstacle)
    if _capped(state, "github"):
        return _cap_refusal(state, "github")
    return Decision(True)


def mark_ready(state: dict, *, head_sha: str, inflight: int, released: bool) -> Decision:
    """released: the org pr-gate passed head_sha as a version-only release, which needs no review."""
    obstacle = _obstacle(state, inflight)
    if obstacle:
        return Decision(False, obstacle)
    if released:
        return Decision(True)
    internal = [r for r in state["rounds"] if r["stage"] == "internal" and r["status"] in COUNTED]
    last = internal[-1] if internal else None
    if last is not None and _settled(last) and last["head_sha"] == head_sha:
        return Decision(True)
    return Decision(False, f"The internal review has not come back clean at {head_sha[:7]}; the GitHub review comes after it. "
                           "Until then the PR stays a draft and the internal review is not attested: no gh pr ready, no "
                           f"gh pr create without --draft, no internal-review comment. Next step: "
                           f"{review_call(state, 'internal')}.")


def admissible_verdicts(rnd: dict, *, churned: bool = False) -> list[str]:
    barred = set()
    if rnd["escalation"]:
        barred.add("PATCH")
    if churned:
        barred.update(MOVING)
    return [v for v in VERDICTS if v not in barred]
