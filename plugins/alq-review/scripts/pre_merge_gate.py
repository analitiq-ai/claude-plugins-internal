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

The attestation is a PR comment carrying shell.ATTESTATION_MARKER and naming the commit it
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
*starts* with `override-merge owner/repo#N` grants one `gh pr merge` of that PR in that
session, past both this gate and the server's rules. It names the repo because every repo has
a PR N. It must start the prompt because the cron bot's prompts quote issue and PR text that
anyone can write.

The user can also switch alq-review off for a session (`alq-review off`, spec 016). That lifts
this gate too -- `--admin` and `gh api` merges included -- because it is the user's decision to
make, and it is read per session so no other session is affected. A switch that cannot be read
leaves the gate on.

Reads the PreToolUse or UserPromptSubmit payload on stdin. Fails closed once a gated command is
recognised -- an unresolvable PR or an unreachable GitHub ends in deny, because
a false deny costs one command and a false allow costs a merge.
"""

from __future__ import annotations

import json
import re
import shlex
import shutil
import subprocess
import sys
from dataclasses import dataclass

# The commit the attestation covers. Bold markers optional because GitHub
# surfaces render the same body differently; backticks optional for the same
# reason. Ten hex digits minimum -- see the module docstring.
REVIEWED_COMMIT = re.compile(r"\*{0,2}Reviewed commit:\*{0,2}\s*[`'\"]?([0-9a-f]{10,40})", re.I)

# A PR's name, `owner/repo#N`, has one reader, PullRequest.named, and it takes a whole text or refuses it. A reader
# that finds a name at the start of a text ends the name wherever it stops understanding, and what it stopped at --
# a digit from another alphabet, a character nobody sees -- is then judged by nothing. ASCII only, as GitHub's names
# are: a name is kept in lower case, and a letter from outside ASCII can lower into one from inside it.
NAME_PART = r"[A-Za-z0-9_.-]+"
NUMBER = r"[1-9][0-9]*"
NAME = re.compile(rf"({NAME_PART}/{NAME_PART})#({NUMBER})")
GITHUB = "https://github.com/"

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

KEYWORD = "override-merge"
# What the user types is read as words, each whole. gate.py reads its commands with this script's reader, and the
# reader is kept here because this script must answer an override when the plugin's other scripts cannot load.
# A blank parts words: space, tab, line break. Written out, not `\s`, str.split() or str.splitlines(): those also
# take characters nobody types or sees.
LINE_BREAK = "\r\n"
BLANK = " \t" + LINE_BREAK
WORDS = re.compile(rf"[{BLANK}]+")
NOT_A_NAME = ("`override-merge` is not followed by a PR's name, so nothing is granted. The user names the PR in one "
              "word, with its repo: `override-merge owner/repo#N`.")
GRANTS = ".merge"


def _name_parts(text: str) -> tuple[str, str] | None:
    found = NAME.fullmatch(text)
    return (found.group(1).lower(), found.group(2)) if found else None


@dataclass(frozen=True)
class PullRequest:
    """A PR as an override and a grant name it: GitHub's `owner/repo#N`."""
    repo: str  # owner/repo, in lower case as GitHub compares names
    number: str  # text, as written: it is compared, never counted

    def __post_init__(self):
        if _name_parts(str(self)) != (self.repo, self.number):
            raise ValueError(f"{str(self)!r} is not a PR's name in lower case")

    @classmethod
    def named(cls, text: str) -> PullRequest | None:
        """The PR the whole of `text` names, whatever its capitals; None when `text` is not one name."""
        parts = _name_parts(text)
        return cls(*parts) if parts else None

    def __str__(self) -> str:
        return f"{self.repo}#{self.number}"


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


def name_of(pr: dict) -> PullRequest | None:
    """The PR `gh pr view` found, named from its address; None when that is not a github.com PR's."""
    address = pr.get("url") or ""
    if not address.startswith(GITHUB):
        return None
    # Rewritten as the name it would be, so the address too is judged by the one reader.
    repo, _, number = address[len(GITHUB):].rpartition("/pull/")
    return PullRequest.named(f"{repo}#{number}")


def first_words(prompt: str, count: int) -> list[str]:
    """A prompt's first `count` words, fewer when it has fewer."""
    return [word for word in WORDS.split(prompt.lstrip(BLANK), maxsplit=count)[:count] if word]


def first_line(prompt: str) -> str:
    """A prompt's first line that has a word, without the blanks round it."""
    return re.split(f"[{LINE_BREAK}]", prompt.lstrip(BLANK), maxsplit=1)[0].rstrip(BLANK)


def _granted(held) -> set[PullRequest]:
    """The PRs a grants record names; ValueError when the record is not one this gate wrote."""
    names = held.get("granted", []) if isinstance(held, dict) and set(held) <= {"granted"} else None
    # The gate writes a name in lower case, so one in capitals was not written here.
    granted = [PullRequest.named(name) if isinstance(name, str) and name == name.lower() else None
               for name in names] if isinstance(names, list) else None
    if granted is None or None in granted:
        raise ValueError('it is not {"granted": [PR names]}')
    return set(granted)


def _update_grants(payload: dict, change):
    """Apply `change` to the PRs the session may merge, under the session record's lock; returns what it returns."""
    # Imported here, not at the top: a prompt is owed an answer when this does not load, and grant() gives it.
    import hookio
    try:
        record = hookio.session_file(payload, GRANTS)
    except ValueError as exc:
        raise ValueError(f"{exc}. No merge override can be kept in this session: the merge waits for what it "
                         f"lacks, or is run from another session") from exc
    try:
        with hookio.session_state(payload, GRANTS) as held:
            granted = _granted(held)
            result = change(granted)
            held["granted"] = sorted(map(str, granted))
    except (ValueError, RecursionError) as exc:  # what the record holds, not where it is kept
        raise ValueError(f"{record} is not a record the merge gate wrote ({exc}). The user deletes it and types "
                         f"the override again") from exc
    return result


def _logged(said: str) -> str:
    """`said`, once written to errors.log. Where that write fails, `said` with that added, so the answer tells it."""
    try:
        import hookio
        hookio.log_error(said)
    except Exception as exc:  # a plugin module that is there but does not load raises more than ImportError
        # Told in the answer, the one output this hook depends on: a line on stderr can fail as the log did.
        return f"{said} (not written to errors.log: {type(exc).__name__}: {exc})"
    return said


def grant(payload: dict) -> int:
    typed = first_words(payload.get("prompt") or "", 2)
    if typed[:1] != [KEYWORD]:
        return 0
    named = PullRequest.named(typed[1]) if len(typed) == 2 else None
    if named is None:
        said = NOT_A_NAME
    else:
        try:
            _update_grants(payload, lambda granted: granted.add(named))
        except Exception as exc:  # outside main()'s guard; an override that was not recorded is not one
            said = _logged(f"`override-merge {named}` could not be recorded, so nothing is granted: "
                           f"{type(exc).__name__}: {exc}")
        else:
            said = f"The user granted one merge of `{named}` past its unmet requirements, `--admin` included."
    # gate._tell's two fields, built here because this answer is owed when the plugin's modules cannot load.
    json.dump({"systemMessage": f"[alq-review] {said}", "hookSpecificOutput": {
        "hookEventName": "UserPromptSubmit", "additionalContext": f"[alq-review] {said}"}}, sys.stdout)
    return 0


def spend_override(payload: dict, named: PullRequest) -> bool:
    def spend(granted):
        if named not in granted:
            return False
        granted.discard(named)
        return True
    return _update_grants(payload, spend)


def attested(comments: list[dict], head: str) -> bool:
    """Does any attestation comment name the commit that is currently the head?"""
    # Imported here for the reason released() imports github here.
    from shell import ATTESTATION_MARKER
    for comment in comments:
        body = comment.get("body") or ""
        if ATTESTATION_MARKER not in body:
            continue
        found = REVIEWED_COMMIT.search(body)
        if found and head.startswith(found.group(1).lower()):
            return True
    return False


def released(named: PullRequest | None, head: str) -> bool:
    """Did pr-gate pass the head as a version-only release? An unreadable answer is no."""
    # Imported here, under main()'s refuse-on-error guard: a reader that fails to load must close the gate, not crash
    # the hook, which Claude Code treats as a non-blocking error.
    import github
    return named is not None and github.released(named.repo, head) is not None


def how_to_attest(number: int, head: str, verb: str) -> str:
    from shell import ATTESTATION_MARKER
    return (
        f"No internal-review attestation for {head[:10]} on PR #{number}, so `gh pr {verb}` "
        "is blocked. This gate checks one thing: that the internal pr-review-toolkit pass "
        "ran clean on the commit being merged. It is recorded on the PR because no GitHub "
        "check can observe it.\n\n"
        "Run the internal review. When it comes back clean on this exact commit, post:\n\n"
        f"  gh pr comment {number} --body '{ATTESTATION_MARKER}\n"
        "  Internal review clean.\n"
        f"  Reviewed commit: `{head}`'\n\n"
        "An attestation naming an older commit does not count: every push voids it, "
        "the same way it voids the Codex verdict."
    )


def admin_needs_override(how: str) -> str:
    """`how` says how the user overrules it here, or why no override can."""
    return (
        "`gh pr merge --admin` merges in spite of every check the branch requires -- "
        "CI, DeepSource, the Codex verdict, unresolved threads, the approval. Only the "
        f"user overrules them: {how} Tell them what is unmet and stop."
    )


def unmet(verb: str, args: list[str], pr: dict, named: PullRequest | None) -> str | None:
    """What this `gh pr merge` or `gh pr ready` lacks, as the refusal it gets unless a grant stands in for it;
    None when it lacks nothing."""
    if "--admin" in args:
        return admin_needs_override(
            f"they start a prompt with `override-merge {named}`." if named else
            "an override names a PR by its repo, and `gh pr view` gave no github.com address for this one.")
    if verb == "ready" and not pr.get("isDraft"):
        return None  # already published; nothing to gate
    head = (pr.get("headRefOid") or "").lower()
    if not head:
        return f"`gh pr view` returned no head commit for PR {pr.get('number')}."
    if attested(pr.get("comments") or [], head) or released(named, head):
        return None
    return how_to_attest(pr.get("number"), head, verb)


def switched_off(payload: dict) -> bool:
    # Imported here for the reason released() imports github here. Only a `gh pr merge`, a
    # `gh pr ready` or a `gh api` merge reaches this, so a failure to load denies no other command.
    import hookio
    return hookio.switch_state(payload) == "off"


def gated(tokens: list[str], payload: dict) -> int:
    bypass = api_merge_bypass(tokens)
    subcommand_at = None if bypass else find_invocation(tokens)
    if not bypass and subcommand_at is None:
        return 0
    if switched_off(payload):
        return 0

    if bypass:
        return deny(
            "Merging through `gh api` steps around the internal-review gate. "
            "Use `gh pr merge` so the attestation is checked."
        )
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
        return deny(admin_needs_override(
            "an override names the PR `gh pr view` finds, and `gh` is not on this hook's path, so none can be "
            "applied until it is.")) if "--admin" in args else 0

    pr, error = fetch(pr_ref, repo)
    if pr is None:
        return deny(
            f"Cannot verify the pre-merge state of this PR, so `gh pr {verb}` is blocked: "
            f"{error}. Resolve that and retry -- this gate refuses rather than guesses."
        )

    named = name_of(pr)
    refusal = unmet(verb, args, pr, named)
    if refusal is None:
        return 0
    if verb == "merge" and named is not None:
        # Asked last, so an override is spent only by a merge that needs it and no other merge waits on its record.
        try:
            if spend_override(payload, named):
                return 0
        except (OSError, ValueError) as exc:
            unread = _logged(f"This session's merge overrides could not be used, so this merge was judged without "
                             f"one: {type(exc).__name__}: {exc}.")
            return deny(f"{unread}\n\n{refusal}")
    return deny(refusal)


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

    try:
        tokens = tokenize(command)
        if tokens is None:
            # Unparseable quoting. Only refuse when the text plainly names a gated
            # call: guessing at everything else would block unrelated work.
            if re.search(r"\bgh\s+pr\s+(merge|ready)\b", command) and not switched_off(payload):
                return deny(
                    "This command names `gh pr merge`/`gh pr ready` but could not be parsed "
                    "(unbalanced quote), so the pre-merge gate cannot read its arguments. "
                    "Rewrite it as a plain invocation."
                )
            return 0
        return gated(tokens, payload)
    except Exception as exc:  # a broken gate must not become an open gate
        return deny(f"pre-merge gate failed and is refusing by default: {exc}")


if __name__ == "__main__":
    raise SystemExit(main())
