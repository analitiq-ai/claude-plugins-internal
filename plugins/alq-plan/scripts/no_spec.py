#!/usr/bin/env python3
"""The no-spec spec.md: what a `no spec needed` pick leaves in its spec folder, so that a later scope of the issue
sees it was judged (alq-plan ADR-0008).

It says no spec is needed and carries the question the pick rests on and the reason, as the premise report records
them. This module is the one writer of it and the one place that tells it apart from a spec: by its first line.

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
    return spec.splitlines()[:1] == [TITLE]


def write(folder: Path, report: Path) -> None:
    # Read before the folder is made: a report that cannot be read leaves no folder behind.
    spec = text(report.read_text())
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "spec.md").write_text(spec)


def main() -> None:
    if len(sys.argv) != 4 or sys.argv[1] != "write":
        print(__doc__, file=sys.stderr)
        sys.exit(2)
    try:
        write(Path(sys.argv[2]), Path(sys.argv[3]))
    except (OSError, ValueError) as exc:
        print(f"The no-spec spec.md could not be written: {type(exc).__name__}: {exc}\nNext step: run "
              f"`premise_report.py check <premise report> '{premise_report.NO_SPEC}'` and do as it says.",
              file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
