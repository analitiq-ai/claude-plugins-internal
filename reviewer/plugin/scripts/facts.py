"""What git and the ledger say about a round, computed so the assessor cannot argue with it.

The signals were calibrated on this org's churned PRs: from round two on, findings that land on
lines a fix wrote, cite an earlier fix, or return to an already-reviewed spot, while the count
is not falling, marked every PR that went on to 5-24 rounds.
"""
from __future__ import annotations

import re

import worktree
from ledger import counted

NEAR_FIX_LINES = 3
SAME_UNIT_LINES = 10
_CITES_PRIOR_FIX = re.compile(
    r"\b(previous|prior|earlier|last|recent) (fix|commit|change|round|patch)\b|\bregress|\bintroduced (by|in)\b|\bno longer\b",
    re.I)


def _near(line: int | None, ranges: list[tuple[int, int]], slack: int) -> bool:
    return line is not None and any(lo - slack <= line <= hi + slack for lo, hi in ranges)


def round_facts(state: dict, rnd: dict, root: str) -> dict:
    earlier = [r for r in counted(state, rnd["stage"]) if r is not rnd]
    first_reviewed = state["rounds"][0]["head_sha"]
    # A branch takes its base by merge, never rebase, so what the base gained since the first round is in
    # `first_reviewed..HEAD` too: the fixes are what HEAD holds beyond that head merged with the round's base.
    fixed_from = worktree.merged(root, first_reviewed, rnd["base_sha"])
    fix_lines = worktree.added_lines(root, fixed_from)
    # `line` is optional: a whole-branch judgement (history-shape) names a file and no line.
    seen = [(f["file"], f.get("line")) for r in state["rounds"] if r is not rnd for f in r["findings"]]

    per_finding = {}
    for f in rnd["findings"]:
        spots = [(line, line) for path, line in seen if path == f["file"] and line is not None]
        per_finding[f["id"]] = {
            "on_fix_lines": _near(f.get("line"), fix_lines.get(f["file"], []), NEAR_FIX_LINES),
            "repeat_unit": _near(f.get("line"), spots, SAME_UNIT_LINES),
            "cites_prior_fix": bool(_CITES_PRIOR_FIX.search(f"{f['title']} {f.get('detail', '')}")),
        }

    counts = [len(r["findings"]) for r in earlier]
    count_not_falling = bool(counts) and len(rnd["findings"]) >= counts[-1]
    # The original change is measured from the base it was written on; a github first round records none.
    base = state["rounds"][0]["base_sha"] or rnd["base_sha"]
    edits = worktree.commits_per_file(root, first_reviewed, rnd["base_sha"])
    return {
        "round": rnd["n"],
        "stage": rnd["stage"],
        "finding_counts_of_earlier_rounds": counts,
        "count_not_falling": count_not_falling,
        "findings": per_finding,
        "original_additions": worktree.additions(root, base, first_reviewed),
        "fix_additions": worktree.additions(root, fixed_from, "HEAD"),
        "files_at_third_edit": sorted(f for f, n in edits.items() if n >= 3),
        "burden": count_not_falling and any(any(flags.values()) for flags in per_finding.values()),
    }
