"""Round ledger: what each review round on a PR found and how it was assessed.

State lives outside every repo so that the poller, which knows a PR but no checkout,
and the hooks, which know a checkout but no PR, meet in one place: one SQLite file whose
ledgers are keyed by PR. Which PR a checkout means is GitHub's answer, cached per commit.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import sys
from contextlib import closing, contextmanager
from datetime import datetime, timezone
from pathlib import Path

LOCAL_STAGES = ("internal", "audit")
COUNTED = ("assessed", "clean")
# '#' and ':' occur in no repo slug, so the PR and the round split off unambiguously.
ROUND_REF = re.compile(r"(?P<repo>[\w.-]+/[\w.-]+)#(?P<pr>\d+):[a-z]+-\d+\.\d+")
SCHEMA = """
CREATE TABLE IF NOT EXISTS ledgers (
  repo TEXT    NOT NULL,
  pr   INTEGER NOT NULL,
  doc  TEXT    NOT NULL,
  PRIMARY KEY (repo, pr)
);
CREATE TABLE IF NOT EXISTS open_prs (
  repo   TEXT NOT NULL,
  branch TEXT NOT NULL,
  head   TEXT NOT NULL,
  pr     INTEGER NOT NULL,
  PRIMARY KEY (repo, branch, head)
);
"""


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


def new_state(repo: str, branch: str | None, pr: int | None = None) -> dict:
    return {"repo": repo, "branch": branch, "pr": pr, "epoch": 0, "rounds": [],
            "unlocked_at": None, "unlocked_epoch": 0, "github_clean_sha": None}


def _connect() -> sqlite3.Connection:
    root = state_root()
    root.mkdir(parents=True, exist_ok=True)
    # A writer may hold the ledger across a GitHub or git fetch call; the others wait it out rather than fail.
    conn = sqlite3.connect(root / "ledger.db", timeout=60, isolation_level=None)
    conn.execute("PRAGMA journal_mode = WAL")
    conn.executescript(SCHEMA)
    return conn


@contextmanager
def _transaction():
    conn = _connect()
    try:
        conn.execute("BEGIN IMMEDIATE")
        try:
            yield conn
        except BaseException:
            conn.execute("ROLLBACK")
            raise
        conn.execute("COMMIT")
    finally:
        conn.close()


def _load(conn: sqlite3.Connection, repo: str, pr: int) -> dict:
    row = conn.execute("SELECT doc FROM ledgers WHERE repo = ? AND pr = ?", (repo, pr)).fetchone()
    return json.loads(row[0]) if row else new_state(repo, None, pr)


def _save(conn: sqlite3.Connection, state: dict) -> None:
    conn.execute("INSERT INTO ledgers (repo, pr, doc) VALUES (?, ?, ?) "
                 "ON CONFLICT (repo, pr) DO UPDATE SET doc = excluded.doc",
                 (state["repo"], state["pr"], json.dumps(state)))


@contextmanager
def open_ledger(repo: str, pr: int):
    """PR `pr`'s ledger, created on its first opening. No other writer reads it until the block ends, and it is
    saved only if the block completes."""
    with _transaction() as conn:
        state = _load(conn, repo, pr)
        yield state
        _save(conn, state)


@contextmanager
def open_checkouts_ledger(repo: str, pr: int, branch: str, head: str):
    """PR `pr`'s ledger, opened as open_ledger opens it, for a checkout of `branch` at commit `head` that GitHub has
    just said means `pr`. That answer is saved with it, so every later lookup at `head` agrees with what the block
    records, a PR opened in place of another at the same commit included."""
    with _transaction() as conn:
        state = _load(conn, repo, pr)
        state["branch"] = branch
        yield state
        _save(conn, state)
        _keep_open_pr(conn, repo, branch, head, pr)


def read(repo: str, pr: int) -> dict:
    """PR `pr`'s ledger as saved, or an empty one that is not saved: reading never creates a ledger."""
    with closing(_connect()) as conn:
        return _load(conn, repo, pr)


def all_states() -> list[dict]:
    with closing(_connect()) as conn:
        return [json.loads(doc) for (doc,) in conn.execute("SELECT doc FROM ledgers")]


def names(repo: str, branch: str) -> bool:
    """Whether any ledger is of a PR whose head branch is `branch`."""
    with closing(_connect()) as conn:
        return conn.execute("SELECT 1 FROM ledgers WHERE repo = ? AND json_extract(doc, '$.branch') = ? LIMIT 1",
                            (repo, branch)).fetchone() is not None


def _keep_open_pr(conn: sqlite3.Connection, repo: str, branch: str, head: str, pr: int) -> None:
    conn.execute("INSERT OR REPLACE INTO open_prs (repo, branch, head, pr) VALUES (?, ?, ?, ?)", (repo, branch, head, pr))


def open_pr(repo: str, branch: str, head: str, ask) -> int | None:
    """`branch`'s open PR while it is at commit `head`. `ask()` is GitHub; a PR it names is kept for that commit.
    'No open PR' is not kept, since opening one does not move the branch. An exception from `ask` is no answer."""
    with closing(_connect()) as conn:
        row = conn.execute("SELECT pr FROM open_prs WHERE repo = ? AND branch = ? AND head = ?",
                           (repo, branch, head)).fetchone()
    if row:
        return row[0]
    pr = ask()
    if pr is not None:
        with _transaction() as conn:
            _keep_open_pr(conn, repo, branch, head, pr)
    return pr


def parse_ref(ref: str) -> tuple[str, int]:
    found = ROUND_REF.fullmatch(ref)
    if found is None:
        raise LedgerError(f"{ref!r} is not a round ref <owner>/<repo>#<pr>:<stage>-<epoch>.<n>")
    return found["repo"], int(found["pr"])


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
           "ref": f"{state['repo']}#{state['pr']}:{stage}-{state['epoch']}.{n}",
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


def ingest_inbox(now: datetime) -> None:
    """Store every poller drop in the ledger of its PR."""
    for path in sorted((state_root() / "inbox").glob("*.json")):
        drop = json.loads(path.read_text())
        with open_ledger(drop["repo"], drop["pr"]) as state:
            state["branch"] = drop["head_ref"]
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
    import gate
    import worktree

    parser = argparse.ArgumentParser(description="Inspect or unlock the review ledger of a checkout's PR.")
    parser.add_argument("command", choices=["status", "unlock"])
    parser.add_argument("--worktree", required=True)
    parser.add_argument("--reason")
    opts = parser.parse_args()
    where = worktree.locate(opts.worktree)
    if where is None:
        sys.exit(f"{opts.worktree} is not a branch checkout of a GitHub repo")
    pr = gate.pr_of(where)
    if pr is None:
        sys.exit(f"no PR under review for {where.branch}")
    with open_ledger(where.slug, pr) as state:
        if opts.command == "unlock":
            if not opts.reason:
                sys.exit("unlock needs --reason")
            unlock(state, opts.reason, datetime.now(timezone.utc))
        print(json.dumps(state, indent=1))


if __name__ == "__main__":
    main()
