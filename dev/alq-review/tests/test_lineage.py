import copy
import re
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

import helpers  # noqa: F401  (puts scripts/ on the path)

import claimcheck
import lineage
import worktree
from worktree import Hunk


def hunk(old_start, old_count, new_start, new_count, removed=(), added=()):
    return Hunk("f.md", old_start, old_count, new_start, new_count, tuple(removed), tuple(added), "")


def carried(old, new, hunks, *spans):
    return lineage.carry(list(spans), old, new, hunks)


def text_of(new, span):
    return new[span[0]:span[1]] if span else None


class SpanOfTest(unittest.TestCase):
    def test_finds_a_sentence_that_wraps_across_lines(self):
        text = "Intro\nThe validator rejects an empty list,\nand it logs the reason.\nOther.\n"
        span = lineage.Words(text).span(2, "The validator rejects an empty list, and it logs the reason.")
        self.assertEqual(text[span[0]:span[1]], "The validator rejects an empty list,\nand it logs the reason.")

    def test_skips_the_comment_marks_the_claim_id_drops(self):
        text = "# The validator rejects\n# an empty list.\n"
        span = lineage.Words(text).span(1, "The validator rejects\n# an empty list.")
        self.assertEqual(text[span[0]:span[1]], "The validator rejects\n# an empty list.")

    def test_begins_at_the_claims_line_not_at_an_earlier_copy(self):
        text = "Same words.\nother\nSame words.\n"
        span = lineage.Words(text).span(3, "Same words.")
        self.assertEqual(span, (18, 29))

    def test_a_quote_that_starts_in_the_middle_of_its_line(self):
        text = "Intro. The claim is here.\n"
        span = lineage.Words(text).span(1, "The claim is here.")
        self.assertEqual(text[span[0]:span[1]], "The claim is here.")

    def test_a_quote_that_is_part_of_a_word_is_found_where_it_stands(self):
        text = "import x\ndef test_an_empty_list_is_rejected():\n    pass\n"
        span = lineage.Words(text).span(2, "test_an_empty_list_is_rejected")
        self.assertEqual(text[span[0]:span[1]], "test_an_empty_list_is_rejected")

    def test_whole_words_win_over_an_earlier_match_inside_a_word(self):
        text = "This is safe.\n"
        span = lineage.Words(text).span(1, "is safe.")
        self.assertEqual(text[span[0]:span[1]], "is safe.")
        self.assertEqual(span[0], 5)

    def test_raises_when_the_words_are_not_there(self):
        with self.assertRaises(lineage.SpanNotFound):
            lineage.Words("Intro\nSomething else.\n").span(1, "The validator rejects an empty list.")

    def test_raises_when_the_words_are_only_before_its_line(self):
        with self.assertRaises(lineage.SpanNotFound):
            lineage.Words("The claim.\nOther.\n").span(2, "The claim.")


class NumberingTest(unittest.TestCase):
    """A line is what git numbers: the text between two "\\n"s and nothing else."""

    def test_a_line_ends_at_a_newline_only(self):
        inside = "a\u2028b\x0cc\x85d\re\x0bf\x1cg\x1dh\x1ei\u2029j"
        self.assertEqual(lineage.lines(f"{inside}\nnext\n"), [inside, "next"])

    def test_the_final_newline_ends_the_last_line_and_starts_none(self):
        self.assertEqual((lineage.lines("a\nb\n"), lineage.lines("a\nb"), lineage.lines("a\n\n")),
                         (["a", "b"], ["a", "b"], ["a", ""]))

    def test_no_text_has_no_line(self):
        self.assertEqual(lineage.lines(""), [])


class LinesTest(unittest.TestCase):
    """A range of lines is a span from the start of its first line to the end of its last, so `carry` maps it."""
    text = "aaa\nbbb\nccc\nddd\n"

    def test_lines_make_a_span_and_a_span_gives_its_lines_back(self):
        span = lineage.line_span(self.text, 2, 2)
        self.assertEqual(self.text[span[0]:span[1]], "bbb\nccc")
        self.assertEqual(lineage.lines_of(self.text, span), (2, 2))

    def test_the_last_line_of_a_file_without_a_final_newline(self):
        span = lineage.line_span("aaa\nbbb", 2, 1)
        self.assertEqual(("aaa\nbbb")[span[0]:span[1]], "bbb")

    def test_a_pure_insertion_is_the_line_it_follows(self):
        span = lineage.line_span(self.text, 2, 0)
        self.assertEqual(self.text[span[0]:span[1]], "bbb")

    def test_a_range_past_the_text_is_held_to_its_lines(self):
        span = lineage.line_span(self.text, 4, 9)
        self.assertEqual(self.text[span[0]:span[1]], "ddd")


class CarryTest(unittest.TestCase):
    def test_a_span_below_an_insertion_moves_down_by_its_lines(self):
        old, new = "aaa\nbbb\nccc\nddd\n", "xxx\naaa\nbbb\nccc\nddd\n"
        got = carried(old, new, [hunk(0, 0, 1, 1, (), ("xxx",))], (8, 11))
        self.assertEqual(text_of(new, got[0]), "ccc")

    def test_a_span_below_a_deletion_moves_up_by_its_lines(self):
        old, new = "aaa\nbbb\nccc\nddd\n", "bbb\nccc\nddd\n"
        got = carried(old, new, [hunk(1, 1, 0, 0, ("aaa",), ())], (8, 11))
        self.assertEqual(text_of(new, got[0]), "ccc")

    def test_a_span_above_every_hunk_does_not_move(self):
        old, new = "aaa\nbbb\nccc\n", "aaa\nbbb\nccc\nddd\n"
        got = carried(old, new, [hunk(3, 0, 4, 1, (), ("ddd",))], (4, 7))
        self.assertEqual(got, [(4, 7)])

    def test_a_span_keeps_its_column_when_only_other_lines_changed(self):
        old, new = "aaa\nbbb ccc\n", "zzzzzz\nbbb ccc\n"
        got = carried(old, new, [hunk(1, 1, 1, 1, ("aaa",), ("zzzzzz",))], (8, 11))
        self.assertEqual(text_of(new, got[0]), "ccc")

    def test_several_hunks_above_add_up(self):
        old, new = "a\nb\nc\nd\ne\nf\n", "a\nb\nb1\nc\nd\nf\n"
        hunks = [hunk(2, 0, 3, 1, (), ("b1",)), hunk(5, 1, 5, 0, ("e",), ())]
        got = carried(old, new, hunks, (10, 11))
        self.assertEqual(text_of(new, got[0]), "f")

    def test_an_offset_inside_a_replaced_range_follows_the_character_diff(self):
        old, new = "One two three four.\n", "One two THREE four.\n"
        h = [hunk(1, 1, 1, 1, ("One two three four.",), ("One two THREE four.",))]
        got = carried(old, new, h, (14, 18), (4, 13))
        self.assertEqual([text_of(new, s) for s in got], ["four", "two THREE"])

    def test_a_span_that_starts_outside_a_hunk_and_ends_inside_it(self):
        old, new = "Alpha beta\nGamma delta\n", "Alpha beta\nGamma DELTA\n"
        h = [hunk(2, 1, 2, 1, ("Gamma delta",), ("Gamma DELTA",))]
        got = carried(old, new, h, (6, 22))
        self.assertEqual(text_of(new, got[0]), "beta\nGamma DELTA")

    def test_an_offset_inside_a_pure_deletion_maps_to_where_the_text_was(self):
        old, new = "aaa\nbbb\nccc\n", "aaa\nccc\n"
        got = carried(old, new, [hunk(2, 1, 1, 0, ("bbb",), ())], (0, 7))
        self.assertEqual(got, [(0, 4)])

    def test_a_span_whose_two_ends_meet_is_gone(self):
        old, new = "aaa\nbbb\nccc\n", "aaa\nccc\n"
        got = carried(old, new, [hunk(2, 1, 1, 0, ("bbb",), ())], (4, 7))
        self.assertEqual(got, [None])

    def test_no_hunks_leaves_every_span_as_it_was(self):
        self.assertEqual(carried("aaa\nbbb\n", "aaa\nbbb\n", [], (0, 3), (4, 7)), [(0, 3), (4, 7)])

    def test_a_span_in_a_range_replaced_past_the_budget_widens_to_the_whole_replacement(self):
        old, new = "Intro\nOne two three four.\nOutro\n", "Intro\nOne two THREE four.\nOutro\n"
        h = [hunk(2, 1, 2, 1, ("One two three four.",), ("One two THREE four.",))]
        with mock.patch.object(lineage, "CHAR_DIFF_BUDGET", 10):
            got = carried(old, new, h, (20, 24), (0, 5))
        self.assertEqual([text_of(new, s) for s in got], ["One two THREE four.", "Intro"])

    def test_a_span_that_ends_in_a_widened_range_widens_only_that_end(self):
        old, new = "Alpha beta\nGamma delta\n", "Alpha beta\nGamma DELTA\n"
        h = [hunk(2, 1, 2, 1, ("Gamma delta",), ("Gamma DELTA",))]
        with mock.patch.object(lineage, "CHAR_DIFF_BUDGET", 10):
            got = carried(old, new, h, (6, 14))
        self.assertEqual(text_of(new, got[0]), "beta\nGamma DELTA")

    def test_ranges_are_diffed_in_order_until_the_budget_is_spent_and_the_rest_widen(self):
        old, new = "aaaa bbbb\ncccc dddd\n", "aaaa BBBB\ncccc DDDD\n"
        h = [hunk(1, 1, 1, 1, ("aaaa bbbb",), ("aaaa BBBB",)), hunk(2, 1, 2, 1, ("cccc dddd",), ("cccc DDDD",))]
        with mock.patch.object(lineage, "CHAR_DIFF_BUDGET", 100):  # one range costs 81
            got = carried(old, new, h, (5, 9), (15, 19))
        self.assertEqual([text_of(new, s) for s in got], ["BBBB", "cccc DDDD"])

    def test_a_replaced_range_no_span_touches_costs_nothing(self):
        old, new = "aaa\nOne two three four.\n", "aaa\nOne two THREE four.\n"
        h = [hunk(2, 1, 2, 1, ("One two three four.",), ("One two THREE four.",))]
        with mock.patch.object(lineage, "CHAR_DIFF_BUDGET", 10):
            self.assertEqual(carried(old, new, h, (0, 3)), [(0, 3)])


class SucceedTest(unittest.TestCase):
    """Which lineage each claim of a new version belongs to. Hunks come from git, as the gates get them."""

    @classmethod
    def setUpClass(cls):
        cls._dir = tempfile.TemporaryDirectory()
        cls.root = cls._dir.name
        subprocess.run(["git", "init", "-q", cls.root], check=True)

    @classmethod
    def tearDownClass(cls):
        cls._dir.cleanup()

    def claim(self, text, quote):
        found = re.search(r"\s+".join(map(re.escape, quote.split())), text)
        line = text[:found.start()].count("\n") + 1
        return {"id": claimcheck.claim_id("f.md", quote), "line": line, "quote": quote}

    def lineage(self, lid, text, quote):
        start, end = lineage.Words(text).span(self.claim(text, quote)["line"], quote)
        return {"id": lid, "state": "open", "ended": None, "chain": [],
                "places": [{"start": start, "end": end, "claim": claimcheck.claim_id("f.md", quote)}]}

    def succeed(self, lineages, old, new, claims, counts=None, ref="check-2"):
        counts = counts or {}
        return lineage.succeed(lineages, old, new, worktree.text_hunks(self.root, old, new), claims,
                               lambda found: counts.get(found["id"], 1), ref)

    def by_id(self, lineages):
        return {found["id"]: found for found in lineages}

    def words_at(self, new, found):
        return [new[p["start"]:p["end"]] for p in found["places"]]

    def test_a_sentence_split_in_place_gives_both_halves_the_lineage(self):
        old = "Intro.\nThe tool is fast and it is safe.\nOutro.\n"
        new = "Intro.\nThe tool is fast.\nIt is safe.\nOutro.\n"
        halves = [self.claim(new, "The tool is fast."), self.claim(new, "It is safe.")]
        lineages, inherited = self.succeed([self.lineage("L1", old, "The tool is fast and it is safe.")], old, new,
                                           halves)
        self.assertEqual(inherited, {halves[0]["id"]: ["L1"], halves[1]["id"]: ["L1"]})
        self.assertEqual(self.words_at(new, lineages[0]), ["The tool is fast.", "It is safe."])
        self.assertEqual(lineages[0]["state"], "open")

    def test_two_sentences_merged_go_on_as_the_lineage_with_the_higher_count(self):
        old = "Intro.\nThe tool is fast.\nIt is safe.\nOutro.\n"
        new = "Intro.\nThe tool is fast and it is safe.\nOutro.\n"
        merged = self.claim(new, "The tool is fast and it is safe.")
        before = [self.lineage("L1", old, "The tool is fast."), self.lineage("L2", old, "It is safe.")]
        lineages, inherited = self.succeed(before, old, new, [merged], counts={"L1": 1, "L2": 2})
        found = self.by_id(lineages)
        self.assertEqual(inherited, {merged["id"]: ["L2"]})
        self.assertEqual((found["L2"]["state"], found["L1"]["state"]), ("open", "ended"))
        self.assertEqual(found["L1"]["ended"], {"by": "merged", "ref": "check-2", "into": "L2"})

    def test_a_lineage_merged_away_hands_its_words_no_claim_was_read_in_to_the_one_that_goes_on(self):
        old = "The tool is fast.\nIt is safe.\nSomewhere else, the far half.\n"
        new = "The tool is fast and it is safe.\nSomewhere else, the far half.\n"
        merged = self.claim(new, "The tool is fast and it is safe.")
        split = self.lineage("L2", old, "It is safe.")
        split["places"] += self.lineage("L2", old, "Somewhere else, the far half.")["places"]
        lineages, _ = self.succeed([self.lineage("L1", old, "The tool is fast."), split], old, new, [merged],
                                   counts={"L1": 2, "L2": 1})
        found = self.by_id(lineages)
        self.assertEqual(found["L2"]["state"], "ended")
        self.assertEqual(self.words_at(new, found["L1"]),
                         ["The tool is fast and it is safe.", "Somewhere else, the far half."])

    def test_equal_counts_go_on_as_the_lineage_with_the_smaller_id(self):
        old = "The tool is fast.\nIt is safe.\n"
        new = "The tool is fast and it is safe.\n"
        merged = self.claim(new, "The tool is fast and it is safe.")
        before = [self.lineage("L9", old, "The tool is fast."), self.lineage("L3", old, "It is safe.")]
        lineages, inherited = self.succeed(before, old, new, [merged], counts={"L3": 2, "L9": 2})
        self.assertEqual(inherited, {merged["id"]: ["L3"]})
        self.assertEqual(self.by_id(lineages)["L9"]["ended"]["into"], "L3")

    def test_words_deleted_with_nothing_in_their_place_end_the_lineage(self):
        old = "Intro.\nThe tool is fast.\nOutro.\n"
        new = "Intro.\nOutro.\n"
        lineages, inherited = self.succeed([self.lineage("L1", old, "The tool is fast.")], old, new, [])
        self.assertEqual(inherited, {})
        self.assertEqual((lineages[0]["state"], lineages[0]["ended"]),
                         ("ended", {"by": "deleted", "ref": "check-2", "into": None}))

    def test_words_moved_unchanged_keep_the_lineage_by_their_id(self):
        old = "Intro.\nThe tool is fast.\nMiddle.\nOutro.\n"
        new = "Intro.\nMiddle.\nOutro.\nThe tool is fast.\n"
        moved = self.claim(new, "The tool is fast.")
        lineages, inherited = self.succeed([self.lineage("L1", old, "The tool is fast.")], old, new, [moved])
        self.assertEqual(inherited, {moved["id"]: ["L1"]})
        self.assertEqual((lineages[0]["state"], self.words_at(new, lineages[0])), ("open", ["The tool is fast."]))

    def test_words_moved_unchanged_keep_the_lineage_with_no_claim_read(self):
        old = "Intro.\nThe tool is fast.\nMiddle.\nOutro.\n"
        new = "Intro.\nMiddle.\nOutro.\nThe tool is fast.\n"
        lineages, inherited = self.succeed([self.lineage("L1", old, "The tool is fast.")], old, new, [])
        self.assertEqual(inherited, {})
        self.assertEqual((lineages[0]["state"], self.words_at(new, lineages[0])), ("open", ["The tool is fast."]))

    def test_the_lineages_first_words_found_elsewhere_keep_it_with_no_claim_read(self):
        first, second = "The tool is fast.", "The tool is quick."
        old, new = f"Intro.\n{second}\nMiddle.\n", f"Intro.\nMiddle.\n{first}\n"
        held = dict(self.lineage(claimcheck.claim_id("f.md", first), old, second),
                    chain=[{"claim": claimcheck.claim_id("f.md", first), "words": first}])
        lineages, inherited = self.succeed([held], old, new, [])
        self.assertEqual((lineages[0]["state"], self.words_at(new, lineages[0])), ("open", [first]))

    def test_words_deleted_while_other_words_stay_end_the_lineage_with_no_claim_read(self):
        old, new = "Intro.\nThe tool is fast.\nOutro.\n", "Intro.\nOutro.\n"
        lineages, _ = self.succeed([self.lineage("L1", old, "The tool is fast.")], old, new, [])
        self.assertEqual((lineages[0]["state"], lineages[0]["ended"]["by"]), ("ended", "deleted"))

    def test_only_the_claims_read_are_answered_for(self):
        old = "Intro.\nThe tool is fast.\nMiddle.\n"
        new = "Intro.\nMiddle.\nThe tool is fast.\n"
        outside = self.claim(new, "Middle.")
        _, inherited = self.succeed([self.lineage("L1", old, "The tool is fast.")], old, new, [outside])
        self.assertEqual(inherited, {})

    def test_a_lineage_in_a_range_replaced_past_the_budget_is_a_failed_check_not_a_guess(self):  # X2
        old, new = "Intro.\nOne two three four.\n", "Intro.\nOne two THREE four.\n"
        with mock.patch.object(lineage, "CHAR_DIFF_BUDGET", 10):
            with self.assertRaises(lineage.BudgetExceeded) as raised:
                self.succeed([self.lineage("L1", old, "three")], old, new, [self.claim(new, "THREE")])
        self.assertIn("split", str(raised.exception))

    def test_the_budget_is_spent_over_every_lineage_of_the_file(self):  # X2
        old = "aaaa bbbb\nkeep\ncccc dddd\n"
        new = "aaaa BBBB\nkeep\ncccc DDDD\n"
        both = [self.lineage("L1", old, "bbbb"), self.lineage("L2", old, "dddd")]
        with mock.patch.object(lineage, "CHAR_DIFF_BUDGET", 100):  # one range costs 81, both 162
            self.succeed(both[:1], old, new, [])
            with self.assertRaises(lineage.BudgetExceeded):
                self.succeed(both, old, new, [])

    def test_a_long_file_with_many_claims_is_followed_in_a_time_a_scan_of_the_file_per_claim_could_not_meet(self):
        # The scan per claim this replaced took 19.8 s on this text.
        lines = [f"Line {i} of the guide says the validator rejects an empty list." for i in range(1000)]
        text = "\n".join(lines) + "\n"
        claims = [{"id": f"c{i}", "line": i * 100 + 1, "quote": lines[i * 100]} for i in range(10)]
        before = [self.lineage(f"L{i}", text, claim["quote"]) for i, claim in enumerate(claims)]
        started = time.monotonic()
        lineages, inherited = self.succeed(before, text, text, claims)
        self.assertLess(time.monotonic() - started, 3)
        self.assertEqual(inherited, {f"c{i}": [f"L{i}"] for i in range(10)})
        self.assertEqual({found["state"] for found in lineages}, {"open"})

    def test_one_hunk_over_two_lineages_continues_both_each_by_its_own_place(self):
        old = "Alpha is fast.\nBeta is slow.\n"
        new = "Alpha is very fast.\nBeta is quite slow.\n"
        first, second = self.claim(new, "Alpha is very fast."), self.claim(new, "Beta is quite slow.")
        before = [self.lineage("L1", old, "Alpha is fast."), self.lineage("L2", old, "Beta is slow.")]
        lineages, inherited = self.succeed(before, old, new, [first, second])
        self.assertEqual(inherited, {first["id"]: ["L1"], second["id"]: ["L2"]})
        found = self.by_id(lineages)
        self.assertEqual(self.words_at(new, found["L1"]), ["Alpha is very fast."])
        self.assertEqual(self.words_at(new, found["L2"]), ["Beta is quite slow."])

    def test_words_moved_and_reworded_in_one_step_are_a_new_claim(self):
        old = "Intro.\nThe tool is fast.\nMiddle.\nOutro.\n"
        new = "Intro.\nMiddle.\nOutro.\nThe tool is quick.\n"
        reworded = self.claim(new, "The tool is quick.")
        lineages, inherited = self.succeed([self.lineage("L1", old, "The tool is fast.")], old, new, [reworded])
        self.assertEqual(inherited, {})
        self.assertEqual((lineages[0]["state"], lineages[0]["ended"]["by"]), ("ended", "deleted"))

    def test_a_reflow_with_the_words_unchanged_keeps_the_lineage(self):
        old = "Intro.\nThe tool is fast and it is\nsafe to use.\nOutro.\n"
        new = "Intro.\nThe tool is fast\nand it is safe to use.\nOutro.\n"
        same = self.claim(new, "The tool is fast and it is safe to use.")
        quote = "The tool is fast and it is safe to use."
        lineages, inherited = self.succeed([self.lineage("L1", old, quote)], old, new, [same])
        self.assertEqual(inherited, {same["id"]: ["L1"]})
        self.assertEqual(lineages[0]["state"], "open")

    def test_a_split_whose_second_half_lands_elsewhere_keeps_only_the_first_half(self):
        old = "Intro.\nThe tool is fast and it is safe.\nOutro.\n"
        new = "Intro.\nThe tool is fast.\nOutro.\nIt is safe.\n"
        first, far = self.claim(new, "The tool is fast."), self.claim(new, "It is safe.")
        lineages, inherited = self.succeed([self.lineage("L1", old, "The tool is fast and it is safe.")], old, new,
                                           [first, far])
        self.assertEqual(inherited, {first["id"]: ["L1"]})
        self.assertEqual(self.words_at(new, lineages[0]), ["The tool is fast."])

    def test_a_place_carried_to_text_no_claim_was_read_in_stays_open(self):
        old, new = "Intro.\nThe tool is fast.\n", "The tool is quick.\n"
        lineages, inherited = self.succeed([self.lineage("L1", old, "The tool is fast.")], old, new, [])
        self.assertEqual(inherited, {})
        self.assertEqual(lineages[0]["state"], "open")
        self.assertEqual(len(lineages[0]["places"]), 1)

    def test_words_that_come_back_as_the_lineages_first_words_rejoin_it(self):
        old = "Intro.\nThe tool is quick.\n"
        new = "Intro.\nOther.\n"
        came_back = {"id": "L1", "line": 2, "quote": "Other."}
        lineages, inherited = self.succeed([self.lineage("L1", old, "The tool is quick.")], old, new, [came_back])
        self.assertEqual(inherited, {"L1": ["L1"]})

    def test_merges_made_one_after_another_all_end_in_the_last_survivor(self):
        text = "aaa bbb ccc ddd\n"

        def holding(lid, start, end):
            return {"id": lid, "state": "open", "ended": None, "chain": [],
                    "places": [{"start": start, "end": end, "claim": lid}]}
        before = [holding("L1", 0, 3), holding("L2", 4, 11), holding("L3", 12, 15)]
        first, second = {"id": "X", "line": 1, "quote": "aaa bbb"}, {"id": "Y", "line": 1, "quote": "ccc ddd"}
        lineages, inherited = self.succeed(before, text, text, [first, second], counts={"L1": 1, "L2": 2, "L3": 3})
        found = self.by_id(lineages)
        self.assertEqual(inherited, {"X": ["L3"], "Y": ["L3"]})
        self.assertEqual([(lid, found[lid]["ended"]["into"]) for lid in ("L1", "L2")], [("L1", "L3"), ("L2", "L3")])
        self.assertEqual(found["L3"]["state"], "open")

    def test_the_lineages_it_is_given_are_not_changed(self):
        old, new = "Intro.\nThe tool is fast.\n", "Intro.\n"
        given = [self.lineage("L1", old, "The tool is fast.")]
        snapshot = copy.deepcopy(given)
        self.succeed(given, old, new, [])
        self.assertEqual(given, snapshot)


class DifferTest(unittest.TestCase):
    def test_gives_a_differ_with_the_timeout_off(self):
        self.assertEqual(lineage.differ().Diff_Timeout, 0)

    def test_a_missing_library_is_unavailable_and_names_the_install_step(self):
        with mock.patch.dict(sys.modules, {"diff_match_patch": None}):
            with self.assertRaises(lineage.Unavailable) as raised:
                lineage.differ()
        message = str(raised.exception)
        self.assertIn("diff-match-patch", message)
        self.assertIn("could not run", message)


class InstallStepTest(unittest.TestCase):
    def test_pip_into_an_interpreter_that_can_take_it(self):
        self.assertEqual(lineage.install_step("/usr/bin/python3", in_venv=False, externally_managed=False),
                         "/usr/bin/python3 -m pip install diff-match-patch")

    def test_pip_into_a_venv_even_when_the_base_python_is_managed(self):
        self.assertEqual(lineage.install_step("/w/venv/bin/python", in_venv=True, externally_managed=True),
                         "/w/venv/bin/python -m pip install diff-match-patch")

    def test_the_os_package_for_a_managed_interpreter_outside_a_venv(self):
        step = lineage.install_step("/usr/bin/python3", in_venv=False, externally_managed=True)
        self.assertIn("python3-diff-match-patch", step)
        self.assertNotIn("-m pip install", step)


if __name__ == "__main__":
    unittest.main()
