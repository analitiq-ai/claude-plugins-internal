"""The review-round `spec` argument: the story value it names, whether its folder has the shape of a spec folder,
whether spec.md holds the story's heading, whether the PR header's `Implements:` line agrees, whether it matches the
PR's binding, and what a changed spec.md does to that binding. Pure: the gate reads git and the PR body."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Literal

from ledger import released

FORM = "'<folder>/spec.md § User Story <N>' or null"
# Single spaces only, and no zero-padded or zero story: one story has one spelling, as the binding compares strings.
_STORY_VALUE = re.compile(r"(?P<folder>\S+)/spec\.md § User Story (?P<number>[1-9][0-9]*)")
IMPLEMENTS = "Implements:"
IMPLEMENTS_FORM = f"`{IMPLEMENTS} <folder>/spec.md § User Story <N>`"


@dataclass(frozen=True)
class Story:
    folder: str
    number: int


@dataclass(frozen=True)
class NoSpec:
    pass


def parse(value: object) -> Story | NoSpec:
    """ValueError when `value` is neither null nor a story value."""
    if value is None:
        return NoSpec()
    matched = _STORY_VALUE.fullmatch(value) if isinstance(value, str) else None
    if matched is None:
        raise ValueError(f"spec is {value!r}, and it must be {FORM}")
    return Story(matched["folder"], int(matched["number"]))


def story_value(story: Story) -> str:
    return f"{story.folder}/spec.md § User Story {story.number}"


def shape_problem(folder: str) -> str | None:
    """The rule of a spec folder's shape that `folder` breaks; None when it breaks none."""
    path = PurePosixPath(folder)
    if path.is_absolute():
        return f"{folder} is absolute, and a spec folder is a path relative to the repo root"
    if ".." in path.parts:
        return f"{folder} has a `..` segment, and a spec folder names its path without one"
    if len(path.parts) < 2 or path.parts[-2] != "specs":
        return f"{folder} is not in a folder named `specs`, and a spec folder is"
    if path.as_posix() != folder:
        # git lists the folder in this spelling, and the binding compares the value as a string.
        return f"{folder} is not the folder's one spelling: write it as {path.as_posix()}"
    return None


def heading_problem(spec_md: str, number: int) -> str | None:
    """The refusal when no line of `spec_md` starts story `number`'s heading; None when one does. Textual: a heading
    in a fenced code block counts."""
    if re.search(rf"^### User Story {number}\b", spec_md, re.MULTILINE):
        return None
    return f"spec.md has no line starting `### User Story {number}`, the heading of User Story {number}"


def header_problem(body: str, given: Story | NoSpec) -> str | None:
    """The refusal when the PR body's first `Implements:` line disagrees with `given`; None when it agrees."""
    line = next((line for line in body.splitlines() if line.startswith(IMPLEMENTS)), None)
    if line is None:
        if isinstance(given, NoSpec):
            return None
        return (f"The PR body has no `{IMPLEMENTS}` line, and this launch gives spec `{story_value(given)}`. Next "
                f"step: add the line `{IMPLEMENTS} {story_value(given)}` to the PR body, then launch again.")
    try:
        named = parse(line[len(IMPLEMENTS):].strip())
    except ValueError:
        fix = (f"make it `{IMPLEMENTS} {story_value(given)}`" if isinstance(given, Story) else
               "remove the line from the PR body, or write it as a story value and launch with spec that value")
        return f"The PR body's first `{IMPLEMENTS}` line, `{line}`, is not {IMPLEMENTS_FORM}. Next step: {fix}."
    if isinstance(given, NoSpec):
        return (f"The PR body's line `{line}` says this PR implements a story, and this launch gives spec null. Next "
                f"step: launch with spec `{story_value(named)}`, or remove the line from the PR body.")
    if named != given:
        return (f"The PR body's first `{IMPLEMENTS}` line names `{story_value(named)}`, and this launch gives spec "
                f"`{story_value(given)}`. Next step: launch with spec `{story_value(named)}` if that is the story this "
                f"PR implements, or edit the line to `{IMPLEMENTS} {story_value(given)}`.")
    return None


def _shown(value: str | None) -> str:
    return "null" if value is None else f"`{value}`"


def bind(recorded: str | None, given: str | None) -> str | None:
    """The refusal when `given` differs from the PR's binding `recorded`; None when it matches."""
    if recorded == given:
        return None
    return (f"This PR is bound to spec {_shown(recorded)}, and this launch gives spec {_shown(given)}. A PR's bound "
            f"spec never changes. Next step: launch with spec {_shown(recorded)}.")


def text_step(bound_blob: str, head_blob: str, held_at: str | None,
              unlocked_at: str | None) -> Literal["same", "hold", "bind"]:
    """What a launch does with HEAD's spec.md against the bound one. `held_at` stamps the PR's recorded hold, None
    when none is. Once a later unlock has released the hold, HEAD's spec.md binds, whatever it then is: the unlock
    released the PR, not one text of it."""
    if bound_blob == head_blob:
        return "same"
    if held_at is not None and released(held_at, unlocked_at):
        return "bind"
    return "hold"
