#!/usr/bin/env python3
"""PreToolUse/Bash gate: no `gh pr ready` or `gh pr merge` without a current
internal-review attestation, and no `--admin` bypass unless the user asked for it.

Where a repo has branch protection, the server already blocks a merge on red CI,
a missing or stale Codex verdict, an unresolved review thread and a missing
approval, and this gate deliberately re-checks none of it: a local second copy
of those rules drifts from the server's and starts disagreeing with it, and the
disagreement gets resolved in favour of whichever copy was easier to edit. What
is left is the one line of the pre-merge checklist no GitHub check can observe
-- the internal pr-review-toolkit pass -- plus the two ways to step around the
server's rules entirely.

That leaves a gap this file does not close. Branch protection is a paid feature
for private repos, so on a repo that cannot enable it nothing enforces CI,
threads or approvals and this gate is the only one there is -- it still checks
only the internal review. Messages here therefore never claim the server is
covering the rest.

The attestation is a PR comment carrying MARKER and naming the commit it
reviewed, the same shape codex-gate.yml demands of Codex. Binding it to a SHA is
what makes it evidence instead of a checkbox: a push moves the head and the
attestation for the old head stops counting, so "internally reviewed" can never
quietly mean "internally reviewed, four commits ago". Ten hex digits minimum,
for the reason codex-gate gives: a 7-character prefix is cheap enough to collide
on purpose.

A PR the org pr-gate passed as a version-only release (its `internal-review`
check run, posted by the analitiq-pr-gate App, is titled "version-only release:
OLD -> NEW") needs no attestation: it only moves its package's own version up.
alq-review's github.py reads that verdict; this hook imports it from the same
checkout rather than keeping a copy that drifts when the gate changes.

The user can overrule the reviewers. Analitiq-Bot is an org admin, and the user and
every agent session act as it, so GitHub cannot tell the user's override from an
agent's: the permission is taken from the user's own words instead. A prompt that
*starts* with `override-merge #N` grants one `gh pr merge` of PR N in that session,
past both this gate and the server's rules. It must start the prompt because the
cron bot's prompts quote issue and PR text that anyone can write.

Reads the PreToolUse or UserPromptSubmit payload on stdin. Fails closed once a gated command is
recognised -- an unresolvable PR or an unreachable GitHub ends in deny, because
a false deny costs one command and a false allow costs a merge.
"""

from __future__ import annotations

import fcntl
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

MARKER = "<!-- analitiq-internal-review -->"

# The commit the attestation covers. Bold markers optional because GitHub
# surfaces render the same body differently; backticks optional for the same
# reason. Ten hex digits minimum -- see the module docstring.
REVIEWED_COMMIT = re.compile(r"\*{0,2}Reviewed commit:\*{0,2}\s*[`'\"]?([0-9a-f]{10,40})", re.I)

PR_URL = re.compile(r"^https://github\.com/([^/]+/[^/]+)/pull/\d+$")

GATED = {"merge", "ready"}

# Flags that consume the next token, so a positional scan cannot mistake their
# value for the PR argument. `gh pr merge -b 480` merges the current branch with
# body "480", not PR 480.
VALUE_FLAGS = {
    "-A", "--author-email",
    "-b", "--body",
    "-F", "--body-file",
    "-t", "--subject",
    "-R", "--repo",
    "--match-head-commit",
}

SEPARATORS = {";", "&&", "||", "|", "&", "(", ")"}

# The REST merge endpoint, which would otherwise walk straight around this gate.
API_MERGE = re.compile(r"pulls/\d+/merge")

OVERRIDE = re.compile(r"override-merge\s+#(\d+)\b")
SESSION_ID = re.compile(r"[\w-]+")


def deny(reason: str) -> int:
    json.dump(
        {
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "permissionDecision": "deny",
                "permissionDecisionReason": reason,
            }
        },
        sys.stdout,
    )
    return 0


def tokenize(command: str) -> list[str] | None:
    """Split a shell command, keeping separators as their own tokens.

    punctuation_chars is what makes `gh pr merge 480; echo hi` yield '480' and
    ';' rather than the token '480;' -- without it the PR argument silently
    carries the separator and every downstream comparison misses.
    """
    lexer = shlex.shlex(command, posix=True, punctuation_chars=True)
    lexer.whitespace_split = True
    try:
        return list(lexer)
    except ValueError:
        return None  # unbalanced quote; caller decides


def find_invocation(tokens: list[str]) -> int | None:
    """Index of the `merge`/`ready` token of a `gh pr ...` call."""
    for i in range(len(tokens) - 2):
        token = tokens[i]
        if token != "gh" and not token.endswith("/gh"):
            continue
        if tokens[i + 1] == "pr" and tokens[i + 2] in GATED:
            return i + 2
    return None


def arguments(tokens: list[str], subcommand_at: int) -> list[str]:
    """Tokens belonging to this invocation, stopping at the next command."""
    args = []
    for token in tokens[subcommand_at + 1:]:
        if token in SEPARATORS:
            break
        args.append(token)
    return args


def target(args: list[str]) -> tuple[str | None, str | None]:
    """The PR reference and the -R/--repo override, if either was given."""
    pr_ref = repo = None
    pending = None
    for token in args:
        if pending is not None:
            if pending in ("-R", "--repo"):
                repo = token
            pending = None
            continue
        if token.startswith("--") and "=" in token:
            name, _, value = token.partition("=")
            if name == "--repo":
                repo = value
            continue
        if token in VALUE_FLAGS:
            pending = token
            continue
        if token.startswith("-"):
            continue
        if pr_ref is None:
            pr_ref = token
    return pr_ref, repo


def api_merge_bypass(tokens: list[str]) -> bool:
    """A `gh api --method PUT .../pulls/N/merge` call, which this gate must refuse."""
    if not any(t == "gh" or t.endswith("/gh") for t in tokens):
        return False
    if "api" not in tokens:
        return False
    if not any(API_MERGE.search(t) for t in tokens):
        return False
    return any(
        t.upper() == "PUT" or t.upper().endswith("=PUT")
        for t in tokens
    )


def fetch(pr_ref: str | None, repo: str | None) -> tuple[dict | None, str]:
    """The PR this command would act on. Returns (pr, error); both never set."""
    args = ["gh", "pr", "view"]
    if pr_ref:
        args.append(pr_ref)
    if repo:
        args += ["-R", repo]
    args += ["--json", "number,headRefOid,isDraft,url,comments"]
    try:
        done = subprocess.run(args, capture_output=True, text=True, timeout=30)
    except subprocess.TimeoutExpired:
        return None, "`gh pr view` timed out after 30s"
    except OSError as exc:
        return None, f"could not run `gh pr view`: {exc}"
    if done.returncode != 0:
        return None, done.stderr.strip() or f"`gh pr view` exited {done.returncode}"
    try:
        return json.loads(done.stdout), ""
    except json.JSONDecodeError as exc:
        return None, f"could not parse `gh pr view` output: {exc}"


def _overrides(session: str) -> Path | None:
    if not SESSION_ID.fullmatch(session or ""):
        return None  # not a name to build a path from; such a session holds no override
    root = Path(os.environ.get("XDG_STATE_HOME") or Path.home() / ".local" / "state") / "analitiq-merge-gate"
    root.mkdir(parents=True, exist_ok=True)
    return root / f"{session}.json"


def _update_overrides(session: str, change) -> bool:
    """Apply `change` to the session's granted PR numbers under one lock; returns what it returns."""
    path = _overrides(session)
    if path is None:
        return False
    with open(path.with_suffix(".lock"), "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        granted = set(json.loads(path.read_text())) if path.exists() else set()
        result = change(granted)
        path.write_text(json.dumps(sorted(granted)))
    return result


def grant(payload: dict) -> int:
    typed = OVERRIDE.match((payload.get("prompt") or "").lstrip())
    if not typed:
        return 0
    number = int(typed.group(1))

    def add(granted):
        granted.add(number)
        return True
    if _update_overrides(payload.get("session_id"), add):
        json.dump({"hookSpecificOutput": {"hookEventName": "UserPromptSubmit", "additionalContext":
                   f"The user granted one `gh pr merge {number}` past its unmet requirements, "
                   f"`--admin` included."}}, sys.stdout)
    return 0


def spend_override(session: str, number: int) -> bool:
    def spend(granted):
        if number not in granted:
            return False
        granted.discard(number)
        return True
    return _update_overrides(session, spend)


def attested(comments: list[dict], head: str) -> bool:
    """Does any attestation comment name the commit that is currently the head?"""
    for comment in comments:
        body = comment.get("body") or ""
        if MARKER not in body:
            continue
        found = REVIEWED_COMMIT.search(body)
        if found and head.startswith(found.group(1).lower()):
            return True
    return False


def released(pr: dict, head: str) -> bool:
    """Did pr-gate pass the head as a version-only release? An unreadable answer is no."""
    # Imported here, under main()'s refuse-on-error guard: a reader that fails to load must close the gate, not crash
    # the hook, which Claude Code treats as a non-blocking error.
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "plugins" / "alq-review" / "scripts"))
    import github
    repo = PR_URL.match(pr.get("url") or "")
    return repo is not None and github.released(repo.group(1), head) is not None


def how_to_attest(number: int, head: str, verb: str) -> str:
    return (
        f"No internal-review attestation for {head[:10]} on PR #{number}, so `gh pr {verb}` "
        "is blocked. This gate checks one thing: that the internal pr-review-toolkit pass "
        "ran clean on the commit being merged. It is recorded on the PR because no GitHub "
        "check can observe it.\n\n"
        "Run the internal review. When it comes back clean on this exact commit, post:\n\n"
        f"  gh pr comment {number} --body '{MARKER}\n"
        "  Internal review clean.\n"
        f"  Reviewed commit: `{head}`'\n\n"
        "An attestation naming an older commit does not count: every push voids it, "
        "the same way it voids the Codex verdict."
    )


def refuse_admin(number) -> int:
    return deny(
        "`gh pr merge --admin` merges in spite of every check the branch requires -- "
        "CI, DeepSource, the Codex verdict, unresolved threads, the approval. Only the "
        f"user overrules them: they start a prompt with `override-merge #{number}`. "
        "Tell them what is unmet and stop."
    )


def gated(tokens: list[str], session: str) -> int:
    if api_merge_bypass(tokens):
        return deny(
            "Merging through `gh api` steps around the internal-review gate. "
            "Use `gh pr merge` so the attestation is checked."
        )

    subcommand_at = find_invocation(tokens)
    if subcommand_at is None:
        return 0
    verb = tokens[subcommand_at]
    args = arguments(tokens, subcommand_at)

    # Neither of these merges or publishes anything.
    if verb == "ready" and "--undo" in args:
        return 0
    if verb == "merge" and "--disable-auto" in args:
        return 0

    pr_ref, repo = target(args)
    if shutil.which("gh") is None:
        # A bare `gh` cannot run either; one named by path still can.
        return refuse_admin(pr_ref or "N") if "--admin" in args else 0

    pr, error = fetch(pr_ref, repo)
    if pr is None:
        return deny(
            f"Cannot verify the pre-merge state of this PR, so `gh pr {verb}` is blocked: "
            f"{error}. Resolve that and retry -- this gate refuses rather than guesses."
        )

    if verb == "merge" and spend_override(session, pr.get("number")):
        return 0

    if "--admin" in args:
        return refuse_admin(pr.get("number"))

    if verb == "ready" and not pr.get("isDraft"):
        return 0  # already published; nothing to gate

    head = (pr.get("headRefOid") or "").lower()
    if not head:
        return deny(f"`gh pr view` returned no head commit for PR {pr.get('number')}.")

    if attested(pr.get("comments") or [], head) or released(pr, head):
        return 0

    return deny(how_to_attest(pr.get("number"), head, verb))


def main() -> int:
    try:
        payload = json.loads(sys.stdin.read() or "{}")
    except json.JSONDecodeError:
        return 0
    if payload.get("hook_event_name") == "UserPromptSubmit":
        return grant(payload)
    command = (payload.get("tool_input") or {}).get("command") or ""
    if "gh" not in command:
        return 0

    tokens = tokenize(command)
    if tokens is None:
        # Unparseable quoting. Only refuse when the text plainly names a gated
        # call: guessing at everything else would block unrelated work.
        if re.search(r"\bgh\s+pr\s+(merge|ready)\b", command):
            return deny(
                "This command names `gh pr merge`/`gh pr ready` but could not be parsed "
                "(unbalanced quote), so the pre-merge gate cannot read its arguments. "
                "Rewrite it as a plain invocation."
            )
        return 0

    try:
        return gated(tokens, payload.get("session_id"))
    except Exception as exc:  # a broken gate must not become an open gate
        return deny(f"pre-merge gate failed and is refusing by default: {exc}")


if __name__ == "__main__":
    raise SystemExit(main())
