#!/usr/bin/env python3
"""The no-spec spec.md: what the no-spec pick leaves in its spec folder, so that a later scope of the issue
sees it was judged (planner ADR-0007).

It says no spec is needed and carries the question the pick rests on and the reason, as the premise report records
them. This module is the one writer of it. It tells it apart from a spec by its first line after any leading front
matter block, where spec_facts.ts writes the spec facts; spec_facts.ts applies the same rule when it is given no
premise report, and planner's spec-facts test, whose no-spec spec.md this module writes, fails when the two part.

Usage: no_spec.py write <spec folder> <premise report>. Writes the folder's spec.md and nothing else, and exits 2
when it could not.
"""
from __future__ import annotations

import sys
from pathlib import Path

import premise_report

TITLE = "# No spec needed"


def text(report: str) -> str:
    """The no-spec spec.md of the premise report `report`."""
    return (f"{TITLE}\n\nThe premise found that this issue needs no spec.\n\n"
            f"{premise_report.RESTS_ON}: {premise_report.rested_on(report)}\n"
            f"{premise_report.REASON}: {premise_report.reason(report)}\n")


def is_no_spec(spec: str) -> bool:
    """Whether `spec`, a spec.md, is a no-spec spec.md."""
    lines = spec.splitlines()
    # core's frontMatter rule: a block opens on the first line and closes at the next `---` line.
    if lines[:1] == ["---"] and "---" in lines[1:]:
        lines = lines[lines.index("---", 1) + 1:]
    return lines[:1] == [TITLE]


def write(folder: Path, spec: str) -> None:
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "spec.md").write_text(spec)


def main() -> None:
    if len(sys.argv) != 4 or sys.argv[1] != "write":
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    folder = Path(sys.argv[2])
    try:
        spec = text(Path(sys.argv[3]).read_text())
    except (OSError, ValueError) as exc:
        print(f"The no-spec spec.md could not be read from the premise report: {type(exc).__name__}: {exc}\nNext "
              f"step: run `premise_report.py check <premise report> '{premise_report.NO_SPEC}'` and do as it says.",
              file=sys.stderr)
        sys.exit(2)
    try:
        write(folder, spec)
    except OSError as exc:
        print(f"The no-spec spec.md could not be written to {exc.filename or folder}: {type(exc).__name__}: "
              f"{exc.strerror or exc}\nNext step: make that path writable or clear what is in its way.",
              file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
