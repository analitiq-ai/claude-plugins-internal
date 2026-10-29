#!/usr/bin/env python3
"""Checks that a spec folder's spec.md carries a labelled root cause section.

The section opens with an observed line that says something, or with the one sentence that says the issue reports
no defect. Their words are core's premise vocabulary, read through premise_report.py. Whether the issue reports one
is the premise report's answer, so a report that says it does refuses that sentence. Whether the trace is right is
not graded: that is for the user in grill and for builder's root-cause-check.

Usage: rootcause.py check <spec folder> [<premise report>]. Prints one problem per line and exits 1 when there are
any, 2 when the check cannot run. A re-scope has no premise report and names none.
"""
from __future__ import annotations

import sys
from pathlib import Path

import premise_report

HEADING, OBSERVED, NOT_A_DEFECT, HYPOTHESIS = premise_report.ROOT_CAUSE


def problems(spec: str, report: str | None) -> list[str]:
    defect = report is not None and premise_report.reports_wrong_behaviour(report)
    try:
        under = premise_report.section(spec, HEADING)
    except premise_report.Repeated as exc:
        return [str(exc)]
    if under is None:
        return [f"it has no `{HEADING}` section. Next step: add the section as the spec template gives it."]
    opening = next((line.strip() for line in under if line.strip()), "")
    if opening == NOT_A_DEFECT:
        if defect:
            return [f"`{HEADING}` says `{NOT_A_DEFECT}` and the premise report says "
                    f"`{premise_report.WRONG}: {premise_report.YES}`. "
                    f"Next step: trace the behaviour to its cause and open the section with `{OBSERVED}`."]
        return []
    if not (opening.startswith(OBSERVED) and premise_report.filled(opening[len(OBSERVED):].strip())):
        return [f"`{HEADING}` does not open with an `{OBSERVED}` line that says something. Next step: open it with "
                f"`{OBSERVED}` and what was seen, or with `{HYPOTHESIS}`; for an issue that reports no defect, with "
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
