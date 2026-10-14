"""A spec folder is a `<...>/specs/<name>` folder, the shape `shape_problem` checks; its spec.md is
`<folder>/spec.md`, the requirements a story PR is graded against. The review-round `spec` argument names that folder
or null, and the first round binds the PR to it. What a changed spec.md does to that binding is `text_step`. A story
branch (`<issue>-us<n>-<slug>`) delivers one user story and never changes a spec.md: a spec change lands in a
spec-only PR on `<issue>-spec`, so its edit tools are refused one (`story_edit_refusal`). Pure: the gate reads git."""
from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Literal

from ledger import released


@dataclass(frozen=True)
class Folder:
    path: str


@dataclass(frozen=True)
class NoSpec:
    pass


def parse(value: object) -> Folder | NoSpec:
    """ValueError when `value` is neither null nor a non-empty string."""
    if value is None:
        return NoSpec()
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"spec is {value!r}, and it must be a spec folder path or null")
    return Folder(value.strip())


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


def spec_folder(path: str) -> str | None:
    """The spec folder repo-relative `path` lies under; None when it lies under none."""
    return next((folder.as_posix() for folder in PurePosixPath(path).parents
                 if folder.parts and shape_problem(folder.as_posix()) is None), None)


def spec_md_folder(path: str) -> str | None:
    """The spec folder whose spec.md `path` is; None when `path` is not a spec folder's spec.md."""
    folder = spec_folder(path)
    return folder if folder is not None and path == f"{folder}/spec.md" else None


_STORY_BRANCH = re.compile(r"(\d+)-us\d+-")


def story_issue(branch: str | None) -> str | None:
    """The issue a story branch delivers a user story of; None when `branch` is not a story branch."""
    found = _STORY_BRANCH.match(branch or "")
    return found.group(1) if found else None


def story_edit_refusal(branch: str, path: str) -> str | None:
    """Why an edit tool may not write repo-relative `path` on `branch`; None when the rule allows it."""
    issue, folder = story_issue(branch), spec_md_folder(path)
    if issue is None or folder is None:
        return None
    return (f"`{path}` is the spec.md of spec folder `{folder}`, and `{branch}` is a story branch: a story branch never "
            f"changes a spec.md. Next step: stop and raise the spec problem to the user. They land the change in a "
            f"spec-only PR on `{issue}-spec`; once it merges, this branch rebases on it.")


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
