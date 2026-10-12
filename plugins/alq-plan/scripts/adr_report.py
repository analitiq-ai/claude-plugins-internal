#!/usr/bin/env python3
"""The ADR report (#88): the decisions governing a plan, for critique to judge the plan against.

adrkit reads one corpus per run, so its own check runs once per corpus: the project's `docs/adr`, and the org's at
$ALQ_ORG_ADR_DIR. Each corpus keeps its own ids, so the same id in both is two decisions. The report carries each
governing record's full text, so critique reads one file inside the project. A corpus that is absent or not
configured is named in the report as not checked; one that is configured but cannot be checked stops the run.

Usage: adr_report.py <spec folder> <report file>. Exits 2 when the check cannot run.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

REPO_CORPUS = Path("docs/adr")
ORG_CORPUS_VAR = "ALQ_ORG_ADR_DIR"
CHECK = Path(".specify/extensions/adrkit/scripts/check.sh")
CHECK_MARKER = "==> adrkit:check"


class CannotCheck(Exception):
    pass


def corpora(repo_present: bool, org_dir: str | None) -> list[tuple[str, Path | None, str | None]]:
    """(section title, corpus to check or None, why it is not checked) for the project's corpus and the org's."""
    repo = (f"Repo decisions: {REPO_CORPUS}", REPO_CORPUS, None) if repo_present else \
        (f"Repo decisions: {REPO_CORPUS}", None, f"this project has no {REPO_CORPUS}")
    org = (f"Org decisions: {org_dir}", Path(org_dir), None) if org_dir else \
        ("Org decisions", None, f"{ORG_CORPUS_VAR} is unset")
    return [repo, org]


def governing(check_output: str) -> list[dict]:
    """The decisions adrkit's check reports as governing, from its marker-introduced JSON section."""
    _, marker, rest = check_output.partition(CHECK_MARKER + "\n")
    if not marker:
        raise ValueError(f"adrkit printed no `{CHECK_MARKER}` section")
    return json.loads(rest.split("\n==> ", 1)[0])["governedBy"]


def render(plan: Path, sections: list[tuple[str, Path | None, str | None, list[tuple[dict, str]]]]) -> str:
    """The report: per corpus, each governing decision with its record's text, or why there is none."""
    out = [f"# Decisions governing {plan}", ""]
    for title, corpus, not_checked, decisions in sections:
        out += [f"## {title}", ""]
        if not_checked:
            out += [f"Not checked: {not_checked}.", ""]
        elif not decisions:
            out += [f"No decision in {corpus} governs this plan.", ""]
        for decision, text in decisions:
            out += [f"### {decision['recordId']}: {decision['title']} ({decision['status']})", "", text.strip(), ""]
    return "\n".join(out)


def _check(corpus: Path, folder: str) -> list[tuple[dict, str]]:
    if not corpus.is_dir():
        raise CannotCheck(f"{corpus}: no such folder. Next step: point {ORG_CORPUS_VAR} at the org's docs/adr, "
                          "or unset it.")
    if not CHECK.is_file():
        raise CannotCheck(f"{CHECK}: missing, so adrkit cannot check {corpus}. "
                          "Next step: `specify extension add adrkit` in this project.")
    proc = subprocess.run([str(CHECK)], capture_output=True, text=True,
                          env={**os.environ, "ADRKIT_DIR": str(corpus), "ADRKIT_FEATURE_DIR": folder})
    if proc.returncode != 0:
        raise CannotCheck(f"adrkit's check of {corpus} exited {proc.returncode}: {proc.stderr.strip()} "
                          "Next step: fix what adrkit names, then resume the run.")
    decisions = []
    for decision in governing(proc.stdout):
        matches = sorted(corpus.glob(f"{decision['recordId']}-*.md"))
        if len(matches) != 1:
            raise CannotCheck(f"{corpus}: {len(matches)} record files for id {decision['recordId']}. "
                              "Next step: give each id one record file, then resume the run.")
        decisions.append((decision, matches[0].read_text()))
    return decisions


def main() -> None:
    if len(sys.argv) != 3:
        print("usage: adr_report.py <spec folder> <report file>", file=sys.stderr)
        sys.exit(2)
    folder, report = sys.argv[1:]
    try:
        sections = [(title, corpus, not_checked, _check(corpus, folder) if corpus else [])
                    for title, corpus, not_checked in corpora(REPO_CORPUS.is_dir(), os.environ.get(ORG_CORPUS_VAR))]
        Path(report).write_text(render(Path(folder) / "plan.md", sections))
    except (CannotCheck, OSError, ValueError, KeyError) as exc:
        print(f"The ADR check could not run, not the spec: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(2)


if __name__ == "__main__":
    main()
