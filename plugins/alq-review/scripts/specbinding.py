"""The review-round `spec` and `story` arguments: what they say, whether the folder has the shape of a spec folder,
whether they match the PR's binding, whether spec.md has the story's heading, and what a changed spec.md does to the
binding. Pure: the gate reads git."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Literal

from ledger import released


@dataclass(frozen=True)
class Folder:
    """A spec folder and the number of its user story a PR delivers."""
    path: str
    story: int


@dataclass(frozen=True)
class NoSpec:
    pass


def parse(value: object) -> str | None:
    """The spec folder path `value` names, None for null. ValueError when it is neither null nor a non-empty string."""
    if value is None:
        return None
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"spec is {value!r}, and it must be a spec folder path or null")
    return value.strip()


def parse_story(folder: str | None, args: dict) -> int | None:
    """The launch's story beside `folder`, None beside null. ValueError when `args` has a story beside null, whatever
    its form, or beside a folder none, or one that is not a JSON integer of 1 or more."""
    if folder is None:
        if "story" in args:
            raise ValueError(f"story is {json.dumps(args['story'])} beside spec null, and no spec has no story: a "
                             "change that needs no spec launches without args.story")
        return None
    story = args.get("story")
    if story is None:
        raise ValueError(f"args.story is {'missing' if 'story' not in args else 'null'}, and a spec folder needs a "
                         f"story: the number of the user story of {folder}/spec.md this PR delivers")
    # A JSON boolean arrives as a Python bool, which is an int.
    if isinstance(story, bool) or not isinstance(story, int):
        raise ValueError(f"story is {json.dumps(story)}, and the story is a JSON integer")
    if story < 1:
        raise ValueError(f"story is {story}, and the story is 1 or more")
    return story


def bound(state: dict) -> Folder | NoSpec | None:
    """What the PR is bound to; None when no launch has bound it. A folder binding always records its story, so one
    without raises KeyError."""
    if "spec" not in state:
        return None
    return NoSpec() if state["spec"] is None else Folder(state["spec"], state["story"])


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


def _shown(binding: Folder | NoSpec) -> str:
    return "spec null" if isinstance(binding, NoSpec) else f"spec `{binding.path}`, story {binding.story}"


def bind(recorded: Folder | NoSpec, given: Folder | NoSpec) -> str | None:
    """Why `given` is refused when it differs from the PR's binding `recorded`; None when it matches."""
    if recorded == given:
        return None
    return (f"This PR is bound to {_shown(recorded)}, and this launch gives {_shown(given)}. A PR's binding never "
            "changes")


def story_heading(story: int) -> str:
    return f"### User Story {story}"


def has_story(text: str, story: int) -> bool:
    """Whether a line of `text` starts with the story's heading, its number ending at a word boundary. Read as text,
    not Markdown: a heading inside a fenced code block counts."""
    return re.search(rf"^{re.escape(story_heading(story))}\b", text, re.M) is not None


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
