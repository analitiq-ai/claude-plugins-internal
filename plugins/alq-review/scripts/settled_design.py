#!/usr/bin/env python3
"""The settled-design check (spec 004 FR-017/018) over one spec folder.

plan.md lists its mechanisms under `## Mechanisms`, one `- <mechanism>: R<n>` bullet each. Each cited
decision is a `## R<n>: <title>` section of research.md carrying non-empty Decision, Rationale and
Existing tools fields. Whether the choice is right is for critique and review; this only proves it
was recorded.

Usage: settled_design.py <spec folder>. Prints one problem per line and exits 1 when there are any.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

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


def main() -> None:
    if len(sys.argv) != 2 or not sys.argv[1]:
        print("usage: settled_design.py <spec folder>", file=sys.stderr)
        sys.exit(2)
    folder = Path(sys.argv[1])
    if not folder.is_dir():
        sys.exit(f"{folder}: not a spec folder")
    found = problems(folder)
    for problem in found:
        print(problem, file=sys.stderr)
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
