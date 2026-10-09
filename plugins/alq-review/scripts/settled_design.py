#!/usr/bin/env python3
"""The settled-design check (spec 004 FR-004/005/017/018), over one spec folder or a whole branch.

plan.md lists its mechanisms under `## Mechanisms`, one `- <mechanism>: R<n>` bullet each. Each cited
decision is a `## R<n>: <title>` section of research.md carrying non-empty Decision, Rationale and
Existing tools fields. Whether the choice is right is for critique and review; this only proves it
was recorded.

A branch is graded as the gate grades it at the first internal round: each spec folder it changes, or, when it
changes none, each design document it changes, which needs one. A spec folder is `<dir>/specs/<feature>/` at any
depth, so a repo can hold one Spec Kit project, each with its own `specs/`, per subdirectory.

Usage: settled_design.py <spec folder> | --branch <checkout> <branch it merges into>. Prints one problem per line
and exits 1 when there are any, 2 when the check cannot run.
settled_design.py --spec-folders <checkout> <branch it merges into> prints the spec folders the branch changes
and keeps, one per line, relative to the checkout.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path, PurePosixPath

import config
import worktree

FIELDS = ("Decision", "Rationale", "Existing tools")
LIST_FORMAT = "`## Mechanisms` section listing each mechanism as `- <mechanism>: R<n>`"
_MECHANISM = re.compile(r"^- (?P<name>.+?): (?P<id>R\d+)\s*$")
_DECISION = re.compile(r"^## (?P<id>R\d+):")
_FIELD = re.compile(r"^- \*\*(?P<field>[^*]+)\*\*:(?P<value>.*)$")
_NONE_FIT = re.compile(r"^none fit\b", re.IGNORECASE)
_LOOKED_AT = re.compile(r"looked at:\s*\S", re.IGNORECASE)


def _sections(lines: list[str]):
    """(line number of the `## ` heading, heading, body lines) for each level-2 section."""
    starts = [i for i, line in enumerate(lines) if line.startswith("## ")]
    for n, start in enumerate(starts):
        end = starts[n + 1] if n + 1 < len(starts) else len(lines)
        yield start + 1, lines[start], lines[start + 1:end]


def _mechanisms(plan: Path) -> tuple[list[tuple[int, str, str]], list[str]]:
    """((line, mechanism, decision id) per listed mechanism, problems with the list itself)."""
    if not plan.is_file():
        return [], [f"{plan}: missing. It must have a {LIST_FORMAT}. Next step: write the plan."]
    lines = plan.read_text().splitlines()
    for heading_line, heading, body in _sections(lines):
        if heading.strip() != "## Mechanisms":
            continue
        listed, problems = [], []
        for offset, line in enumerate(body, start=heading_line + 1):
            if not line.startswith("- "):
                continue  # prose and comments may explain the list
            found = _MECHANISM.match(line)
            if found:
                listed.append((offset, found["name"], found["id"]))
            else:
                problems.append(f"{plan}:{offset}: not a mechanism line; the {LIST_FORMAT}. "
                                "Next step: rewrite the line in that form.")
        if not listed and not problems:
            problems.append(f"{plan}:{heading_line}: the {LIST_FORMAT} is empty. "
                            "Next step: list every mechanism the plan builds or changes.")
        return listed, problems
    return [], [f"{plan}: no {LIST_FORMAT}. Next step: add it, citing a research.md decision for each."]


def _decisions(research: Path) -> dict[str, tuple[int, dict[str, str]]]:
    """Decision id -> (heading line, field -> value), the value including indented continuation lines."""
    if not research.is_file():
        return {}
    found = {}
    for heading_line, heading, body in _sections(research.read_text().splitlines()):
        decision = _DECISION.match(heading)
        if not decision:
            continue
        fields, current = {}, None
        for line in body:
            field = _FIELD.match(line)
            if field:
                current = field["field"].strip()
                fields[current] = field["value"].strip()
            elif current and line.startswith((" ", "\t")) and line.strip():
                fields[current] = f"{fields[current]} {line.strip()}".strip()
            else:
                current = None
        found[decision["id"]] = (heading_line, fields)
    return found


def _decision_problems(research: Path, did: str, heading_line: int, fields: dict[str, str]) -> list[str]:
    where = f"{research}:{heading_line}: decision {did}"
    missing = [f for f in FIELDS if not fields.get(f)]
    if missing:
        return [f"{where} has no {', '.join(missing)}. Each decision records what was chosen, why, and the existing "
                "tools looked at, or `None fit. Looked at: <where>`. Next step: fill in "
                + ", ".join(f"`- **{f}**:`" for f in missing) + "."]
    tools = fields["Existing tools"]
    if _NONE_FIT.match(tools) and not _LOOKED_AT.search(tools):
        return [f"{where} says no existing tool fits but not where it looked. "
                "Next step: write `None fit. Looked at: <where>`."]
    return []


def problems(folder: Path) -> list[str]:
    folder = Path(folder)
    listed, found = _mechanisms(folder / "plan.md")
    research = folder / "research.md"
    decisions = _decisions(research)
    checked = set()
    for line, name, did in listed:
        if did not in decisions:
            found.append(f"{folder / 'plan.md'}:{line}: mechanism {name!r} cites {did}, which {research} does not "
                         f"have. Next step: record {did} as `## {did}: <title>` in research.md, or cite the right id.")
        elif did not in checked:
            checked.add(did)
            found.extend(_decision_problems(research, did, *decisions[did]))
    return found


def design_documents(changed: list[str], patterns: list[str]) -> list[str]:
    """The changed files that match a design-document path pattern."""
    if not isinstance(patterns, list) or not all(isinstance(p, str) and p for p in patterns):
        raise ValueError(f"alq-review design_documents must be a list of path patterns, not {patterns!r}")
    return [f for f in changed if any(PurePosixPath(f).full_match(p) for p in patterns)]


def _spec_folder(path: str) -> str | None:
    """The spec folder a changed path lies in, or None; a file directly under `specs/` is in none."""
    parts = PurePosixPath(path).parts
    if "specs" not in parts:
        return None
    end = parts.index("specs") + 2
    return str(PurePosixPath(*parts[:end])) if len(parts) > end else None


def spec_folders(root: str, changed: list[str]) -> list[str]:
    """The spec folders among the `changed` paths that the checkout at `root` still has."""
    touched = {folder for f in changed if (folder := _spec_folder(f))}
    # A folder the branch deleted cannot be graded, so it does not stand in for the one a design document needs.
    return sorted(f for f in touched if (Path(root) / f).is_dir())


def branch_problems(root: str, base: str, patterns: list[str]) -> list[str]:
    """Problems with the branch checked out at `root`, measured from `base`."""
    changed = worktree.changed_files(root, base)
    folders = spec_folders(root, changed)
    if not folders:
        return [f"{doc}:1: a design document changed and no spec folder the branch keeps did; a design-document change comes with a "
                "spec folder. Next step: settle the design in a spec folder (/alq-review:alq-spec #<issue>)."
                for doc in design_documents(changed, patterns)]
    return [p for folder in folders for p in problems(Path(root) / folder)]


def _run(argv: list[str]) -> list[str]:
    if len(argv) == 3 and argv[0] == "--spec-folders" and all(argv[1:]):
        root, target = argv[1:]
        for folder in spec_folders(root, worktree.changed_files(root, worktree.review_base(root, target))):
            print(folder)
        return []
    if len(argv) == 3 and argv[0] == "--branch" and all(argv[1:]):
        root, target = argv[1:]
        return branch_problems(root, worktree.review_base(root, target), config.load()["design_documents"])
    if len(argv) == 1 and argv[0] and not argv[0].startswith("-"):
        folder = Path(argv[0])
        if not folder.is_dir():
            raise ValueError(f"{folder}: not a spec folder")
        return problems(folder)
    print("usage: settled_design.py <spec folder> | --branch <checkout> <branch it merges into> | --spec-folders "
          "<checkout> <branch it merges into>", file=sys.stderr)
    sys.exit(2)


def main() -> None:
    try:
        found = _run(sys.argv[1:])
    except (OSError, ValueError, RuntimeError, UnicodeDecodeError) as exc:
        print(f"The settled-design check could not run: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(2)
    for problem in found:
        print(problem, file=sys.stderr)
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
