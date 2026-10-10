"""The review-round `spec` argument: what it says, whether its folder has the shape of a spec folder, whether it
matches the PR's binding, and what a changed spec.md does to that binding. Pure: the gate reads git."""
from __future__ import annotations

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
