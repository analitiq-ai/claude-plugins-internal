"""What every gate handler says and keeps: its settings, its refusals, gate.log, and per-session state."""
from __future__ import annotations

import fcntl
import json
import os
import re
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import config
import ledger

SESSION_ID = re.compile(r"[\w-]+")


def _setting(key: str, env: str) -> str:
    chosen = os.environ.get(env) or config.load()[key]
    if chosen not in ("log", "enforce"):
        raise ValueError(f"alq-review {key} must be log or enforce, not {chosen!r}")
    return chosen


def mode() -> str:
    return _setting("mode", "ALQ_REVIEW_MODE")


def claim_checks_mode() -> str:
    """The claim check's own setting, so it can be rolled back alone."""
    return _setting("claim_checks", "ALQ_REVIEW_CLAIM_CHECKS")


def shim_checks_mode() -> str:
    """The shim check's own setting, so it can be rolled back alone."""
    return _setting("shim_checks", "ALQ_REVIEW_SHIM_CHECKS")


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


def block(payload: dict, action: str, reason: str, target=None) -> dict:
    """A refusal in every mode: what it refuses cannot run at all, so log mode has no rule to let it past."""
    record(payload, action, "deny", reason, target)
    return deny(reason)


def _refuse_under(setting: str, payload: dict, action: str, reason: str, target=None) -> dict | None:
    if setting == "enforce":
        return refuse(payload, action, reason, target)
    record(payload, action, "would_deny", reason, target)
    return None


def refuse_claim(payload: dict, action: str, reason: str, target=None) -> dict | None:
    """A claim check's refusal: it blocks only when both the plugin and the claim checks enforce."""
    return _refuse_under(claim_checks_mode(), payload, action, reason, target)


def refuse_shim(payload: dict, action: str, reason: str, target=None) -> dict | None:
    """A shim check's refusal: it blocks only when both the plugin and the shim checks enforce."""
    return _refuse_under(shim_checks_mode(), payload, action, reason, target)


def _session_id(payload: dict) -> str | None:
    """The payload's session id when it is a plain name; the payload is the harness's, and a path is built from it."""
    session = payload.get("session_id")
    return session if isinstance(session, str) and SESSION_ID.fullmatch(session) else None


def _session_path(session: str, kind: str) -> Path:
    return ledger.state_root() / "sessions" / f"{session}{kind}.json"


def session_file(payload: dict, kind: str = "") -> Path:
    session = _session_id(payload)
    if session is None:
        raise ValueError(f"session_id {payload.get('session_id')!r} is not a name a state file can be kept under")
    path = _session_path(session, kind)
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


@contextmanager
def session_state(payload: dict, kind: str = ""):
    """The session's `kind` record, read and written back under one lock."""
    path = session_file(payload, kind)
    with open(path.with_suffix(".lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        held = json.loads(path.read_text()) if path.exists() else {}
        yield held
        path.write_text(json.dumps(held))


def log_error(text: str) -> None:
    root = ledger.state_root()
    root.mkdir(parents=True, exist_ok=True)
    # A crash's trace can hold bytes git wrote that are not UTF-8: escaped, so the trace is still kept.
    with open(root / "errors.log", "a", errors="backslashreplace") as log:
        log.write(f"{ledger.stamp(datetime.now(timezone.utc))} {text}\n")


# --- the user's on/off switch (spec 016) ------------------------------------------------------------

_OFF = ".off"


def switch_state(payload: dict) -> str:
    """`off` while the user has switched the plugin off in this session, else `on`; `unreadable` when the switch's
    file cannot be opened as text or is not what `set_switch` writes, which every caller treats as on. Asked on
    every hook event, so it takes no lock, and writes only the `errors.log` line of an unreadable file."""
    session = _session_id(payload)
    if session is None:
        return "on"
    path = _session_path(session, _OFF)
    try:
        text = path.read_text()
        held = json.loads(text)
    except FileNotFoundError:
        return "on"
    except (OSError, ValueError) as exc:  # ValueError: bytes that are not UTF-8, text that is not JSON
        found = f"{type(exc).__name__}: {exc}"
    else:
        if isinstance(held, dict) and set(held) == {"at", "by"} and all(isinstance(v, str) for v in held.values()):
            return "off"
        found = f"not {{at, by}}: {text[:200]!r}"
    log_error(f"switch file {path}: {found}; the plugin counts as on")
    return "unreadable"


def set_switch(payload: dict, off: bool, by: str) -> None:
    path = session_file(payload, _OFF)
    if off:
        path.write_text(json.dumps({"at": ledger.stamp(datetime.now(timezone.utc)), "by": by}))
    else:
        path.unlink(missing_ok=True)
