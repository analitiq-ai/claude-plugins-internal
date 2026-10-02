"""Recognise the few shell commands the review process gates, and the directory each runs in.
A comment is gated on what it posts, so the body files a gh command names are read."""
from __future__ import annotations

import os
import re
import shlex
from dataclasses import dataclass, replace
from pathlib import Path

REVIEW_TRIGGER = "@codex review"
# The comment the org pr-gate (analitiq-org-github) turns into the `internal-review` status; pinned by test_shell.py.
ATTESTATION_MARKER = "<!-- analitiq-internal-review -->"
_HEREDOC = re.compile(r"<<-?\s*(['\"]?)(\w+)\1([^\n]*)\n.*?^\2$", re.S | re.M)
_GIT_OPTIONS_WITH_VALUE = ("-C", "-c", "--git-dir", "--work-tree", "--namespace", "--exec-path")
_COMMENTS_API = re.compile(r"repos/([\w.-]+/[\w.-]+)/issues/(\d+)/comments")


@dataclass(frozen=True)
class Action:
    kind: str  # commit | push | rerequest | ready (declares the internal review done) | unlock
    cwd: str
    repo: str | None = None
    pr: int | None = None
    staging: bool = False  # commit only: it adds files to the index itself, so the checked index is not what lands
    alone: bool = True  # commit only: nothing but `cd` shares its command, so nothing else can restage first


def _segments(command: str) -> list[str]:
    """Split on shell control operators that sit outside quotes."""
    out, buf, quote, i = [], [], None, 0
    while i < len(command):
        ch = command[i]
        if ch == "\\" and quote != "'":
            buf.append(command[i:i + 2])
            i += 2
            continue
        if quote:
            quote = None if ch == quote else quote
            buf.append(ch)
        elif ch in "'\"":
            quote = ch
            buf.append(ch)
        elif ch in ";|&\n":
            out.append("".join(buf))
            buf = []
        else:
            buf.append(ch)
        i += 1
    out.append("".join(buf))
    return [s for s in out if s.strip()]


def _words(segment: str) -> list[str]:
    try:
        words = shlex.split(segment)
    except ValueError:  # unbalanced quote left by an unusual construct; whitespace split still finds the verb
        words = segment.split()
    while words and (words[0] in ("(", "{", "then", "do") or re.fullmatch(r"\w+=.*", words[0])):
        words = words[1:]
    if words and words[0].startswith("("):
        words[0] = words[0].lstrip("(")
    return words


def _git(words: list[str], cwd: str) -> Action | None:
    i = 1
    while i < len(words) and words[i].startswith("-"):
        if words[i] == "-C" and i + 1 < len(words):
            cwd = os.path.normpath(os.path.join(cwd, words[i + 1]))
        i += 2 if words[i] in _GIT_OPTIONS_WITH_VALUE else 1
    if i < len(words) and words[i] == "commit":
        return Action("commit", cwd, staging=_stages(words[i + 1:]))
    if i < len(words) and words[i] == "push":
        return Action("push", cwd)
    return None


# git commit's options that take a value, short (also at the end of a cluster like -qm) and long.
_COMMIT_SHORT_VALUED = "mFCct"
_COMMIT_LONG_VALUED = ("--message", "--file", "--reuse-message", "--reedit-message", "--author", "--date", "--cleanup",
                       "--template", "--fixup", "--squash", "--trailer")
_COMMIT_SHORT_STAGING = "aio"


def _stages(words: list[str]) -> bool:
    """Whether a `git commit` with these arguments puts anything into the index: -a, -i, -o or a pathspec."""
    i = 0
    while i < len(words):
        word = words[i]
        if word == "--" or word.startswith("--pathspec-from-file") or word in ("--all", "--include", "--only"):
            return True
        if word.startswith("--"):
            i += 2 if word in _COMMIT_LONG_VALUED else 1
            continue
        if word.startswith("-") and len(word) > 1:
            for at, flag in enumerate(word[1:]):
                if flag in _COMMIT_SHORT_STAGING:
                    return True
                if flag in _COMMIT_SHORT_VALUED:
                    i += 1 if at + 2 < len(word) else 2  # the value is the rest of the word, or the next word
                    break
            else:
                i += 1
            continue
        return True  # a bare word is a pathspec
    return False


def _values(words: list[str], *names: str):
    for i, word in enumerate(words):
        if word in names and i + 1 < len(words):
            yield words[i + 1]
        for name in names:
            if name.startswith("--") and word.startswith(name + "="):
                yield word.split("=", 1)[1]


def _flag(words: list[str], *names: str) -> str | None:
    return next(_values(words, *names), None)


def _api_writes(words: list[str]) -> bool:
    method = _flag(words, "-X", "--method")
    if method:
        return method.upper() != "GET"
    # gh api switches from GET to POST as soon as it is given a body.
    return "graphql" in words or any(w[:2] in ("-f", "-F") or w.split("=", 1)[0] in ("--raw-field", "--field", "--input")
                                     for w in words[2:])


def _posts(words: list[str], cwd: str, command: str) -> str | None:
    """The gated kind of what a gh write puts in a comment, or None."""
    if words[1] == "api":
        files = [*_values(words, "--input"), *(v.split("=@", 1)[1] for v in _values(words, "-F", "--field") if "=@" in v)]
    else:
        files = list(_values(words, "--body-file", "-F"))
    # Heredoc bodies are stripped from `words`, so the command is read whole; `-` (stdin) is never a file.
    paths = [Path(cwd, os.path.expanduser(f)) for f in files]
    text = "\n".join([command, *(p.read_text(errors="replace") for p in paths if p.is_file())])
    if ATTESTATION_MARKER in text:
        return "ready"
    return "rerequest" if REVIEW_TRIGGER in text.lower() else None


def _gh(words: list[str], cwd: str, command: str) -> Action | None:
    repo = _flag(words, "--repo", "-R")
    number = next((int(w) for w in words[3:] if w.isdigit()), None)
    if words[1:3] == ["pr", "create"]:
        return None if "--draft" in words or "-d" in words else Action("ready", cwd, repo)
    if words[1:3] == ["pr", "ready"]:
        return None if "--undo" in words else Action("ready", cwd, repo, number)
    if words[1:3] in (["pr", "comment"], ["issue", "comment"]):
        posts = _posts(words, cwd, command)
        return Action(posts, cwd, repo, number) if posts else None
    if words[1:2] == ["api"] and _api_writes(words):
        posts = _posts(words, cwd, command)
        if not posts:
            return None
        # A comment edit or a GraphQL mutation names no PR: it is taken to be the checkout's own.
        target = _COMMENTS_API.search(" ".join(words))
        return Action(posts, cwd, target.group(1), int(target.group(2))) if target else Action(posts, cwd)
    return None


def classify(command: str, cwd: str) -> list[Action]:
    actions = []
    segments = [words for words in map(_words, _segments(_HEREDOC.sub(r"\3", command))) if words]
    alone = sum(1 for words in segments if words[0] != "cd") == 1
    for words in segments:
        action = None
        if words[0] == "cd" and len(words) > 1:
            cwd = os.path.normpath(os.path.join(cwd, os.path.expanduser(words[1])))
        elif words[0] == "git":
            action = _git(words, cwd)
            if action and action.kind == "commit" and not alone:
                action = replace(action, alone=False)
        elif words[0] == "gh":
            action = _gh(words, cwd, command)
        elif any(w.endswith("ledger.py") for w in words) and "unlock" in words:
            action = Action("unlock", cwd)
        if action:
            actions.append(action)
    return actions
