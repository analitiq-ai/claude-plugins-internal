#!/usr/bin/env python3
"""Checks that a spec folder's spec.md carries a labelled `## Root cause` section.

The section opens with an `Observed:` line, or with the one sentence that says the issue reports no defect. Whether
the issue reports one is the premise report's answer, so a report that says it does refuses that sentence. Only the
label is graded: whether the trace is right is for the user in grill and for alq-root-cause-check.

Usage: rootcause.py check <spec folder> [<premise report>]. Prints one problem per line and exits 1 when there are
any, 2 when the check cannot run. A re-scope has no premise report and names none.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import premise_report

HEADING = "## Root cause"
OBSERVED = "Observed:"
NOT_A_DEFECT = "Not a defect report."


def _opening(spec: str) -> str | None:
    """The first non-blank line under the heading, empty when the section has none; None when the heading is
    missing."""
    lines = re.sub(r"<!--.*?-->", "", spec, flags=re.DOTALL).splitlines()
    if HEADING not in lines:
        return None
    for line in lines[lines.index(HEADING) + 1:]:
        if line.startswith("## "):
            break
        if line.strip():
            return line.strip()
    return ""


def problems(spec: str, report: str | None) -> list[str]:
    opening = _opening(spec)
    if opening is None:
        return [f"it has no `{HEADING}` section. Next step: add the section as the spec template gives it."]
    if opening == NOT_A_DEFECT:
        if report is not None and premise_report.reports_wrong_behaviour(report):
            return [f"`{HEADING}` says `{NOT_A_DEFECT}` and the premise report says `{premise_report.WRONG}: yes`. "
                    f"Next step: trace the behaviour to its cause and open the section with `{OBSERVED}`."]
        return []
    if not opening.startswith(OBSERVED):
        return [f"`{HEADING}` does not open with an `{OBSERVED}` line. Next step: open it with `{OBSERVED}` and "
                f"what was seen, or that the trace is a hypothesis; for an issue that reports no defect, with "
                f"`{NOT_A_DEFECT}`."]
    return []


def main() -> None:
    try:
        if len(sys.argv) not in (3, 4) or sys.argv[1] != "check":
            raise ValueError(__doc__)
        spec = Path(sys.argv[2]) / "spec.md"
        found = problems(spec.read_text(), Path(sys.argv[3]).read_text() if len(sys.argv) == 4 else None)
    except (OSError, ValueError, UnicodeDecodeError) as exc:
        print(f"The root cause check could not run: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(2)
    for problem in found:
        print(f"{spec}: {problem}", file=sys.stderr)
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
