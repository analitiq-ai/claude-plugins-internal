"""Where a piece of text is after an edit: the pure core of the lineage rule (ADR-0001). No I/O: git's hunks and the
texts arrive as arguments, so every answer is a function of them."""
from __future__ import annotations

import copy
import sys
import sysconfig
from bisect import bisect_right
from pathlib import Path

import claimcheck
from worktree import Hunk

LIBRARY = "diff-match-patch"
# Character-diff time grows with the product of the two sizes (research R4: 12,673 characters each took 16.8 s), so the
# bound is on size, not on the clock: that keeps the answer a function of the two texts.
CHAR_DIFF_BUDGET = 5 * 10**7

Span = tuple[int, int]


class Unavailable(RuntimeError):
    """The diff library cannot be imported: the check could not run, which is not a finding about the work."""


class BudgetExceeded(RuntimeError):
    """A replaced range is too large to map within the budget: the check could not run."""


class SpanNotFound(ValueError):
    """A claim's words are not in the file it was read from: a defect of the gate, not an input to tolerate."""


def install_step(executable: str, in_venv: bool, externally_managed: bool) -> str:
    """The command that installs the library for the interpreter that runs the hooks. A PEP 668 interpreter outside a
    venv refuses pip, so the step named there is the system package: it must be one that can succeed (ADR-0009)."""
    if externally_managed and not in_venv:
        return f"sudo apt install python3-{LIBRARY}"
    return f"{executable} -m pip install {LIBRARY}"


def differ():
    """The diff-match-patch object, with its clock off so that two texts always give one answer."""
    try:
        import diff_match_patch
    except ImportError as exc:
        managed = (Path(sysconfig.get_path("stdlib")) / "EXTERNALLY-MANAGED").exists()
        in_venv = sys.prefix != sys.base_prefix
        elsewhere = (" (the Debian and Ubuntu package; use your system's package manager elsewhere, or a virtual "
                     "environment)" if managed and not in_venv else "")
        raise Unavailable(f"The check could not run: {LIBRARY} is not installed for {sys.executable}. Install it "
                          f"with `{install_step(sys.executable, in_venv, managed)}`{elsewhere}, then launch the "
                          "check again.") from exc
    found = diff_match_patch.diff_match_patch()
    found.Diff_Timeout = 0
    return found


def span_of(text: str, line: int, quote: str) -> Span:
    """The offsets of the first and last word of `quote` in `text`, from the start of 1-based `line` on. The words
    are those `claimcheck.plain` hashes, so the span and the claim id agree on what the words are."""
    wanted = claimcheck.plain(quote).split(" ")
    found = claimcheck.words(text)
    starts = _line_starts(text)
    if line > len(starts) or not wanted[0]:
        raise SpanNotFound(f"{quote!r} is not at line {line}")
    for i in range(len(found) - len(wanted) + 1):
        if found[i][1] >= starts[line - 1] and [w for w, _, _ in found[i:i + len(wanted)]] == wanted:
            return found[i][1], found[i + len(wanted) - 1][2]
    raise SpanNotFound(f"{quote!r} is not in the text from line {line}")


def carry(spans: list[Span], old: str, new: str, hunks: list[Hunk]) -> list[Span | None]:
    """Each span of `old` in `new`, or None where it is gone. The two ends of a span are mapped apart. Outside every
    hunk an offset moves by the lines the hunks above it added or removed. Inside a replaced range it follows a
    character diff of that range. Inside a pure deletion it lands where the text was, and a span whose two ends meet
    is gone."""
    ground = _Ground(old, new, hunks)
    ground.check_budget([pos for span in spans for pos in span])
    mapped = [(ground.position(start), ground.position(end)) for start, end in spans]
    return [(start, end) if end > start else None for start, end in mapped]


def succeed(lineages: list[dict], old: str, new: str, hunks: list[Hunk], claims: list[dict], count, ref: str
            ) -> tuple[list[dict], dict[str, list[str]]]:
    """Which lineage each claim read in `new` belongs to, and where every lineage's words now are. `lineages` are a
    file's open ones, with `places` in `old`. A claim inherits a lineage whose carried place it overlaps, else one
    whose id is the claim's id or the id of words it held (words moved unchanged); several is a split. A claim that
    inherits several lineages merges them: the one with the higher `count(lineage)` goes on (the smaller id on a
    tie), the others end as `merged` naming it. A place carried to text no claim was read in stays. A lineage with no
    place left ends as `deleted`. Returns every lineage given, and `{claim id: [lineage id]}`."""
    found = {item["id"]: copy.deepcopy(item) for item in lineages}
    carried = {item["id"]: list(zip(item["places"], carry([(p["start"], p["end"]) for p in item["places"]], old, new,
                                                          hunks))) for item in lineages}
    spans = {c["id"]: span_of(new, c["line"], c["quote"]) for c in claims}
    survivor: dict[str, str] = {}  # a merged lineage's id -> the lineage it went into

    def live(lid: str) -> str:
        while lid in survivor:
            lid = survivor[lid]
        return lid

    def overlaps(a: Span, b: Span) -> bool:
        return max(a[0], b[0]) < min(a[1], b[1])

    inherited: dict[str, list[str]] = {}
    for claim in sorted(claims, key=lambda c: spans[c["id"]]):
        by_place = [lid for lid, places in carried.items()
                    if any(span and overlaps(span, spans[claim["id"]]) for _, span in places)]
        by_id = [lid for lid, places in carried.items()
                 if claim["id"] == lid or any(place["claim"] == claim["id"] for place, _ in places)]
        owners = sorted({live(lid) for lid in (by_place or by_id)})
        if not owners:
            continue
        winner = max(owners, key=lambda lid: (count(found[lid]), -owners.index(lid)))
        for lid in owners:
            if lid != winner:
                survivor[lid] = winner
                found[lid].update(state="ended", ended={"by": "merged", "ref": ref, "into": winner})
        inherited[claim["id"]] = [winner]
    for lid, item in found.items():
        if lid in survivor:
            continue
        read = [{"start": spans[c][0], "end": spans[c][1], "claim": c}
                for c, owned in inherited.items() if owned == [lid]]
        unread = [{"start": span[0], "end": span[1], "claim": place["claim"]} for place, span in carried[lid]
                  if span and not any(overlaps(span, spans[c["id"]]) for c in claims)]
        item["places"] = sorted(read + unread, key=lambda p: p["start"])
        if not item["places"]:
            item.update(state="ended", ended={"by": "deleted", "ref": ref, "into": None})
    return list(found.values()), inherited


def _line_starts(text: str) -> list[int]:
    return [0] + [i + 1 for i, char in enumerate(text) if char == "\n"]


class _Ground:
    """The two texts, their line tables and the hunks between them, with each replaced range's diff kept once."""

    def __init__(self, old: str, new: str, hunks: list[Hunk]):
        self.old, self.new, self.hunks = old, new, sorted(hunks, key=lambda h: h.old_start)
        self.old_starts, self.new_starts = _line_starts(old), _line_starts(new)
        self._differ = None
        self._diffs: dict[Hunk, list] = {}

    def _line_text(self, text: str, starts: list[int], first: int, count: int) -> str:
        last = first + count - 1
        end = starts[last] - 1 if last < len(starts) else len(text)
        return text[starts[first - 1]:end]

    def _replaced(self, hunk: Hunk) -> tuple[str, str]:
        return (self._line_text(self.old, self.old_starts, hunk.old_start, hunk.old_count),
                self._line_text(self.new, self.new_starts, hunk.new_start, hunk.new_count))

    def _line_of(self, pos: int) -> int:
        """The 1-based old line a position is on. A span ends on its last word, never at the start of a line."""
        return bisect_right(self.old_starts, pos)

    def _covering(self, line: int) -> Hunk | None:
        return next((h for h in self.hunks if h.old_count and h.old_start <= line < h.old_start + h.old_count), None)

    def check_budget(self, positions: list[int]) -> None:
        used = {h for h in map(self._covering, map(self._line_of, positions)) if h and h.new_count}
        cost = sum(len(removed) * len(added) for removed, added in map(self._replaced, used))
        if cost > CHAR_DIFF_BUDGET:
            raise BudgetExceeded(f"The check could not run: the text it has to follow was rewritten by more than it "
                                 f"can map ({cost} against a budget of {CHAR_DIFF_BUDGET}). Next step: split the "
                                 "change into smaller edits, stage and commit them one after another, and run the "
                                 "check again.")

    def position(self, pos: int) -> int:
        line = self._line_of(pos)
        hunk = self._covering(line)
        if hunk is None:
            shift = sum(h.new_count - h.old_count for h in self.hunks
                        if (h.old_start + h.old_count - 1 if h.old_count else h.old_start) < line)
            return self.new_starts[line + shift - 1] + pos - self.old_starts[line - 1]
        if not hunk.new_count:
            return self.new_starts[hunk.new_start] if hunk.new_start < len(self.new_starts) else len(self.new)
        removed, added = self._replaced(hunk)
        if self._differ is None:
            self._differ = differ()
        if hunk not in self._diffs:
            self._diffs[hunk] = self._differ.diff_main(removed, added)
            self._differ.diff_cleanupSemantic(self._diffs[hunk])
        offset = min(pos - self.old_starts[hunk.old_start - 1], len(removed))
        return self.new_starts[hunk.new_start - 1] + self._differ.diff_xIndex(self._diffs[hunk], offset)
