"""Codex's state for a review round, read from its status card and checked against what Codex is known to post.

The poller hands every Codex comment and PR review on the PR, the trigger time and the head; this decides whether
Codex has not started, is reviewing, has answered the head, reviewed a commit that is no longer the head, replied
with something not on the list below, or posted a card this cannot read. Pure: the poller fetches and prints.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime, timezone

CARD_MARKER = "<!-- codex-pull-request-review-summary -->"

# What Codex posts while and after it reviews, as observed on 2026-10-13. Anything else since the trigger is
# reported: a refusal ("To use Codex here…", "Something went wrong", a usage limit) or a format Codex changed.
FORMS = (
    ("verdict", "comment", "Codex Review: Didn't find any major issues."),
    ("security", "comment", "### 🛡️ Codex Security Review"),
    ("review", "review", "### 💡 Codex Review"),
)

TIME = "%Y-%m-%dT%H:%M:%SZ"
CARD_TIMES = ("%Y-%m-%dT%H:%M:%S.%fZ", TIME)

ROW = "**Code Review**"
STATUS = re.compile(r"\*\*(Running|Completed)\*\*")
DATETIME = re.compile(r'datetime="([^"]*)"')
COMMIT = re.compile(r"\b[0-9a-f]{7,40}\b")


class Unreadable(ValueError):
    pass


def match(item: dict) -> str | None:
    """The name of the form `item` has, or None when it has none."""
    body = item["body"].lstrip()
    if item["kind"] == "comment" and body.split("\n", 1)[0].rstrip("\r") == CARD_MARKER:
        return "card"
    return next((name for name, kind, prefix in FORMS if item["kind"] == kind and body.startswith(prefix)), None)


def parse_time(text: str, formats: tuple[str, ...] = (TIME,)) -> datetime:
    for fmt in formats:
        try:
            return datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            pass
    raise ValueError(text)


def read_card(url: str, body: str) -> tuple[dict | None, list[str]]:
    """The card's Code Review row as {status, status_at, at, commit}, or None with the reasons it cannot be read."""
    rows = [cells for cells in ([c.strip() for c in line.strip().strip("|").split("|")]
                                for line in body.splitlines() if line.lstrip().startswith("|"))
            if ROW in cells[0]]
    if len(rows) != 1:
        return None, [cannot_read(url, f"{len(rows)} Code Review rows" if rows else "no Code Review row")]
    cells = rows[0] + ["", ""]
    status_cell, commit_cell = cells[1], cells[2]
    errors, row = [], {}
    if status := STATUS.search(status_cell):
        row["status"] = status.group(1)
    else:
        errors.append("status is neither Running nor Completed")
    if stamp := DATETIME.search(status_cell):
        try:
            row["at"] = parse_time(stamp.group(1), CARD_TIMES)
            row["status_at"] = row["at"].strftime(TIME)
        except ValueError:
            errors.append(f"datetime {stamp.group(1)} is not in the card's format")
    else:
        errors.append("no datetime in the Status cell")
    if commit := COMMIT.search(commit_cell):
        row["commit"] = commit.group(0)
    else:
        errors.append("no commit in the Commit cell")
    return (None, [cannot_read(url, why) for why in errors]) if errors else (row, [])


def cannot_read(url: str, why: str) -> str:
    return (f"Codex status card {url} cannot be read: {why}; its format changed: "
            "report it on the plugin's repo and read the PR by hand")


def state(items: list[dict], since: str, head: str) -> dict:
    """Codex's state for the round that started at `since`, on `head`, from every Codex comment and review."""
    trigger = parse_time(since)
    cards = sorted((i for i in items if match(i) == "card"), key=lambda i: i["at"])
    said = sorted((i for i in items if match(i) != "card" and parse_time(i["at"]) > trigger), key=lambda i: i["at"])
    unknown = [i for i in said if match(i) is None]
    out = {"state": "not_started", "commit": None, "status_at": None, "spoke": bool(said),
           "comments": [{"url": i["url"], "at": i["at"], "body": i["body"]}
                        for i in said if i["kind"] == "comment" or i in unknown],
           "unknown": [{"kind": i["kind"], "url": i["url"], "at": i["at"]} for i in unknown], "errors": []}

    if len(cards) > 1:
        return dict(out, state="unreadable", unknown=[],
                    errors=[cannot_read(cards[0]["url"], f"{len(cards)} comments carry the marker")])
    row = None
    if cards:
        row, errors = read_card(cards[0]["url"], cards[0]["body"])
        if errors:
            return dict(out, state="unreadable", unknown=[], errors=errors)

    # A row that reached its status before the trigger belongs to an earlier round.
    if row and row["at"] > trigger:
        if row["status"] == "Running":
            decided = "reviewing"
        else:
            decided = "answered" if head.startswith(row["commit"]) else "superseded"
        return dict(out, state=decided, commit=row["commit"], status_at=row["status_at"])
    if unknown:
        return dict(out, state="declined")
    if row:
        return dict(out, commit=row["commit"], status_at=row["status_at"])
    return out


def read_input(text: str) -> tuple[list[dict], str, str]:
    try:
        given = json.loads(text)
    except json.JSONDecodeError as e:
        raise Unreadable(f"stdin is not JSON: {e}") from e
    if not isinstance(given, dict):
        raise Unreadable("stdin is not a JSON object")
    since, head, items = given.get("since"), given.get("head"), given.get("items")
    if not isinstance(since, str) or not isinstance(head, str) or not isinstance(items, list):
        raise Unreadable("the object needs a string since, a string head and a list items")
    try:
        parse_time(since)
    except ValueError as e:
        raise Unreadable(f"since {since} is not {TIME}") from e
    for i in items:
        if not (isinstance(i, dict) and i.get("kind") in ("comment", "review")
                and all(isinstance(i.get(k), str) for k in ("url", "at", "body"))):
            raise Unreadable(f"an item is not {{kind: comment|review, url, at, body}}: {json.dumps(i)[:200]}")
        try:
            parse_time(i["at"])
        except ValueError as e:
            raise Unreadable(f"item {i['url']} has at {i['at']}, not {TIME}") from e
    return items, since, head


def main() -> None:
    try:
        items, since, head = read_input(sys.stdin.read())
    except Unreadable as e:
        print(f"codexstate: {e}", file=sys.stderr)
        sys.exit(2)
    print(json.dumps(state(items, since, head)))


if __name__ == "__main__":
    main()
