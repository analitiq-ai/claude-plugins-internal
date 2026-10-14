#!/usr/bin/env python3
"""The run's spec folder: one per issue, `specs/<issue>-<short-name>` under the run's project.

`check` grades the folder a run is given before anything is written. A new scope needs an issue with no folder yet; a
rescope needs the issue's one folder, holding a spec.md. `recorded` grades the folder `specify` named in
`.specify/feature.json` against the one the run gave it: Spec Kit names a folder itself when it does not take the
one it is given.

Usage: spec_folder.py check <folder> <issue> new|rescope | recorded <folder>. Run in the project, in a git checkout.
Prints one problem per line and exits 1 when there are any, 2 when the check cannot run.
"""
from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

FORM = "specs/<issue>-<short-name>"
_FOLDER = re.compile(r"specs/(?P<name>[0-9]+-[a-z0-9]+(?:-[a-z0-9]+)*)")
# The number as GitHub writes it, so `079-` never stands for #79.
_ISSUE = re.compile(r"[1-9][0-9]*")
FEATURE_JSON = Path(".specify/feature.json")


def problems(folder: str, issue: str, kind: str, existing: dict[str, bool], project: str) -> list[str]:
    """`existing` maps each folder name in the project's `specs/` to whether it holds a spec.md. `project` is the
    project's folder in the checkout, empty or ending in `/`: a rescope's folder is read from the checkout, so a
    refusal names folders from there."""
    if kind not in ("new", "rescope"):
        raise ValueError(f"the kind of run is new or rescope, got {kind!r}")
    if not _ISSUE.fullmatch(issue):
        return [f"the issue is `{issue}`, not an issue number as GitHub writes it. Next step: start the run with the "
                "issue's number."]

    def in_checkout(path):
        return f"{project}{path}"

    given = in_checkout(folder)
    found = _FOLDER.fullmatch(folder)
    if not found:
        return [f"`{given}` is not of the form `{FORM}`, a short name being lowercase words of `[a-z0-9]` "
                "joined by single hyphens. Next step: start the run with a folder of that form."]
    prefix = f"{issue}-"
    if not found["name"].startswith(prefix):
        return [f"`{given}` is not issue #{issue}'s: its name does not start with `{prefix}`. Next step: "
                f"start the run with a folder named `{prefix}<short-name>`."]
    issue_folders = sorted(in_checkout(f"specs/{name}") for name in existing if name.startswith(prefix))
    if kind == "new":
        if issue_folders:
            forms = ", ".join(f"`rescope {path} #{issue}`" for path in issue_folders)
            return [f"issue #{issue} already has a spec folder, so it is not scoped again. Next step: {forms}."]
        return []
    if not existing.get(found["name"]):
        return [f"`{given}` holds no spec.md, so there is no spec to rescope. Next step: rescope the folder "
                f"that holds issue #{issue}'s spec, or scope the issue with `#{issue}`."]
    others = [f"`{path}`" for path in issue_folders if path != given]
    if others:
        return [f"issue #{issue} has another spec folder besides `{given}`: {', '.join(others)}. Next step: "
                "keep one folder for the issue, then rescope it."]
    return []


def recorded_problems(folder: str, recorded: str | None) -> list[str]:
    """`recorded` is the folder `.specify/feature.json` names, None when it names none."""
    if recorded == folder:
        return []
    named = f"`{recorded}`" if recorded is not None else "no folder"
    return [f"`specify` recorded {named} in {FEATURE_JSON}, not the run's folder `{folder}`. Next step: discard "
            f"everything `specify` wrote, `{folder}` included (`git status` shows it), then start the scope again."]


def _existing() -> dict[str, bool]:
    specs = Path("specs")
    if not specs.is_dir():
        return {}
    return {p.name: (p / "spec.md").is_file() for p in specs.iterdir() if p.is_dir()}


def _project() -> str:
    # Only stdout is taken: git's stderr goes to the step's, so its reason is shown when it cannot answer.
    return subprocess.run(["git", "rev-parse", "--show-prefix"], stdout=subprocess.PIPE, text=True,
                          check=True).stdout.strip()


def _recorded() -> str | None:
    if not FEATURE_JSON.is_file():
        return None
    feature = json.loads(FEATURE_JSON.read_text())
    if not isinstance(feature, dict):
        raise ValueError(f"{FEATURE_JSON} holds no JSON object")
    return feature.get("feature_directory")


def main() -> None:
    args = sys.argv[1:]
    try:
        if len(args) == 4 and args[0] == "check":
            found = problems(args[1], args[2], args[3], _existing(), _project())
        elif len(args) == 2 and args[0] == "recorded":
            found = recorded_problems(args[1], _recorded())
        else:
            raise ValueError(__doc__)
    except (OSError, ValueError, subprocess.CalledProcessError) as exc:
        print(f"The spec folder check could not run: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(2)
    for problem in found:
        print(problem, file=sys.stderr)
    sys.exit(1 if found else 0)


if __name__ == "__main__":
    main()
