#!/usr/bin/env python3
"""The premise report: what the planning skill answers at the workflow's `premise` pause, before any spec folder
exists, and what the user picked there.

The form below is the one place the questions are worded. A report is graded on its form and on each answer naming
a source, not on whether the answer is right: the user's pick is the judgement.

Usage: premise_report.py form | check <report> <pick> | record <report> <pick>. `check` prints one problem per line
and exits 1 when there are any; 2 means the command could not run. `record` runs from the issue's worktree.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

import speclocation

WRITE, NO_SPEC, NOT_WORTH_DOING = "write the spec", "no spec needed", "not worth doing"
OUTCOMES = (WRITE, NO_SPEC, NOT_WORTH_DOING)
QUESTIONS = {
    "harm": "What goes wrong if this issue is never done? Name the state or input and the wrong outcome.",
    "reachable": "Can that happen on the default branch? Start the answer with observed or predicted.",
    "change-alters": "Does the proposed change alter that outcome? Walk the scenario through the change.",
    "owner": "Does something already own this risk (a guard, test, CI job, rule, procedure)?",
    "inherited": "Is the premise inherited from another spec's decision? If so, put the questions above to that "
                 "decision.",
    "needs-spec": "Does the work have decisions in it, or does the request fix the outcome?",
}
SOURCES = ("code:", "reproduction:", "user:")
WRONG, RECOMMENDATION, PICK, RESTS_ON, REASON = ("Reports wrong behaviour", "Recommendation", "Pick", "Rests on",
                                                 "Reason")
_STOP_ONLY = "required unless the pick is write the spec"


def form() -> str:
    questions = "".join(f"## {name}\nQuestion: {asked}\nAnswer:\nSource:\n\n" for name, asked in QUESTIONS.items())
    return (f"{WRONG}:\n\n{questions}{RECOMMENDATION}:\n{PICK}:\n{RESTS_ON}:\n{REASON}:\n\n"
            f"<!--\n- {WRONG} is yes or no.\n- A source is {' <what>, '.join(SOURCES)} <what>.\n"
            f"- {RECOMMENDATION} and {PICK} are each one of: {', '.join(OUTCOMES)}.\n"
            f"- {RESTS_ON} is the heading of the question a stop pick rests on; {_STOP_ONLY}.\n"
            f"- {REASON} is one line; {_STOP_ONLY}.\n-->\n")


def _field(lines: list[str], name: str) -> str:
    """The value of the first `<name>: <value>` line; empty when the line is missing or has no value."""
    for line in lines:
        if line.startswith(f"{name}:"):
            return line[len(name) + 1:].strip()
    return ""


def _lines(text: str) -> list[str]:
    return re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL).splitlines()


def _sections(lines: list[str]) -> dict[str, list[str]]:
    """The lines under each `## <question>` heading."""
    sections, into = {}, []
    for line in lines:
        if line.startswith("## "):
            into = sections.setdefault(line[3:].strip(), [])
        else:
            into.append(line)
    return sections


def reason(text: str) -> str:
    return _field(_lines(text), REASON)


def reports_wrong_behaviour(text: str) -> bool:
    return _field(_lines(text), WRONG) == "yes"


def _graded(pick: str, rests_on: str) -> list[str]:
    """The questions whose answers `pick` needs: all of them to write a spec, and for a stop pick those up to the
    one it rests on, since the stop makes the later ones moot."""
    names = list(QUESTIONS)
    return names if pick == WRITE else names[:names.index(rests_on) + 1] if rests_on in names else []


def _answer_problems(name: str, lines: list[str]) -> list[str]:
    answer, source = _field(lines, "Answer"), _field(lines, "Source")
    found = [f"`## {name}` has no `{field}:`. Next step: fill it in." for field, value
             in (("Answer", answer), ("Source", source)) if not value]
    if source and not any(source.startswith(kind) and source[len(kind):].strip() for kind in SOURCES):
        found.append(f"`## {name}` has the source `{source}`, which does not say where the answer came from. "
                     f"Next step: start it with {', '.join(f'`{kind}`' for kind in SOURCES[:-1])} or `{SOURCES[-1]}` "
                     "and then say what.")
    if name == "reachable" and answer and not answer.startswith(("observed", "predicted")):
        found.append("`## reachable` does not say whether the answer was seen or reasoned. Next step: start the "
                     "answer with `observed` or `predicted`.")
    return found


def problems(text: str, pick: str) -> list[str]:
    """What stops `text` from being the report of a run whose user picked `pick`; empty when nothing does."""
    # A field outside the questions is named once in the form, so it is found wherever in the report it sits.
    lines = _lines(text)
    sections = _sections(lines)
    wrong, recommended, written, rests_on = (_field(lines, name) for name in (WRONG, RECOMMENDATION, PICK, RESTS_ON))
    found = [f"it has no `## {name}` section. Next step: write the report on the form `premise_report.py form` "
             "prints." for name in QUESTIONS if name not in sections]
    if wrong not in ("yes", "no"):
        found.append(f"`{WRONG}:` is `{wrong}`. Next step: make it `yes` or `no`.")
    for field, value in ((RECOMMENDATION, recommended), (PICK, written)):
        if value not in OUTCOMES:
            found.append(f"`{field}:` is `{value}`. Next step: make it one of {', '.join(OUTCOMES)}.")
    if written in OUTCOMES and written != pick:
        found.append(f"`{PICK}:` is `{written}` and the user picked `{pick}`. Next step: write the user's pick.")
    if pick != WRITE:
        if rests_on not in QUESTIONS:
            found.append(f"`{RESTS_ON}:` is `{rests_on}`, and a stop names the question it rests on. Next step: "
                         f"make it one of {', '.join(QUESTIONS)}.")
        if not _field(lines, REASON):
            found.append(f"`{REASON}:` is empty, and it is what the issue's comment will say. Next step: give the "
                         "reason in one line.")
    for name in _graded(pick, rests_on):
        if name in sections:
            found += _answer_problems(name, sections[name])
    if wrong == "yes" and recommended == NO_SPEC:
        found.append(f"`{WRONG}: yes` and the recommendation is `{NO_SPEC}`: the size of a defect's fix is known "
                     f"only once it is traced. Next step: recommend `{WRITE}` or `{NOT_WORTH_DOING}`.")
    return found


def record(text: str, pick: str, checkout: str) -> str:
    """Writes the location comment a stop pick leaves on the issue of `checkout`'s branch; its URL, or nothing for
    a pick that writes the spec."""
    if pick == NO_SPEC:
        return speclocation.post_none(checkout, reason(text))
    if pick == NOT_WORTH_DOING:
        return speclocation.post_not_worth_doing(checkout, reason(text))
    return ""


def _run(argv: list[str]) -> tuple[str, list[str]]:
    """(what to print, the problems found)."""
    if argv == ["form"]:
        return form(), []
    if len(argv) != 3 or argv[0] not in ("check", "record") or argv[2] not in OUTCOMES:
        raise ValueError(__doc__)
    command, path, pick = argv[0], Path(argv[1]), argv[2]
    if command == "record":
        url = record(path.read_text(), pick, ".")
        return url and url + "\n", []
    if not path.is_file():
        return "", [f"{path}: missing. Next step: write the report on the form `premise_report.py form` prints."]
    return "", [f"{path}: {problem}" for problem in problems(path.read_text(), pick)]


def main() -> None:
    try:
        out, found = _run(sys.argv[1:])
    except speclocation.SpecLocationError as exc:
        print(exc, file=sys.stderr)
        sys.exit(1)
    except (OSError, ValueError, RuntimeError, UnicodeDecodeError) as exc:
        print(f"The premise report could not be handled: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(2)
    print(out, end="")
    for problem in found:
        print(problem, file=sys.stderr)
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
