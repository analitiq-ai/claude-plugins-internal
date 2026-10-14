"""The GitHub lookups the gate needs, through the gh CLI (which carries the bot's token).

Most return None when gh cannot answer, and the caller decides what an unknown means there. pr_target raises
RuntimeError instead.
"""
from __future__ import annotations

import json
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass

# How the org pr-gate (analitiq-ai/.github pr-gate.js) marks a version-only release: the title of its
# `internal-review` check run. Only a run the App posted is its word: an agent's token could post the same text.
GATE_APP = "analitiq-pr-gate"
RELEASE_CHECK = "internal-review"
RELEASE_PREFIX = "version-only release:"
# The label that exempts a PR from alq-review's review gates (ADR-0021).
CLEANUP_LABEL = "cleanup"
CLEANUP_EXEMPTION = "To exempt this PR from review, the user adds the `cleanup` label to it on GitHub; an agent does not."


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


def is_cleanup(labels: list[str]) -> bool:
    """Whether a PR with these labels is a cleanup PR. GitHub matches label names without case, so this does too."""
    return any(name.casefold() == CLEANUP_LABEL for name in labels)


@dataclass(frozen=True)
class Cleanup:
    """Whether a PR carries the `cleanup` label. `unread` says why GitHub could not tell; such a PR is not labelled."""
    labelled: bool = False
    unread: str = ""

    def __post_init__(self):
        if self.labelled and self.unread:
            raise ValueError("a PR whose label could not be read is not labelled")

    def refusal(self) -> str:
        """The refusal of a PR whose label could not be read: it is told to retry, not to get a review (FR-007)."""
        return (f"The `cleanup` label could not be read ({self.unread}), so alq-review gates the PR as unlabelled. "
                "Retry once GitHub answers.")


def read_cleanup(labels_of: Callable[[], list[list[str]]]) -> Cleanup:
    """`labels_of` gives the label names of each PR in question, or raises RuntimeError. There must be a PR, and each
    must carry the label."""
    try:
        found = labels_of()
    except RuntimeError as exc:
        return Cleanup(unread=str(exc))
    return Cleanup(labelled=bool(found) and all(map(is_cleanup, found)))


def label_names(labels) -> list[str]:
    """The names in a `labels` field of gh's JSON; RuntimeError when it is not a list of named labels."""
    if not isinstance(labels, list) or not all(isinstance(label, dict) and isinstance(label.get("name"), str)
                                               for label in labels):
        raise RuntimeError(f"gh gave labels that are not a list of named labels: {labels!r:.200}")
    return [label["name"] for label in labels]


def _json(text: str):
    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"gh gave an answer that is not JSON: {text!r:.200}") from exc


def pr_labels(slug: str, pr: int) -> list[str]:
    """The label names of one PR; RuntimeError when gh cannot say them."""
    found = _json(_answer("pr", "view", str(pr), "--repo", slug, "--json", "labels"))
    if not isinstance(found, dict):
        raise RuntimeError(f"gh gave a PR that is not an object: {found!r:.200}")
    return label_names(found.get("labels"))


def branch_labels(slug: str, branch: str) -> list[list[str]]:
    """The label names of each open PR of `branch`, none when it has none; RuntimeError when gh cannot say them."""
    found = _json(_answer("pr", "list", "--repo", slug, "--head", branch, "--state", "open", "--json", "number,labels"))
    if not isinstance(found, list) or not all(isinstance(pr, dict) for pr in found):
        raise RuntimeError(f"gh gave open PRs that are not a list of objects: {found!r:.200}")
    return [label_names(pr.get("labels")) for pr in found]


USAGE = "usage: github.py cleanup <owner/repo> <pr-number>"


def main(argv: list[str]) -> int:
    """`cleanup <owner/repo> <pr>` prints `cleanup` or `gated`: the poller's one way to ask, so it decides as the
    hooks do."""
    if len(argv) != 3 or argv[0] != "cleanup" or not (argv[2].isascii() and argv[2].isdigit()):
        print(USAGE, file=sys.stderr)
        return 2
    cleanup = read_cleanup(lambda: [pr_labels(argv[1], int(argv[2]))])
    if cleanup.unread:
        print(cleanup.unread, file=sys.stderr)
        return 1
    print("cleanup" if cleanup.labelled else "gated")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
