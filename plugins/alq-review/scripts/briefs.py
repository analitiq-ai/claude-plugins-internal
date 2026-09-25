"""What each agent of a round is told: reviewer prompts, the audit scope packet, and the assessor's brief.

The workflows only orchestrate. Who reviews, what they are asked and what shape they answer in
are decided here, so the hooks that check the answers and the prompts that ask for them cannot drift.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys

import assessment
import facts
import github
import ledger
import policy
import worktree

INTERNAL_REVIEWERS = [
    "pr-review-toolkit:code-reviewer",
    "pr-review-toolkit:silent-failure-hunter",
    "pr-review-toolkit:pr-test-analyzer",
    "pr-review-toolkit:comment-analyzer",
    "pr-review-toolkit:type-design-analyzer",
]
# Dispatch order is the anti-pattern PR audit's: semantic-parity reads duplication's parity candidates.
AUDIT_WAVES = [
    ["alq-anti-pattern:history-shape", "alq-anti-pattern:mechanism-depth", "alq-anti-pattern:failure-evasion",
     "alq-anti-pattern:duplication", "alq-anti-pattern:code-shape", "alq-anti-pattern:boundary-trust"],
    ["alq-anti-pattern:semantic-parity"],
]
NEEDS = {"alq-anti-pattern:semantic-parity": "alq-anti-pattern:duplication"}
ASSESSOR = "alq-review:assessor"
REVIEWERS = frozenset(INTERNAL_REVIEWERS + [t for wave in AUDIT_WAVES for t in wave])
_ISSUE_IN_BRANCH = re.compile(r"^[a-z]+/(\d+)-")


def short(agent_type: str) -> str:
    return agent_type.split(":")[1]


def issue_number(branch: str) -> int | None:
    found = _ISSUE_IN_BRANCH.match(branch)
    return int(found.group(1)) if found else None


def _ruled_on(state: dict) -> str:
    rulings = ledger.adjudicated(state)
    if not rulings:
        return ""
    lines = [f"- [{r['verdict']}] {r['title']} ({r['file']}): {r['reason']}" for r in rulings]
    return ("\n\nAlready ruled on in earlier rounds. Do not raise these again unless you can show the ruling was "
            "wrong or a FIX was not actually made:\n" + "\n".join(lines))


def _review_prompt(state: dict, where: worktree.Worktree, decision: policy.Decision, base: str, agent_type: str) -> str:
    if decision.scope == "delta":
        scope = (f"In {where.root}, run: git diff {decision.delta_from}..HEAD\n"
                 "That is what changed since the previous review round. The rest of the branch was reviewed then: "
                 "read it for context, report on the delta.")
    else:
        scope = f"In {where.root}, run: git diff {base}...HEAD\nThat is the whole change under review."
    return (f"Review branch {where.branch} of {where.slug}.\n{scope}\n\n"
            "Report only what must change before this merges: a defect, a broken contract, a violated project rule. "
            "No style preferences, no praise, no summary. An empty findings list is a normal and expected answer."
            f"{_ruled_on(state)}\n\n"
            f"Answer through StructuredOutput, numbering findings {short(agent_type)}-1, {short(agent_type)}-2, ...")


def _audit_prompt(where: worktree.Worktree, base: str, agent_type: str) -> str:
    visibility = github.repo_visibility(where.slug) or "unknown (lookup failed) - treat as public"
    files = "\n".join(f"  - {f}" for f in worktree.changed_files(where.root, base))
    return ("Scope packet\n"
            "mode: delta\n"
            f"repo: {where.slug} at {where.root}\n"
            f"visibility: {visibility}\n"
            "unit: PR delta\n"
            f"files:\n{files}\n"
            f"regions: changed-hunks - the diff is not pasted; in {where.root} run: git diff {base}...HEAD\n"
            "read_beyond: yes\n"
            f"baseline: {base}\n"
            "suppressions: none\n"
            "standards: [[coding-principles]], [[schema-contracts]]\n\n"
            f"Answer through StructuredOutput, numbering findings {short(agent_type)}-1, {short(agent_type)}-2, ... "
            "A remit that ends in a verdict puts it, with its evidence, in `verdict`. "
            "Put your clean-scope statement in `clean_scope`.")


def churned(state: dict, rnd: dict, root: str) -> bool:
    """A file is at its third edit. The narrowing belongs in the schema, not only in the gate's
    refusal: a verdict the assessor cannot emit costs no round to reject."""
    return bool(facts.round_facts(state, rnd, root)["files_at_third_edit"])


def _assess_args(rnd: dict, churned_files: bool) -> dict:
    return {"prompt": f"Assess the {rnd['stage']} review round {rnd['n']}. Your brief: --ref '{rnd['ref']}'",
            "schema": assessment.assessment_schema(
                rnd["ref"], policy.admissible_verdicts(rnd, churned=churned_files))}


def review_args(state: dict, rnd: dict, where: worktree.Worktree, decision: policy.Decision) -> dict:
    waves = AUDIT_WAVES if rnd["stage"] == "audit" else [INTERNAL_REVIEWERS]

    def reviewer(agent_type: str) -> dict:
        prompt = (_audit_prompt(where, rnd["base_sha"], agent_type) if rnd["stage"] == "audit"
                  else _review_prompt(state, where, decision, rnd["base_sha"], agent_type))
        entry = {"type": agent_type, "short": short(agent_type), "prompt": prompt,
                 "schema": assessment.findings_schema(rnd["ref"], short(agent_type))}
        if agent_type in NEEDS:
            entry["needs"] = NEEDS[agent_type]
        return entry

    return {"worktree": where.root, "stage": rnd["stage"], "round_ref": rnd["ref"],
            "label": f"{rnd['stage']} review round {rnd['n']} ({rnd['scope']})",
            "waves": [[reviewer(t) for t in wave] for wave in waves],
            "assess": _assess_args(rnd, churned(state, rnd, where.root))}


def assess_args(state: dict, rnd: dict, where: worktree.Worktree) -> dict:
    return {"worktree": where.root, "round_ref": rnd["ref"], "findings": rnd["findings"],
            "assess": _assess_args(rnd, churned(state, rnd, where.root))}


def brief_token(rnd: dict) -> str:
    """Proof the assessor read its brief: derived from ledger data that appears in no prompt."""
    return hashlib.sha256(f"{rnd['ref']}|{rnd['opened_at']}|{len(rnd['findings'])}".encode()).hexdigest()[:12]


def brief(state: dict, rnd: dict) -> dict:
    issue = issue_number(state["branch"])
    spec = (f"gh api repos/{state['repo']}/issues/{issue}/comments --paginate "
            f"--jq '.[] | select(.body | contains(\"{github.SPEC_MARKER}\")) | .body'") if issue else None
    base = rnd["base_sha"]
    measured = facts.round_facts(state, rnd, rnd["root"])
    return {
        "brief_token": brief_token(rnd),
        "checkout": rnd["root"],
        "change_under_review": f"git -C {rnd['root']} diff {base}...HEAD",
        "history": f"git -C {rnd['root']} log --oneline {base}..HEAD",
        "spec_command": spec or "none: the branch names no issue, so spec_ref is 'n/a' throughout",
        "facts": measured,
        "admissible_round_verdicts": policy.admissible_verdicts(rnd, churned=bool(measured["files_at_third_edit"])),
        "escalation": rnd["escalation"],
        "earlier_rounds": [{"stage": r["stage"], "n": r["n"], "findings": len(r["findings"]),
                            "round_verdict": (r["assessment"] or {}).get("round_verdict", r["status"]),
                            "invariant": (r["assessment"] or {}).get("invariant")}
                           for r in state["rounds"] if r is not rnd],
        "rulings_so_far": ledger.adjudicated(state),
        "reviewer_verdicts": {t: rep["verdict"] for t, rep in rnd["reports"].items() if rep.get("verdict")},
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Print the assessor's brief for one review round.")
    parser.add_argument("--ref", required=True)
    ref = parser.parse_args().ref
    with ledger.open_ledger(*ledger.parse_ref(ref)) as state:
        rnd = ledger.find_round(state, ref)
        if rnd["status"] != "awaiting_assessment":
            sys.exit(f"{ref} is {rnd['status']}, not awaiting assessment")
        print(json.dumps(brief(state, rnd), indent=1))


if __name__ == "__main__":
    main()
