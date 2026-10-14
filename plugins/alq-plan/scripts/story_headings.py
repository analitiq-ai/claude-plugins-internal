#!/usr/bin/env python3
"""Checks spec.md's story headings: branches, PR headers and review name a story by its number, so a number must be
one heading's.

Each story heading is Spec Kit's `### User Story <N> - <title> (Priority: P<n>)`, and no number is two headings'. On
a rescope, against spec.md as the run found it, every number not there before is greater than every number that was:
a number may be dropped, and is then not used again. The check compares numbers only, so it cannot tell a story
moved to another number, or a number dropped and used again in one run. The form of spec.md as found is not graded:
a spec scoped before this check may have no story headings.

Usage: story_headings.py check <spec folder> [<spec.md as the run found it>]. Prints one problem per line and exits 1
when there are any, 2 when the check cannot run. A new scope names no spec.md as found.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

FORM = "`### User Story <N> - <title> (Priority: P<n>)`"
# Any heading that names a user story, however it is written, so that one written wrong is caught, not missed.
_CANDIDATE = re.compile(r"^#+\s*user\s+story\b", re.IGNORECASE)
_HEADING = re.compile(r"^### User Story (?P<number>[1-9]\d*) - \S.*? \(Priority: P\d+\)$")


def _stories(spec: str) -> tuple[list[tuple[int, str, int]], list[tuple[int, str]]]:
    """((line, heading, number) per heading in the form, (line, heading) per story heading out of it)."""
    stories, malformed = [], []
    for line_number, line in enumerate(spec.splitlines(), start=1):
        if not _CANDIDATE.match(line):
            continue
        found = _HEADING.match(line)
        if found:
            stories.append((line_number, line, int(found["number"])))
        else:
            malformed.append((line_number, line))
    return stories, malformed


def _listed(numbers: list[int]) -> str:
    words = [str(n) for n in sorted(numbers)]
    return words[0] if len(words) == 1 else f"{', '.join(words[:-1])} and {words[-1]}"


def problems(spec: str, found: str | None) -> list[str]:
    """`found` is spec.md as a rescope found it; None on a new scope."""
    stories, malformed = _stories(spec)
    out = [f"line {line}: `{text}` is not a story heading in the form {FORM}. Next step: rewrite it in that form."
           for line, text in malformed]
    by_number: dict[int, list[tuple[int, str]]] = {}
    for line, text, number in stories:
        by_number.setdefault(number, []).append((line, text))
    for number, same in by_number.items():
        if len(same) > 1:
            named = "; ".join(f"line {line}: `{text}`" for line, text in same)
            out.append(f"{len(same)} headings have number {number}: {named}. Next step: give each heading a number "
                       "no other heading has.")
    if found is not None:
        before = {number for _, _, number in _stories(found)[0]}
        if before:
            highest = max(before)
            for line, text, number in stories:
                if number not in before and number < highest:
                    out.append(f"line {line}: `{text}` has number {number}, which spec.md did not have when the "
                               f"run found it: it had {_listed(before)}, and a number not there before is greater "
                               f"than {highest}, so a dropped number is not used again. Next step: number it above "
                               f"{highest}.")
    return out


def main() -> None:
    try:
        if len(sys.argv) not in (3, 4) or sys.argv[1] != "check":
            raise ValueError(__doc__)
        spec = Path(sys.argv[2]) / "spec.md"
        found = problems(spec.read_text(), Path(sys.argv[3]).read_text() if len(sys.argv) == 4 else None)
    except (OSError, ValueError, UnicodeDecodeError) as exc:
        print(f"The story-heading check could not run: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(2)
    for problem in found:
        print(f"{spec}: {problem}", file=sys.stderr)
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
