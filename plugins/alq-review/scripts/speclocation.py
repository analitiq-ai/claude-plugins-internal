"""The location comment: the one comment on an issue that says where its spec folder is, or that it needs none."""
from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

import github
import worktree

MARKER = "<!-- analitiq-spec -->"
FORM = (f"{MARKER}\nspec: <folder path from the repo root, ending specs/<feature>>\n"
        "branch: <branch that holds it>\n"
        f"or, for an issue that needs no spec:\n{MARKER}\nspec: none\nreason: <one line>")

_ISSUE_IN_BRANCH = re.compile(r"^[a-z]+/(\d+)-")

@dataclass(frozen=True)
class Located:
    folder: str
    branch: str


@dataclass(frozen=True)
class NoSpec:
    reason: str


@dataclass(frozen=True)
class FoundSpec:
    """`text` is the folder's spec.md as the checkout's HEAD has it."""
    folder: str
    text: str


class SpecLocationError(RuntimeError):
    """The message says what is wrong and what to do next."""


def _malformed(why: str) -> SpecLocationError:
    return SpecLocationError(f"its `{MARKER}` comment {why}. Next step: make the comment exactly\n{FORM}")


def _value(line: str, key: str) -> str:
    name, colon, value = line.partition(": ")
    if name != key or not colon or not value.strip():
        raise _malformed(f"has the line `{line}` where `{key}: <value>` belongs")
    return value.strip()


def _folder(spec: str) -> str:
    path = PurePosixPath(spec)
    if path.is_absolute() or ".." in path.parts or len(path.parts) < 2 or path.parts[-2] != "specs":
        raise _malformed(f"names `{spec}`, which is not a spec folder inside the repo")
    return str(path)


def parse(body: str) -> Located | NoSpec:
    """What a comment whose first line is the marker says."""
    lines = body.strip().splitlines()[1:]
    if any(line.strip() for line in lines) and not any(line.lstrip().startswith("spec:") for line in lines):
        raise SpecLocationError(
            f"its `{MARKER}` comment has text after the marker and no `spec:` line, so it does not say where a "
            "spec folder is. Next step: run `/alq-review:design-doc` on the issue; it creates the spec folder and "
            "rewrites the comment to say where the folder is.")
    if len(lines) != 2:
        raise _malformed(f"has {len(lines)} lines after the marker, not 2")
    spec = _value(lines[0], "spec")
    if spec == "none":
        return NoSpec(_value(lines[1], "reason"))
    return Located(_folder(spec), _value(lines[1], "branch"))


def _checked(body: str) -> str:
    """`body`, once `parse` reads it back: a comment `parse` would refuse is never posted."""
    parse(body)
    return body


def render(folder: str, branch: str) -> str:
    return _checked(f"{MARKER}\nspec: {folder}\nbranch: {branch}\n")


def render_none(reason: str) -> str:
    return _checked(f"{MARKER}\nspec: none\nreason: {reason}\n")


def issue_number(branch: str) -> int | None:
    found = _ISSUE_IN_BRANCH.match(branch)
    return int(found.group(1)) if found else None


def _comment(slug: str, issue: int) -> tuple[int, str] | None:
    """(id, body) of the issue's location comment, the one whose first line is the marker; None when it has none.
    A comment that only quotes the marker further down, as a pasted refusal does, is not one."""
    found = [(id_, body) for id_, body in github.issue_comments(slug, issue)
             if body.lstrip().splitlines()[:1] == [MARKER]]
    if len(found) > 1:
        raise SpecLocationError(f"{slug}#{issue} has {len(found)} location comments "
                                f"({', '.join(str(id_) for id_, _ in found)}), and only one can say where the spec "
                                "is. Next step: delete all but one.")
    return found[0] if found else None


def _upsert(slug: str, issue: int, body: str) -> str:
    found = _comment(slug, issue)
    return github.write_issue_comment(slug, issue, body, found and found[0])


def located(slug: str, issue: int) -> Located | NoSpec:
    """What the issue's location comment says."""
    found = _comment(slug, issue)
    if found is None:
        raise SpecLocationError(f"{slug}#{issue} has no location comment, so nothing says where its spec is. "
                                f"Next step: run `/alq-review:design-doc #{issue}`; it creates the spec folder and "
                                "posts the comment.")
    try:
        return parse(found[1])
    except SpecLocationError as exc:
        raise SpecLocationError(f"{slug}#{issue}: {exc}") from exc


def resolve(slug: str, branch: str, root: str) -> FoundSpec | NoSpec | None:
    """What a change on `branch` is graded against: spec.md of the folder its issue names, as committed in the
    checkout at `root`; NoSpec when the issue needs none; None when the branch names no issue. SpecLocationError
    when the comment or the file cannot be used; RuntimeError when gh cannot read the issue's comments."""
    issue = issue_number(branch)
    if issue is None:
        return None
    where = located(slug, issue)
    if isinstance(where, NoSpec):
        return where
    path = f"{where.folder}/spec.md"
    # As committed: an edit that is not in HEAD is not part of the change under review.
    text = worktree.tree_text(root, worktree.head_tree(root), path)
    if not (text or "").strip():
        raise SpecLocationError(f"{slug}#{issue} places its spec in {where.folder}, and this checkout's HEAD has no "
                                f"{path} with text in it. The comment says branch {where.branch} holds it. Next "
                                "step: commit the file on that branch if it is not there, and check that branch out "
                                "or merge it, then try again.")
    return FoundSpec(where.folder, text)


def _issue_of(checkout: str) -> tuple[worktree.Worktree, int]:
    where = worktree.locate(checkout)
    if where is None:
        raise SpecLocationError(f"{checkout} is not on a branch of a GitHub repo. Next step: run this from the "
                                "issue's worktree.")
    issue = issue_number(where.branch)
    if issue is None:
        raise SpecLocationError(f"Branch {where.branch} names no issue, so there is no issue to post on. "
                                "Next step: work on a branch named `<type>/<issue>-<description>`.")
    return where, issue


def post(project: str) -> str:
    """Points the issue of `project`'s branch at the spec folder Spec Kit last worked on there; the comment's URL."""
    where, issue = _issue_of(project)
    feature = json.loads((Path(project) / ".specify" / "feature.json").read_text())["feature_directory"]
    folder = (Path(project).resolve() / feature).relative_to(Path(where.root).resolve()).as_posix()
    return _upsert(where.slug, issue, render(folder, where.branch))


def post_none(checkout: str, reason: str) -> str:
    where, issue = _issue_of(checkout)
    return _upsert(where.slug, issue, render_none(reason))


def show(slug: str, issue: int) -> str:
    where = located(slug, issue)
    body = render_none(where.reason) if isinstance(where, NoSpec) else render(where.folder, where.branch)
    return body.removeprefix(MARKER + "\n")


def _run(parser: argparse.ArgumentParser) -> str:
    args = parser.parse_args()
    if args.command == "post":
        return post(args.checkout) + "\n"
    if args.command == "none":
        if not args.reason.strip():
            parser.error("none needs a reason")
        return post_none(args.checkout, args.reason) + "\n"
    here = worktree.locate(".")
    if not (args.repo or here):
        parser.error("show needs --repo outside a checkout of a GitHub repo")
    return show(args.repo or here.slug, args.issue)


def main() -> int:
    parser = argparse.ArgumentParser(description="Read or post an issue's location comment.")
    commands = parser.add_subparsers(dest="command", required=True)
    shown = commands.add_parser("show", help="print where the issue's spec is")
    shown.add_argument("issue", type=int)
    shown.add_argument("--repo", help="<owner>/<repo>; the current checkout's when left out")
    commands.add_parser("post", help="point the branch's issue at its spec folder").add_argument("checkout")
    none = commands.add_parser("none", help="record that the branch's issue needs no spec")
    none.add_argument("checkout")
    none.add_argument("reason")
    try:
        print(_run(parser), end="")
    except SpecLocationError as exc:
        print(exc, file=sys.stderr)
        return 1
    except (RuntimeError, OSError, ValueError, KeyError) as exc:
        print(f"The location comment could not be read or posted: {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
