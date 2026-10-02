"""What every gate handler says and keeps: its settings, its refusals, gate.log, and per-session state."""
from __future__ import annotations

import fcntl
import json
import os
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import config
import ledger


def _setting(key: str, env: str) -> str:
    chosen = os.environ.get(env) or config.load()[key]
    if chosen not in ("log", "enforce"):
        raise ValueError(f"alq-review {key} must be log or enforce, not {chosen!r}")
    return chosen


def mode() -> str:
    return _setting("mode", "ALQ_REVIEW_MODE")


def spec_checks_mode() -> str:
    """The spec-folder checks' own setting (spec 004 FR-006), so they can be rolled back alone."""
    return _setting("spec_checks", "ALQ_REVIEW_SPEC_CHECKS")


def claim_checks_mode() -> str:
    """The claim check's own setting (spec 005 FR-019), so it can be rolled back alone."""
    return _setting("claim_checks", "ALQ_REVIEW_CLAIM_CHECKS")


def deny(reason: str) -> dict:
    return {"hookSpecificOutput": {"hookEventName": "PreToolUse", "permissionDecision": "deny",
                                   "permissionDecisionReason": f"[alq-review] {reason}"}}


def record(payload: dict, action: str, decision: str, reason: str = "", target=None) -> None:
    """One gate.log line; `target` is anything with repo, branch and pr."""
    entry = {"at": ledger.stamp(datetime.now(timezone.utc)), "session": payload.get("session_id"), "action": action,
             "decision": decision, "repo": target and target.repo, "branch": target and target.branch,
             "pr": target and target.pr, "agent_type": payload.get("agent_type"), "reason": reason}
    root = ledger.state_root()
    root.mkdir(parents=True, exist_ok=True)
    with open(root / "gate.log", "a") as log:
        log.write(json.dumps(entry) + "\n")


def refuse(payload: dict, action: str, reason: str, target=None) -> dict | None:
    """A process refusal: blocks in enforce mode, is only recorded in log mode."""
    enforcing = mode() == "enforce"
    record(payload, action, "deny" if enforcing else "would_deny", reason, target)
    return deny(reason) if enforcing else None


def _refuse_under(setting: str, payload: dict, action: str, reason: str, target=None) -> dict | None:
    if setting == "enforce":
        return refuse(payload, action, reason, target)
    record(payload, action, "would_deny", reason, target)
    return None


def refuse_spec(payload: dict, action: str, reason: str, target) -> dict | None:
    """A spec-folder check's refusal: it blocks only when both the plugin and the spec checks enforce."""
    return _refuse_under(spec_checks_mode(), payload, action, reason, target)


def refuse_claim(payload: dict, action: str, reason: str, target=None) -> dict | None:
    """A claim check's refusal: it blocks only when both the plugin and the claim checks enforce."""
    return _refuse_under(claim_checks_mode(), payload, action, reason, target)


def session_file(payload: dict, kind: str = "") -> Path:
    directory = ledger.state_root() / "sessions"
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{payload['session_id']}{kind}.json"


@contextmanager
def session_state(payload: dict, kind: str = ""):
    """The session's `kind` record, read and written back under one lock."""
    path = session_file(payload, kind)
    with open(path.with_suffix(".lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        held = json.loads(path.read_text()) if path.exists() else {}
        yield held
        path.write_text(json.dumps(held))
