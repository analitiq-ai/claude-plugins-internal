"""PreToolUse hook on Read, Glob and Grep: the shim sweeper reads only inside a snapshot folder, never the
checkout whose staged fix it sweeps; its prompt names the snapshot of this check. Every other reader gets no answer
from this hook.

Runs on every Read, Glob and Grep of the session, so it, `snapshot.py` and `worktree.py` import nothing outside the
standard library."""
import json
import os
import sys

from snapshot import snapshot_of

SWEEPER = "reviewer:shim-sweeper"


def _outside(tool: str, tool_input: dict, cwd: str) -> str | None:
    """Why this call reaches outside a snapshot; None when it stays inside one."""
    target = tool_input.get("file_path" if tool == "Read" else "path")
    if not isinstance(target, str) or not target:
        return f"{tool} needs an explicit {'file_path' if tool == 'Read' else 'path'} inside the snapshot"
    pattern = tool_input.get("pattern", "") if tool == "Glob" else ""
    if os.path.isabs(pattern) or ".." in pattern.split("/"):
        return "a Glob pattern is relative to its path and never climbs out of it"
    if snapshot_of(os.path.join(cwd, target)) is None:
        return f"{target} is not inside the snapshot"
    return None


def main() -> None:
    payload = json.load(sys.stdin)
    if payload.get("agent_type") != SWEEPER:
        return
    why = _outside(payload["tool_name"], payload.get("tool_input") or {}, payload.get("cwd") or "/")
    answer = {"permissionDecision": "allow"} if why is None else {
        "permissionDecision": "deny",
        "permissionDecisionReason": f"[reviewer] The shim sweeper reads only the snapshot of HEAD named in its "
                                    f"prompt: {why}."}
    print(json.dumps({"hookSpecificOutput": {"hookEventName": "PreToolUse", **answer}}))


if __name__ == "__main__":
    main()
