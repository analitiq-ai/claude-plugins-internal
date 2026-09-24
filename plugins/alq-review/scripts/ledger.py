"""Round ledger: what each review round on a branch found and how it was assessed.

State lives outside every repo so that the poller, which knows a PR but no checkout,
and the hooks, which know a checkout but no PR, meet in one place.
"""
from __future__ import annotations

import argparse
import fcntl
import json
import os
import sys
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

LOCAL_STAGES = ("internal", "audit")
COUNTED = ("assessed", "clean")


class LedgerError(Exception):
    pass


def state_root() -> Path:
    override = os.environ.get("ALQ_REVIEW_STATE_DIR")
    if override:
        return Path(override)
    return Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local" / "state") / "alq-review"


def stamp(now: datetime) -> str:
    # GitHub's timestamp format, so ledger and API times compare as strings.
    return now.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _flat(name: str) -> str:
    return name.replace("/", "__")


def new_state(slug: str, branch: str) -> dict:
    return {"repo": slug, "branch": branch, "pr": None, "epoch": 0, "rounds": [],
            "unlocked_at": None, "unlocked_epoch": 0, "github_clean_sha": None}


@contextmanager
def open_state(slug: str, branch: str):
    """The branch's state under an exclusive lock; saved only if the block completes."""
    directory = state_root() / _flat(slug) / _flat(branch)
    directory.mkdir(parents=True, exist_ok=True)
    with open(directory / "lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        path = directory / "state.json"
        state = json.loads(path.read_text()) if path.exists() else new_state(slug, branch)
        if (state["repo"], state["branch"]) != (slug, branch):
            raise LedgerError(f"{directory} already holds {state['repo']}@{state['branch']}, not {slug}@{branch}")
        yield state
        scratch = path.with_suffix(".tmp")
        scratch.write_text(json.dumps(state, indent=1))
        scratch.replace(path)


def all_states():
    """Every branch's state as last saved; open_state replaces the file whole, so a read never sees half."""
    for path in state_root().glob("*/*/state.json"):
        yield json.loads(path.read_text())


def branch_for_pr(slug: str, pr: int) -> str | None:
    """The branch a PR belongs to, from what the poller has told us so far."""
    for path in (state_root() / _flat(slug)).glob("*/state.json"):
        state = json.loads(path.read_text())
        if state.get("pr") == pr:
            return state["branch"]
    drop = state_root() / "inbox" / f"{_flat(slug)}__{pr}.json"
    if drop.exists():
        return json.loads(drop.read_text())["head_ref"]
    return None


def parse_ref(ref: str) -> tuple[str, str]:
    # ':' cannot occur in a git ref name or a repo slug, so it splits unambiguously.
    slug, branch, _ = ref.split(":")
    return slug, branch


def current_round(state: dict) -> dict | None:
    return state["rounds"][-1] if state["rounds"] else None


def counted(state: dict, stage: str) -> list[dict]:
    """Completed rounds of a stage since the last escalation audit."""
    return [r for r in state["rounds"]
            if r["stage"] == stage and r["epoch"] == state["epoch"] and r["status"] in COUNTED]


def find_round(state: dict, ref: str) -> dict:
    for rnd in state["rounds"]:
        if rnd["ref"] == ref:
            return rnd
    raise LedgerError(f"no round {ref}")


def _append_round(state: dict, stage: str, now: datetime, **fields) -> dict:
    n = len(counted(state, stage)) + 1
    rnd = {"stage": stage, "n": n, "epoch": state["epoch"],
           "ref": f"{state['repo']}:{state['branch']}:{stage}-{state['epoch']}.{n}",
           "opened_at": stamp(now), "reports": {}, "findings": [], "assessment": None, "assessed_at": None, **fields}
    state["rounds"].append(rnd)
    return rnd


def open_round(state: dict, stage: str, *, head_sha: str, base_sha: str, scope: str, expected: list[str],
               escalation: bool, now: datetime) -> dict:
    last = current_round(state)
    # A local round still collecting is a run that died; the relaunch takes its place.
    if last and last["stage"] in LOCAL_STAGES and last["status"] == "collecting":
        state["rounds"].pop()
    return _append_round(state, stage, now, status="collecting", head_sha=head_sha, base_sha=base_sha,
                         scope=scope, expected=expected, escalation=escalation)


def _complete_without_assessment(state: dict, rnd: dict) -> None:
    rnd["status"] = "clean"
    if rnd["escalation"]:
        state["epoch"] += 1


def record_report(state: dict, ref: str, agent_type: str, report: dict, now: datetime) -> dict:
    rnd = find_round(state, ref)
    if agent_type not in rnd["expected"]:
        raise LedgerError(f"{agent_type} is not a reviewer of {ref}")
    rnd["reports"][agent_type] = {"at": stamp(now), "findings": report["findings"],
                                  "verdict": report.get("verdict"), "clean_scope": report.get("clean_scope")}
    if set(rnd["reports"]) == set(rnd["expected"]):
        rnd["findings"] = [dict(f, reviewer=t) for t in rnd["expected"] for f in rnd["reports"][t]["findings"]]
        if rnd["findings"]:
            rnd["status"] = "awaiting_assessment"
        else:
            _complete_without_assessment(state, rnd)
    return rnd


def record_assessment(state: dict, ref: str, assessment: dict, now: datetime) -> dict:
    rnd = find_round(state, ref)
    rnd.update(status="assessed", assessment=assessment, assessed_at=stamp(now))
    if rnd["escalation"]:
        state["epoch"] += 1
    return rnd


def ingest_poll(state: dict, drop: dict, now: datetime) -> dict | None:
    """Turn one poller result into a GitHub round. Returns the round it opened, if any."""
    state["pr"] = drop["pr"]
    if drop["status"] == "clean":
        state["github_clean_sha"] = drop["head_sha"]
        return None
    reported = [{"id": t["url"], "title": t["gist"], "file": t["path"], "line": t["line"],
                 "severity": t["severity"], "reviewer": t["by"], "outdated": t["outdated"]} for t in drop["threads"]]
    reported += [{"id": c["url"], "title": c["gist"], "file": None, "line": None, "severity": "",
                  "reviewer": "gate-comment", "outdated": False} for c in drop["gate_comments"]]
    seen = {f["id"] for r in state["rounds"] if r["stage"] == "github" for f in r["findings"]}
    fresh = [f for f in reported if f["id"] not in seen]
    if not fresh:
        return None
    return _append_round(state, "github", now, status="awaiting_assessment", head_sha=drop["head_sha"],
                         base_sha=None, scope="threads", expected=[], escalation=False, findings=fresh,
                         carried=[f["id"] for f in reported if f["id"] in seen],
                         failing_checks=drop["failing_checks"])


def ingest_inbox(state: dict, now: datetime) -> None:
    inbox = state_root() / "inbox"
    for path in sorted(inbox.glob(f"{_flat(state['repo'])}__*.json")):
        drop = json.loads(path.read_text())
        if drop["head_ref"] == state["branch"]:
            ingest_poll(state, drop, now)
            path.unlink()


def unlock(state: dict, reason: str, now: datetime) -> None:
    state["unlocked_at"] = stamp(now)
    state["unlocked_epoch"] = state["epoch"]
    state.setdefault("unlocks", []).append({"at": stamp(now), "reason": reason})


def adjudicated(state: dict) -> list[dict]:
    """Every finding an assessor has ruled on, for reviewers of later rounds."""
    out = []
    for rnd in state["rounds"]:
        if rnd["status"] != "assessed":
            continue
        by_id = {f["id"]: f for f in rnd["findings"]}
        for entry in rnd["assessment"]["findings"]:
            found = by_id[entry["id"]]
            out.append({"id": entry["id"], "round": f"{rnd['stage']} {rnd['n']}", "title": found["title"],
                        "file": found["file"], "verdict": entry["verdict"], "reason": entry["reason"]})
    return out


def main() -> None:
    import worktree

    parser = argparse.ArgumentParser(description="Inspect or unlock a branch's review ledger.")
    parser.add_argument("command", choices=["status", "unlock"])
    parser.add_argument("--worktree", required=True)
    parser.add_argument("--reason")
    opts = parser.parse_args()
    where = worktree.locate(opts.worktree)
    if where is None:
        sys.exit(f"{opts.worktree} is not a branch checkout of a GitHub repo")
    with open_state(where.slug, where.branch) as state:
        if opts.command == "unlock":
            if not opts.reason:
                sys.exit("unlock needs --reason")
            unlock(state, opts.reason, datetime.now(timezone.utc))
        print(json.dumps(state, indent=1))


if __name__ == "__main__":
    main()
