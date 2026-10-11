#!/usr/bin/env python3
"""The premise report: what the planning skill answers at the workflow's `premise` pause, before any spec folder
exists, and what the user picked there.

The form below is the one place the questions are worded. A report is graded on its form and on each answer naming
a source, not on whether the answer is right: the user's pick is the judgement. spec.md has an answer
and a source per question under `## Why this is worth doing`, graded on the same form and not against the report.
A heading that is there twice, or a label that is twice in the lines it is read from, is refused: no one line is
then what the document says.

Usage: premise_report.py form | check <report> <pick> | spec <spec folder> | reason <report>. `check` and `spec`
print one problem per line and exit 1 when there are any, 2 when they could not run. `reason` prints the report's
`Reason:` text, and exits 1 when the report has none.
"""
from __future__ import annotations

import functools
import re
import sys
from pathlib import Path

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
SPEC_HEADING = "## Why this is worth doing"
_STOP_ONLY = "required unless the pick is write the spec"


def form() -> str:
    questions = "".join(f"## {name}\nQuestion: {asked}\nAnswer:\nSource:\n\n" for name, asked in QUESTIONS.items())
    return (f"{WRONG}:\n\n{questions}{RECOMMENDATION}:\n{PICK}:\n{RESTS_ON}:\n{REASON}:\n\n"
            f"<!--\n- {WRONG} is yes or no.\n- A source is {' <what>, '.join(SOURCES)} <what>.\n"
            f"- {RECOMMENDATION} and {PICK} are each one of: {', '.join(OUTCOMES)}.\n"
            f"- {RESTS_ON} is the heading of the question a stop pick rests on; {_STOP_ONLY}.\n"
            f"- {REASON} is one line; {_STOP_ONLY}.\n-->\n")


class Repeated(ValueError):
    """A label or heading that its scope holds more than once, so that no one line is what it says."""


def _lines(text: str) -> list[str]:
    return re.sub(r"<!--.*?-->", "", text, flags=re.DOTALL).splitlines()


def _field(lines: list[str], name: str, scope: str) -> str:
    """The value of the one `<name>: <value>` line among `lines`, which are those of `scope`; empty when the line
    is missing or has no value."""
    values = [line[len(name) + 1:].strip() for line in lines if line.startswith(f"{name}:")]
    if len(values) > 1:
        raise Repeated(f"{scope} has {len(values)} `{name}:` lines. Next step: keep the one that is meant.")
    return values[0] if values else ""


def filled(value: str) -> bool:
    """Whether a label has a value that is not a template's placeholder, which is one bracketed span and no more."""
    return bool(value) and not re.fullmatch(r"\[[^\]]*\]", value)


def _sections(lines: list[str], mark: str, scope: str) -> dict[str, list[str]]:
    """The lines under each heading that starts with `mark`, among `lines`, which are those of `scope`."""
    sections, into = {}, []
    for line in lines:
        if line.startswith(mark):
            name = line[len(mark):].strip()
            if name in sections:
                raise Repeated(f"{scope} has more than one `{mark}{name}` heading. Next step: keep one.")
            into = sections[name] = []
        else:
            into.append(line)
    return sections


def section(text: str, heading: str) -> list[str] | None:
    """The lines under the one `heading` line of `text`, up to the next `## ` heading; None without the heading."""
    lines = _lines(text)
    if lines.count(heading) > 1:
        raise Repeated(f"it has more than one `{heading}` heading. Next step: keep one.")
    if heading not in lines:
        return None
    under = lines[lines.index(heading) + 1:]
    return under[:next((at for at, line in enumerate(under) if line.startswith("## ")), len(under))]


def _repeat_is_the_problem(grade):
    """`grade`, with a repeated label or heading as the one problem it finds: nothing else is graded until it is
    there once."""
    @functools.wraps(grade)
    def graded(*args) -> list[str]:
        try:
            return grade(*args)
        except Repeated as exc:
            return [str(exc)]
    return graded


def reason(text: str) -> str:
    said = _field(_lines(text), REASON, "the premise report")
    if not filled(said):
        raise ValueError(f"the premise report's `{REASON}:` is `{said}`, not a reason")
    return said


def reports_wrong_behaviour(text: str) -> bool:
    said = _field(_lines(text), WRONG, "the premise report")
    if said not in ("yes", "no"):
        raise ValueError(f"the premise report's `{WRONG}:` is `{said}`, not `yes` or `no`")
    return said == "yes"


def _graded(pick: str, rests_on: str) -> list[str]:
    """The questions whose answers `pick` needs: all of them to write a spec, and for a stop pick those up to the
    one it rests on, since the stop makes the later ones moot."""
    names = list(QUESTIONS)
    return names if pick == WRITE else names[:names.index(rests_on) + 1] if rests_on in names else []


def _answer_problems(heading: str, name: str, lines: list[str]) -> list[str]:
    """What is wrong with the answer to question `name` among `lines`, the ones under `heading`."""
    answer, source = _field(lines, "Answer", f"`{heading}`"), _field(lines, "Source", f"`{heading}`")
    found = [f"`{heading}` has no `{field}:`. Next step: fill it in." for field, value
             in (("Answer", answer), ("Source", source)) if not filled(value)]
    if filled(source) and not any(source.startswith(kind) and source[len(kind):].strip() for kind in SOURCES):
        found.append(f"`{heading}` has the source `{source}`, which does not say where the answer came from. "
                     f"Next step: start it with {', '.join(f'`{kind}`' for kind in SOURCES[:-1])} or `{SOURCES[-1]}` "
                     "and then say what.")
    if name == "reachable" and filled(answer) and not answer.startswith(("observed", "predicted")):
        found.append(f"`{heading}` does not say whether the answer was seen or reasoned. Next step: start the "
                     "answer with `observed` or `predicted`.")
    return found


@_repeat_is_the_problem
def problems(text: str, pick: str) -> list[str]:
    """What stops `text` from being the report of a run whose user picked `pick`; empty when nothing does."""
    # A field outside the questions is read over the whole report, wherever it sits: a line of an answer that starts
    # with its label is a second one.
    lines = _lines(text)
    sections = _sections(lines, "## ", "it")
    wrong, recommended, written, rests_on, why = (_field(lines, name, "it") for name
                                                  in (WRONG, RECOMMENDATION, PICK, RESTS_ON, REASON))
    found = [f"it has no `## {name}` section. Next step: write the report on the form `premise_report.py form` "
             "prints." for name in QUESTIONS if name not in sections]
    if found:
        # The lines of a question with no heading sit under the heading before it, whose answer is then not its own.
        return found
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
        if not filled(why):
            found.append(f"`{REASON}:` is empty, and it is what the issue's comment will say. Next step: give the "
                         "reason in one line.")
    for name in _graded(pick, rests_on):
        found += _answer_problems(f"## {name}", name, sections[name])
    if wrong == "yes" and recommended == NO_SPEC:
        found.append(f"`{WRONG}: yes` and the recommendation is `{NO_SPEC}`: the size of a defect's fix is known "
                     f"only once it is traced. Next step: recommend `{WRITE}` or `{NOT_WORTH_DOING}`.")
    return found


@_repeat_is_the_problem
def spec_problems(spec: str) -> list[str]:
    """What stops `spec`, a spec.md, from holding the premise answers: each question as a `### <question>` heading
    under `SPEC_HEADING`, with its `Answer:` and `Source:` as the report gives them. A spec is written only on a
    pick that answered every question, so every question is graded."""
    under = section(spec, SPEC_HEADING)
    if under is None:
        return [f"it has no `{SPEC_HEADING}` section. Next step: add the section as the spec template gives it."]
    answers = _sections(under, "### ", f"`{SPEC_HEADING}`")
    missing = [f"`{SPEC_HEADING}` has no `### {name}`. Next step: copy the question's `Answer:` and `Source:` from "
               "the premise report under that heading." for name in QUESTIONS if name not in answers]
    return missing or [problem for name in QUESTIONS
                       for problem in _answer_problems(f"### {name}", name, answers[name])]


def _run(argv: list[str]) -> tuple[str, list[str]]:
    """(what to print, the problems found)."""
    if argv == ["form"]:
        return form(), []
    if len(argv) == 2 and argv[0] == "spec":
        spec = Path(argv[1]) / "spec.md"
        return "", [f"{spec}: {problem}" for problem in spec_problems(spec.read_text())]
    if len(argv) == 2 and argv[0] == "reason":
        report = Path(argv[1])
        # Read outside the try: an undecodable report raises a ValueError too, and is one that could not be read.
        text = report.read_text()
        try:
            return reason(text) + "\n", []
        except ValueError as exc:
            return "", [f"{report}: {exc}"]
    if len(argv) != 3 or argv[0] != "check" or argv[2] not in OUTCOMES:
        raise ValueError(__doc__)
    path, pick = Path(argv[1]), argv[2]
    if not path.is_file():
        return "", [f"{path}: missing. Next step: write the report on the form `premise_report.py form` prints."]
    return "", [f"{path}: {problem}" for problem in problems(path.read_text(), pick)]


def main() -> None:
    try:
        out, found = _run(sys.argv[1:])
    except (OSError, ValueError) as exc:
        print(f"The premise report could not be handled: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(2)
    print(out, end="")
    for problem in found:
        print(problem, file=sys.stderr)
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
