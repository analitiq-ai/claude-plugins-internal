import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))

import ledger  # noqa: E402

T0 = datetime(2026, 9, 18, 12, 0, 0, tzinfo=timezone.utc)
REVIEWERS = ["pr-review-toolkit:code-reviewer", "pr-review-toolkit:silent-failure-hunter"]


def finding(fid, file="src/a.py", line=10, title="t"):
    return {"id": fid, "title": title, "file": file, "line": line, "severity": "MEDIUM", "detail": "d"}


def state_with_round(stage="internal", findings_per_reviewer=(1, 0), head="a" * 40, escalation=False):
    """A branch whose latest round has every reviewer reported."""
    state = ledger.new_state("acme/demo", "feat/1-demo", pr=7)
    add_round(state, stage, findings_per_reviewer, head, escalation)
    return state


def add_round(state, stage="internal", findings_per_reviewer=(1, 0), head="a" * 40, escalation=False):
    rnd = ledger.open_round(state, stage, head_sha=head, base_sha="0" * 40, scope="full",
                            expected=REVIEWERS, escalation=escalation, now=T0)
    for agent_type, count in zip(REVIEWERS, findings_per_reviewer):
        short = agent_type.split(":")[1]
        report = {"round_ref": rnd["ref"], "findings": [finding(f"{short}-{i + 1}") for i in range(count)]}
        ledger.record_report(state, rnd["ref"], agent_type, report, now=T0)
    return rnd


def assess(state, verdict, finding_verdict="FIX"):
    rnd = ledger.current_round(state)
    assessment = {
        "round_ref": rnd["ref"],
        "round_verdict": verdict,
        "findings": [{"id": f["id"], "verdict": finding_verdict, "kind": "defect", "spec_ref": "n/a",
                      "mechanism": "m", "reason": "r"} for f in rnd["findings"]],
        "rationale": "because",
        "next_step": "do the thing",
    }
    if verdict in ("RESHAPE_SPEC", "ESCALATE"):
        assessment["user_decision"] = "which root is canonical?"
    ledger.record_assessment(state, rnd["ref"], assessment, now=T0)
    return assessment
