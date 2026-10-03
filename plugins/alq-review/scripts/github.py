"""The GitHub lookups the gate needs, through the gh CLI (which carries the bot's token).

Each returns None when gh cannot answer, and the caller decides what an unknown means there; except
pr_target, whose unknown no caller may read as an answer.
"""
from __future__ import annotations

import json
import subprocess

SPEC_MARKER = "<!-- analitiq-spec -->"

# How the org pr-gate (analitiq-org-github) marks a version-only release on `internal-review`. Only a status the
# Actions app created is its word: an agent's token could post the same text.
RELEASE_CONTEXT = "internal-review"
RELEASE_CREATOR = "github-actions[bot]"
RELEASE_PREFIX = "version-only release:"


def _answer(*args: str) -> str:
    """gh's answer; RuntimeError in gh's own words when it gives none."""
    try:
        done = subprocess.run(["gh", *args], capture_output=True, text=True, timeout=20)
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


def version_only_release(statuses: list[dict]) -> str | None:
    """pr-gate's version-only release description among a commit's statuses (newest first), or None. Only the
    newest status of the context counts: a later push re-evaluation may have demoted it."""
    newest = next((s for s in statuses if s.get("context") == RELEASE_CONTEXT), None)
    if (newest is None or newest.get("state") != "success"
            or (newest.get("creator") or {}).get("login") != RELEASE_CREATOR
            or not (newest.get("description") or "").startswith(RELEASE_PREFIX)):
        return None
    return newest["description"]


def released(slug: str, commit: str) -> str | None:
    """Whether pr-gate passed `commit` as a version-only release; None also when gh cannot answer."""
    found = _gh("api", f"repos/{slug}/commits/{commit}/statuses")
    return version_only_release(json.loads(found)) if found else None
