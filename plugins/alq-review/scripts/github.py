"""The GitHub lookups the gate needs, through the gh CLI (which carries the bot's token).

Most return None when gh cannot answer, and the caller decides what an unknown means there. pr_target,
issue_comments and write_issue_comment raise RuntimeError instead.
"""
from __future__ import annotations

import json
import subprocess

# How the org pr-gate (analitiq-ai/.github pr-gate.js) marks a version-only release: the title of its
# `internal-review` check run. Only a run the App posted is its word: an agent's token could post the same text.
GATE_APP = "analitiq-pr-gate"
RELEASE_CHECK = "internal-review"
RELEASE_PREFIX = "version-only release:"


def _answer(*args: str, stdin: str | None = None) -> str:
    """gh's answer; RuntimeError in gh's own words when it gives none."""
    try:
        done = subprocess.run(["gh", *args], input=stdin, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(f"gh {' '.join(args[:2])} could not run: {exc}") from exc
    if done.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args[:2])} failed: {done.stderr.strip() or f'exit {done.returncode}'}")
    return done.stdout.strip()


def _gh(*args: str) -> str | None:
    try:
        return _answer(*args)
    except RuntimeError:
        return None


def issue_state(slug: str, number: int) -> str | None:
    """`OPEN` or `CLOSED`."""
    return _gh("issue", "view", str(number), "--repo", slug, "--json", "state", "--jq", ".state") or None


def issue_comments(slug: str, number: int) -> list[tuple[int, str]]:
    """(id, body) of every comment on issue `number`. RuntimeError when gh cannot read them."""
    lines = _answer("api", "--paginate", f"repos/{slug}/issues/{number}/comments", "--jq", ".[] | {id, body}")
    return [(comment["id"], comment["body"]) for comment in map(json.loads, lines.splitlines())]


def write_issue_comment(slug: str, number: int, body: str, comment_id: int | None) -> str:
    """Writes `body` over comment `comment_id`, or as a new comment on issue `number` when that is None; the
    comment's URL."""
    method, path = (("POST", f"repos/{slug}/issues/{number}/comments") if comment_id is None
                    else ("PATCH", f"repos/{slug}/issues/comments/{comment_id}"))
    # The body goes in on stdin: it holds text a user typed, which must not reach a command line.
    return _answer("api", "-X", method, path, "-F", "body=@-", "--jq", ".html_url", stdin=body)


def repo_visibility(slug: str) -> str | None:
    private = _gh("api", f"repos/{slug}", "--jq", ".private")
    return {"true": "private", "false": "public"}.get(private or "")


def pr_head(slug: str, pr: int) -> tuple[str, str] | None:
    """(branch, commit) a PR currently points at."""
    found = _gh("pr", "view", str(pr), "--repo", slug, "--json", "headRefName,headRefOid",
                "--jq", '.headRefName + " " + .headRefOid')
    return tuple(found.split(" ")) if found else None


def pr_target(slug: str, branch: str) -> tuple[int, str] | None:
    """(number, branch it merges into) of `branch`'s open PR; None when it has none."""
    found = _answer("pr", "list", "--repo", slug, "--head", branch, "--state", "open", "--json", "number,baseRefName",
                    "--jq", '.[0] | if . then "\\(.number) \\(.baseRefName)" else "" end')
    if not found:
        return None
    number, target = found.split(" ")
    return int(number), target


def version_only_release(runs: list[dict]) -> str | None:
    """pr-gate's version-only release title among a commit's check runs, or None. Only the App's newest
    `internal-review` run counts, since a later re-evaluation may have demoted it. Newest is ordered as pr-gate's own
    newestRun orders it: by start, then by id, which GitHub hands out in order."""
    own = [r for r in runs if r["name"] == RELEASE_CHECK and (r.get("app") or {}).get("slug") == GATE_APP]
    if not own:
        return None
    newest = max(own, key=lambda r: (r["started_at"], r["id"]))
    title = (newest.get("output") or {}).get("title") or ""
    if newest["status"] != "completed" or newest["conclusion"] != "success" or not title.startswith(RELEASE_PREFIX):
        return None
    return title


def released(slug: str, commit: str) -> str | None:
    """Whether pr-gate passed `commit` as a version-only release; None also when gh cannot answer."""
    found = _gh("api", "--paginate", f"repos/{slug}/commits/{commit}/check-runs?check_name={RELEASE_CHECK}",
                "--jq", ".check_runs[]")
    return version_only_release([json.loads(line) for line in found.splitlines()]) if found else None
