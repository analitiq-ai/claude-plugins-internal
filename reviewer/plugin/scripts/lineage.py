"""Where a piece of text is after an edit: the core of the lineage rule (ADR-0001). It reads no repository, ledger or
file: git's hunks and the texts arrive as arguments. Only `differ` looks outside them, at the interpreter and the
libraries it can import."""
from __future__ import annotations

import copy
import re
import sys
import sysconfig
from bisect import bisect_left, bisect_right
from pathlib import Path

import claimcheck
from worktree import Hunk

LIBRARY = "diff-match-patch"
# Character-diff time grows with the product of the two sizes (measured: 12,673 characters each took 16.8 s), so the
# bound is on size, not on the clock: that keeps the answer a function of the two texts.
CHAR_DIFF_BUDGET = 5 * 10**7

Span = tuple[int, int]  # (offset of the first character, offset one past the last): half-open, as a slice


class Unavailable(RuntimeError):
    """The diff library cannot be imported: the check could not run, which is not a finding about the work."""


class SpanNotFound(ValueError):
    """A claim's words are not in the file it was read from: a defect of the gate, not an input to tolerate."""


def install_step(executable: str, in_venv: bool, externally_managed: bool) -> str:
    """The command that installs the library for the interpreter that runs the hooks. A PEP 668 interpreter outside a
    venv refuses pip, so the step named there is the system package: it must be one that can succeed (ADR-0005)."""
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


def lines(text: str) -> list[str]:
    """The lines of a text as git numbers them: split at "\\n" only, the final "\\n" ending the last line and starting
    none. `str.splitlines` also splits at a form feed or U+2028, so a line number from it is not one git or a reader
    of the file gives."""
    found = text.split("\n")
    return found[:-1] if found[-1] == "" else found


class Words:
    """A text's words as one string with single spaces between them, built once, and where each of its characters came
    from: any number of searches then cost the search alone. The words are those `claimcheck.plain` hashes, so a span
    and a claim id agree on what the words are."""

    def __init__(self, text: str):
        self._starts = _line_starts(text)
        parts: list[str] = []
        self._origin: list[int] = []
        self._word_starts: list[int] = []
        self._flat_at: list[int] = []
        flat_length = 0
        for word, start, _ in claimcheck.words(text):
            if parts:
                parts.append(" ")
                self._origin.append(self._origin[-1])
                flat_length += 1
            self._word_starts.append(start)
            self._flat_at.append(flat_length)
            parts.append(word)
            self._origin.extend(range(start, start + len(word)))
            flat_length += len(word)
        self._flat = "".join(parts)

    def span(self, line: int, quote: str) -> Span:
        """Where `quote` stands, from the start of 1-based `line` on: the offset of its first character and the offset
        one past its last. A quote of whole words is found as such; one that is part of a word (a test's name inside
        its `def`) where it stands. Raises SpanNotFound when the words are nowhere from that line on."""
        wanted = claimcheck.plain(quote)
        if line > len(self._starts) or not wanted:
            raise SpanNotFound(f"{quote!r} is not at line {line}")
        first = bisect_left(self._word_starts, self._starts[line - 1])
        found = self._search(wanted, self._flat_at[first] if first < len(self._flat_at) else len(self._flat))
        if found is None:
            raise SpanNotFound(f"{quote!r} is not in the text from line {line}")
        return found

    def find(self, quote: str) -> Span | None:
        """Where `quote` stands anywhere in the text, found as `span` finds it: as whole words if they stand so
        anywhere, else where they stand inside a word. None when the words are nowhere."""
        wanted = claimcheck.plain(quote)
        return self._search(wanted, 0) if wanted else None

    def _search(self, wanted: str, floor: int) -> Span | None:
        escaped = re.escape(wanted)
        for pattern in (rf"(?<!\S){escaped}(?!\S)", escaped):
            found = re.compile(pattern).search(self._flat, floor)
            if found:
                return self._origin[found.start()], self._origin[found.end() - 1] + 1
        return None


def line_span(text: str, first: int, count: int) -> Span:
    """From the start of 1-based line `first` to the end of its last of `count` lines. A pure insertion (no line) is the
    line it follows, and lines past the text are held to the text's own."""
    starts = _line_starts(text)
    total = max(len(starts) - text.endswith("\n"), 1)
    first = min(max(first, 1), total)
    last = min(first + max(count, 1) - 1, total)
    return starts[first - 1], (starts[last] - 1 if last < len(starts) else len(text))


def lines_of(text: str, span: Span) -> tuple[int, int]:
    """(first line, line count) of a span: the lines its first and its last character are on."""
    starts = _line_starts(text)
    first, last = bisect_right(starts, span[0]), bisect_right(starts, max(span[1] - 1, span[0]))
    return first, last - first + 1


def carry(spans: list[Span], old: str, new: str, hunks: list[Hunk]) -> list[Span | None]:
    """Each span of `old` in `new`, or None where it is gone. The two ends of a span are mapped apart. Outside every
    hunk an offset moves by the lines the hunks above it added or removed. Inside a replaced range it follows a
    character diff of that range, while the diffs together stay within `CHAR_DIFF_BUDGET`: a span in a range that would
    take them past it maps to the whole replacement, so it is kept unless that replacement has no characters. Inside a
    pure deletion it lands where the text was, and a span whose two ends meet is gone."""
    return _Ground(old, new, hunks).carry(spans)


def succeed(lineages: list[dict], old: str, new: str, hunks: list[Hunk], claims: list[dict], count, ref: str
            ) -> tuple[list[dict], dict[str, list[str]]]:
    """Which lineage each claim read in `new` belongs to, and where every lineage's words now are. `lineages` are a
    file's open ones, with `places` in `old`. The words of a place carried to nothing, and a lineage's first words when
    none of its places was carried or found, are looked for in `new`, so a lineage whose words are still in the file is
    not ended as `deleted`
    for want of a claim read there. A claim inherits a lineage whose place it overlaps, else one whose id is the claim's
    id or the id of words it held; several is a split. A claim that inherits several lineages merges them: the one with
    the higher `count(lineage)` goes on (the smaller id on a tie) with the places of all of them, the others end as
    `merged` naming it. A place in text no claim was read in stays. A lineage with no place left ends as `deleted`.
    The returned map has no key for a claim that belongs to no lineage. A place in a range replaced past the budget
    is carried as `carry` carries it, to the whole replacement."""
    found = {item["id"]: copy.deepcopy(item) for item in lineages}
    index = Words(new)
    spans = {c["id"]: index.span(c["line"], c["quote"]) for c in claims}
    ground = _Ground(old, new, hunks)
    placed = [(lid, place) for lid, item in found.items() for place in item["places"]]
    mapped = ground.carry([(place["start"], place["end"]) for _, place in placed])
    carried: dict[str, list[tuple[dict, Span | None]]] = {lid: [] for lid in found}
    for (lid, place), span in zip(placed, mapped):
        carried[lid].append((place, span or index.find(old[place["start"]:place["end"]])))
    for lid, item in found.items():
        if not any(span for _, span in carried[lid]):
            first = next((entry["words"] for entry in item["chain"] if entry["claim"] == lid), None)
            span = first and index.find(first)
            if span:
                carried[lid].append(({"claim": lid}, span))
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
                claimcheck.end(found[lid], "merged", ref, winner)
        inherited[claim["id"]] = [winner]
    for lid in survivor:
        found[lid]["ended"]["into"] = live(lid)
    inherited = {cid: [live(lid) for lid in owned] for cid, owned in inherited.items()}
    for lid, item in found.items():
        if lid in survivor:
            continue
        read = [{"start": spans[c][0], "end": spans[c][1], "claim": c}
                for c, owned in inherited.items() if owned == [lid]]
        unread = [{"start": span[0], "end": span[1], "claim": place["claim"]}
                  for member in found if live(member) == lid for place, span in carried[member]
                  if span and not any(overlaps(span, spans[c["id"]]) for c in claims)]
        item["places"] = sorted(read + unread, key=lambda p: p["start"])
        if not item["places"]:
            claimcheck.end(item, "deleted", ref)
    return list(found.values()), inherited


def _line_starts(text: str) -> list[int]:
    return [0] + [i + 1 for i, char in enumerate(text) if char == "\n"]


class _Ground:
    """The two texts, their line tables and the hunks between them, with each replaced range's diff kept once and the
    ranges the budget could not afford noted in `widened`."""

    def __init__(self, old: str, new: str, hunks: list[Hunk]):
        self.old, self.new, self.hunks = old, new, sorted(hunks, key=lambda h: h.old_start)
        self.old_starts, self.new_starts = _line_starts(old), _line_starts(new)
        self.widened: set[Hunk] = set()
        self._differ = None
        self._diffs: dict[Hunk, list] = {}

    def _extent(self, text: str, starts: list[int], first: int, count: int) -> Span:
        last = first + count - 1
        return starts[first - 1], starts[last] - 1 if last < len(starts) else len(text)

    def _replaced(self, hunk: Hunk) -> tuple[str, str]:
        removed = self._extent(self.old, self.old_starts, hunk.old_start, hunk.old_count)
        added = self._extent(self.new, self.new_starts, hunk.new_start, hunk.new_count)
        return self.old[removed[0]:removed[1]], self.new[added[0]:added[1]]

    def _line_of(self, pos: int) -> int:
        """The 1-based old line a position is on. A span ends on its last word, never at the start of a line."""
        return bisect_right(self.old_starts, pos)

    def _covering(self, line: int) -> Hunk | None:
        return next((h for h in self.hunks if h.old_count and h.old_start <= line < h.old_start + h.old_count), None)

    def carry(self, spans: list[Span]) -> list[Span | None]:
        self._afford([pos for span in spans for pos in span])
        mapped = [(self._position(start, False), self._position(end, True)) for start, end in spans]
        return [(start, end) if end > start else None for start, end in mapped]

    def _afford(self, positions: list[int]) -> None:
        """Spends the budget on the replaced ranges the positions are in, from the top of the file down: a range that
        would take it past the budget is widened instead."""
        used = {h for h in map(self._covering, map(self._line_of, positions)) if h and h.new_count}
        spent = 0
        for hunk in sorted(used, key=lambda h: h.old_start):
            removed, added = self._replaced(hunk)
            cost = len(removed) * len(added)
            if spent + cost > CHAR_DIFF_BUDGET:
                self.widened.add(hunk)
            else:
                spent += cost

    def _position(self, pos: int, is_end: bool) -> int:
        line = self._line_of(pos)
        hunk = self._covering(line)
        if hunk is None:
            shift = sum(h.new_count - h.old_count for h in self.hunks
                        if (h.old_start + h.old_count - 1 if h.old_count else h.old_start) < line)
            return self.new_starts[line + shift - 1] + pos - self.old_starts[line - 1]
        if not hunk.new_count:
            return self.new_starts[hunk.new_start] if hunk.new_start < len(self.new_starts) else len(self.new)
        if hunk in self.widened:
            return self._extent(self.new, self.new_starts, hunk.new_start, hunk.new_count)[1 if is_end else 0]
        removed, added = self._replaced(hunk)
        if self._differ is None:
            self._differ = differ()
        if hunk not in self._diffs:
            self._diffs[hunk] = self._differ.diff_main(removed, added)
            self._differ.diff_cleanupSemantic(self._diffs[hunk])
        offset = min(pos - self.old_starts[hunk.old_start - 1], len(removed))
        return self.new_starts[hunk.new_start - 1] + self._differ.diff_xIndex(self._diffs[hunk], offset)
