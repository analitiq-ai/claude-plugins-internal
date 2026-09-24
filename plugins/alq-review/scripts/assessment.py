"""The two structured outputs of a review round: a reviewer's findings and the assessor's ruling.

JSON Schema carries what one field can say; validate_* carries what the fields must say together.
"""
from __future__ import annotations

from policy import LOCKING

FINDING_VERDICTS = ["FIX", "PUSH_BACK", "DEFER"]
KINDS = ["defect", "fix_induced", "class_sibling", "duplicate", "spec_gap", "bikeshed", "gold_plating", "not_real"]
NOT_WORTH_FIXING = ("bikeshed", "gold_plating", "not_real")
FIXING_VERDICTS = ("PATCH", "CLASS_FIX", "REDESIGN")


def findings_schema(round_ref: str, short: str) -> dict:
    finding = {
        "type": "object",
        "properties": {
            "id": {"type": "string", "pattern": f"^{short}-[0-9]+$", "description": f"{short}-1, {short}-2, ..."},
            "title": {"type": "string"},
            "file": {"type": "string", "description": "path relative to the repo root"},
            "line": {"type": "integer"},
            "severity": {"type": "string", "enum": ["HIGH", "MEDIUM", "LOW"]},
            "detail": {"type": "string", "description": "what is wrong and the concrete failure it causes"},
            "suggested_fix": {"type": "string"},
        },
        "required": ["id", "title", "file", "severity", "detail"],
    }
    return {
        "type": "object",
        "properties": {
            "round_ref": {"type": "string", "enum": [round_ref]},
            "findings": {"type": "array", "items": finding, "description": "empty when nothing must change"},
            "verdict": {"type": "string", "description": "only for a reviewer whose remit is a verdict, e.g. history-shape"},
            "clean_scope": {"type": "string", "description": "what was examined and came back clean"},
        },
        "required": ["round_ref", "findings"],
    }


def assessment_schema(round_ref: str, admissible: list[str]) -> dict:
    entry = {
        "type": "object",
        "properties": {
            "id": {"type": "string"},
            "verdict": {"type": "string", "enum": FINDING_VERDICTS},
            "kind": {"type": "string", "enum": KINDS},
            "duplicate_of": {"type": "string", "description": "kind duplicate only: the id of the finding of this round it repeats"},
            "spec_ref": {"type": "string", "description": "the spec decision this touches, 'spec silent', or 'n/a'"},
            "mechanism": {"type": "string", "description": "what produces the problem, not where it shows"},
            "reason": {"type": "string"},
        },
        "required": ["id", "verdict", "kind", "spec_ref", "mechanism", "reason"],
    }
    return {
        "type": "object",
        "properties": {
            "round_ref": {"type": "string", "enum": [round_ref]},
            "brief_token": {"type": "string", "description": "copied from the brief; proves it was read"},
            "findings": {"type": "array", "items": entry},
            "round_verdict": {"type": "string", "enum": admissible},
            "invariant": {"type": "string", "description": "CLASS_FIX: the rule every site must satisfy. REDESIGN: the structure that replaces the current one"},
            "sites": {"type": "array", "items": {"type": "string"}, "description": "CLASS_FIX: every path:line the invariant covers"},
            "enumeration_command": {"type": "string", "description": "CLASS_FIX: the command that lists the sites"},
            "patch_defense": {"type": "string", "description": "PATCH under burden of proof: why these findings do not share a cause"},
            "rationale": {"type": "string"},
            "next_step": {"type": "string", "description": "one instruction to the implementing agent"},
            "user_decision": {"type": "string", "description": "RESHAPE_SPEC and ESCALATE only: the question the user "
                                                               "must answer before the code may change"},
        },
        "required": ["round_ref", "brief_token", "findings", "round_verdict", "rationale", "next_step"],
    }


def validate_report(report: dict, short: str) -> list[str]:
    ids = [f["id"] for f in report["findings"]]
    errors = [f"finding id {i!r} must be {short}-<number>" for i in ids if not i.startswith(f"{short}-")]
    if len(set(ids)) != len(ids):
        errors.append("finding ids must be unique")
    return errors


def validate_assessment(assessment: dict, rnd: dict, admissible: list[str], *, burden: bool, token: str) -> list[str]:
    if assessment["brief_token"] != token:
        return ["brief_token does not match: run the brief command from your instructions first; it prints the "
                "token together with the facts this assessment must build on"]
    errors = []
    expected = sorted(f["id"] for f in rnd["findings"])
    got = sorted(e["id"] for e in assessment["findings"])
    if got != expected:
        errors.append(f"findings must hold exactly one entry per finding of the round; expected ids {expected}, got {got}")

    by_id = {e["id"]: e for e in assessment["findings"]}
    for e in assessment["findings"]:
        original = by_id.get(e.get("duplicate_of"))
        if e["kind"] != "duplicate":
            if e.get("duplicate_of"):
                errors.append(f"{e['id']}: only a finding of kind duplicate names duplicate_of")
        elif original is None or original is e or original["kind"] == "duplicate":
            errors.append(f"{e['id']}: duplicate_of must name another finding of this round that is not itself a duplicate")
        elif e["verdict"] != original["verdict"]:
            errors.append(f"{e['id']}: a duplicate carries the verdict of {original['id']} ({original['verdict']})")

    verdict = assessment["round_verdict"]
    if verdict not in admissible:
        errors.append(f"round_verdict {verdict} is not admissible for this round; admissible: {admissible}")

    to_fix = [e for e in assessment["findings"] if e["verdict"] == "FIX"]
    for e in to_fix:
        if e["kind"] in NOT_WORTH_FIXING:
            errors.append(f"{e['id']}: kind {e['kind']} cannot carry verdict FIX; push it back or reclassify it")
    if verdict in FIXING_VERDICTS and not to_fix:
        errors.append(f"{verdict} needs at least one finding with verdict FIX; with none, the verdict is CONVERGED_PUSHBACK")
    if verdict == "CONVERGED_PUSHBACK" and to_fix:
        errors.append("CONVERGED_PUSHBACK means nothing is to be fixed, but some findings carry verdict FIX")

    if verdict == "PATCH":
        shared = [e["id"] for e in assessment["findings"] if e["kind"] in ("class_sibling", "fix_induced")]
        if shared:
            errors.append(f"PATCH contradicts {shared} being labelled class_sibling/fix_induced: findings with a shared "
                          "cause are fixed at the cause (CLASS_FIX, REDESIGN or RESHAPE_SPEC)")
        elif burden and not assessment.get("patch_defense"):
            errors.append("the computed facts put the burden of proof on PATCH; give patch_defense or choose another verdict")
    if verdict == "CLASS_FIX":
        if not assessment.get("invariant") or not assessment.get("enumeration_command") or len(assessment.get("sites") or []) < 2:
            errors.append("CLASS_FIX needs invariant, enumeration_command and at least two sites")
    if verdict == "REDESIGN" and not assessment.get("invariant"):
        errors.append("REDESIGN needs invariant: the structure that replaces the current one")
    asks = (assessment.get("user_decision") or "").strip()
    if verdict in LOCKING and not asks:
        errors.append(f"{verdict} locks the branch until the user answers: give user_decision, the question they must answer")
    if verdict not in LOCKING and asks:
        errors.append(f"{verdict} does not lock the branch, so it asks the user nothing: drop user_decision")
    if verdict == "RESHAPE_SPEC" and not any(e["kind"] == "spec_gap" for e in assessment["findings"]):
        errors.append("RESHAPE_SPEC needs at least one finding of kind spec_gap naming the unsettled decision")
    return errors
