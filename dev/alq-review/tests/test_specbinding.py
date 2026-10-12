"""specbinding.py: the review-round `spec` argument, its shape, its story heading, the PR header, its binding to a
PR, and the spec.md hold."""
import unittest
from datetime import timedelta

from helpers import T0

import ledger
import specbinding
from specbinding import NoSpec, Story

FOLDER, OTHER = "dev/alq-review/specs/019-x", "dev/alq-review/specs/020-y"
VALUE = f"{FOLDER}/spec.md § User Story 2"
ANOTHER_STORY, ANOTHER_FOLDER = f"{FOLDER}/spec.md § User Story 3", f"{OTHER}/spec.md § User Story 2"
# Spec scenario 2: one value per element of the story value's grammar, none of them a story value.
NOT_STORY_VALUES = (FOLDER, f"{FOLDER}/plan.md § User Story 2", f"{FOLDER}/spec.md § US2",
                    f"{FOLDER}/spec.md  § User Story 2", f"{FOLDER}/spec.md §  User Story 2",
                    f"{FOLDER}/spec.md § User  Story 2", f"{FOLDER}/spec.md § user story 2",
                    f"{FOLDER}/spec.md § User Story 02", f"{FOLDER}/spec.md § User Story 0",
                    f"{FOLDER}/spec.md § User Story ٢", f"{FOLDER}/spec.md § User Story 2a", f" {VALUE}", f"{VALUE} ")
FORM ="'<folder>/spec.md § User Story <N>' or null"
BOUND_BLOB, HEAD_BLOB = "a" * 40, "b" * 40
EARLIER, LATER = ledger.stamp(T0), ledger.stamp(T0 + timedelta(minutes=5))


def shown(value):
    return "null" if value is None else f"`{value}`"


def body(*lines):
    return "\n".join(lines)


def header_problem(text, given, bound=False):
    return specbinding.header_problem(text, given, bound=bound)


class Parse(unittest.TestCase):
    def test_a_story_value_gives_its_folder_and_story_number(self):
        self.assertEqual(specbinding.parse(VALUE), Story(FOLDER, 2))
        self.assertEqual(specbinding.parse(f"{FOLDER}/spec.md § User Story 12"), Story(FOLDER, 12))

    def test_none_gives_no_spec(self):
        self.assertEqual(specbinding.parse(None), NoSpec())

    def test_a_value_not_in_the_story_form_is_refused_quoting_it_and_naming_the_form(self):
        for value in NOT_STORY_VALUES + (
                f"{FOLDER}/spec.md", f"{FOLDER}/spec.md § User Story -1", f"{FOLDER}/spec.md § User Story",
                f"{FOLDER}/spec.md User Story 2", f"{FOLDER}/spec.md § User Story ２", f"{FOLDER}/spec.md § User Story 2٢",
                f"{FOLDER}/spec.md § User Story 2", "dev/café/specs/7/spec.md § User Story 2",
                "/spec.md § User Story 2", f"{VALUE}\n", "dev/a b/specs/7/spec.md § User Story 2", "", "   ", "none"):
            with self.subTest(value=value):
                with self.assertRaises(ValueError) as raised:
                    specbinding.parse(value)
                self.assertIn(repr(value), str(raised.exception))
                self.assertIn(FORM, str(raised.exception))

    def test_any_type_but_a_string_or_none_is_refused_naming_the_form(self):
        for value in (19, 1.5, [VALUE], {"spec": VALUE}, Story(FOLDER, 2)):
            with self.subTest(value=value):
                with self.assertRaises(ValueError) as raised:
                    specbinding.parse(value)
                self.assertIn(FORM, str(raised.exception))

    def test_a_folder_that_breaks_a_shape_rule_still_parses_for_the_shape_step_to_refuse(self):
        for folder in ("/dev/specs/x", "dev/../specs/x", "dev/plans/x", f"{FOLDER}/"):
            with self.subTest(folder=folder):
                self.assertEqual(specbinding.parse(f"{folder}/spec.md § User Story 1"), Story(folder, 1))

    def test_a_story_renders_back_to_the_value_it_parses_from(self):
        for value in (VALUE, f"{OTHER}/spec.md § User Story 10"):
            with self.subTest(value=value):
                story = specbinding.parse(value)
                self.assertEqual(specbinding.story_value(story), value)
                self.assertEqual(specbinding.parse(specbinding.story_value(story)), story)


class ShapeProblem(unittest.TestCase):
    def test_a_relative_folder_under_specs_has_no_problem(self):
        self.assertIsNone(specbinding.shape_problem(FOLDER))

    def test_each_broken_rule_is_named(self):
        cases = {"/dev/alq-review/specs/019-x": "relative",
                 "dev/alq-review/../specs/019-x": "..",
                 "dev/alq-review/plans/019-x": "specs"}
        texts = {}
        for folder, rule in cases.items():
            with self.subTest(folder=folder):
                texts[folder] = specbinding.shape_problem(folder)
                self.assertIsNotNone(texts[folder])
                self.assertIn(rule, texts[folder])
        self.assertEqual(len(set(texts.values())), len(cases), "each rule has its own text")

    def test_a_folder_has_one_spelling(self):
        """git names the folder one way, and the binding compares strings: any other spelling of it would be
        refused later as a missing spec.md or as a different spec."""
        for folder in (f"{FOLDER}/", f"./{FOLDER}", FOLDER.replace("/", "//", 1), f"{FOLDER}/."):
            with self.subTest(folder=folder):
                self.assertIn(f"write it as {FOLDER}", specbinding.shape_problem(folder) or "")


class HeadingProblem(unittest.TestCase):
    def test_a_line_starting_the_story_heading_is_the_story(self):
        for heading in ("### User Story 1 - Sign in (Priority: P1)", "### User Story 1: Sign in", "### User Story 1",
                        "### User Story 1.", "### User Story 1 "):
            with self.subTest(heading=heading):
                self.assertIsNone(specbinding.heading_problem(f"# Spec\n\n{heading}\n\nBody.\n", 1))

    def test_the_heading_may_be_the_last_line_with_no_newline(self):
        self.assertIsNone(specbinding.heading_problem("# Spec\n\n### User Story 1", 1))

    def test_a_heading_in_a_fenced_code_block_counts(self):
        """The check is textual: the gate does not parse Markdown."""
        self.assertIsNone(specbinding.heading_problem("# Spec\n\n```\n### User Story 1 - x\n```\n", 1))

    def test_a_two_digit_story_is_its_own_number(self):
        self.assertIsNone(specbinding.heading_problem("### User Story 12 - Reset (Priority: P3)\n", 12))

    def test_no_line_starting_the_story_heading_is_refused_naming_the_heading(self):
        for spec_md in ("", "# Spec\n", "### User Story 12 - Reset\n", "### User Story 10\n", "### User Story 1x\n",
                        "### User Story 2 - Other\n", "#### User Story 1\n", "## User Story 1\n",
                        " ### User Story 1\n", "See ### User Story 1\n", "### user story 1\n", "### User Story  1\n",
                        "### User Story 01\n"):
            with self.subTest(spec_md=spec_md):
                self.assertIn("`### User Story 1`", specbinding.heading_problem(spec_md, 1) or "")


class HeaderProblem(unittest.TestCase):
    STORY = Story(FOLDER, 2)

    def test_a_first_implements_line_that_names_the_story_agrees(self):
        for text in (body(f"Implements: {VALUE}"), body("Summary", "", f"Implements: {VALUE}", "", "More.")):
            with self.subTest(text=text):
                self.assertIsNone(header_problem(text, self.STORY))

    def test_the_value_ends_at_each_line_end_on_its_own(self):
        for text in (f"Implements: {VALUE}\nMore.", f"Implements: {VALUE}\r\nMore.", f"Summary\nImplements: {VALUE}"):
            with self.subTest(text=text):
                self.assertIsNone(header_problem(text, self.STORY))

    def test_a_line_with_anything_before_implements_is_not_the_implements_line(self):
        for line in (f" Implements: {VALUE}", f"See Implements: {VALUE}"):
            with self.subTest(line=line):
                self.assertIsNone(header_problem(body("Summary", line), NoSpec()))

    def test_a_value_not_read_in_its_one_spelling_is_refused_quoting_the_line_and_naming_the_form(self):
        lines = (f"Implements:{VALUE}", f"Implements:  {VALUE}", f"Implements: {VALUE} ", f"Implements: {VALUE}\t",
                 f"Implements: {VALUE}\rMore.", f"Implements: {FOLDER}/spec.md  § User Story 2")
        for given in (self.STORY, NoSpec()):
            for line in lines:
                with self.subTest(given=given, line=line):
                    text = header_problem(body("Summary", line, "More."), given) or ""
                    self.assertIn(f"`{line}`", text)
                    self.assertIn("`Implements: <folder>/spec.md § User Story <N>`", text)

    def test_a_bare_carriage_return_ending_the_body_is_inside_the_line(self):
        line = f"Implements: {VALUE}\r"
        text = header_problem(body("Summary", line), self.STORY) or ""
        self.assertIn(f"`{line}`", text)
        self.assertIn("`Implements: <folder>/spec.md § User Story <N>`", text)

    def test_no_implements_line_on_no_spec_agrees(self):
        for text in ("", body("Summary", "", "Fixes the thing.")):
            with self.subTest(text=text):
                self.assertIsNone(header_problem(text, NoSpec()))

    def test_only_the_first_implements_line_counts(self):
        self.assertIsNone(header_problem(body(f"Implements: {VALUE}", f"Implements: {ANOTHER_STORY}"), self.STORY))
        text = header_problem(body(f"Implements: {ANOTHER_STORY}", f"Implements: {VALUE}"), self.STORY)
        self.assertIn(f"`{ANOTHER_STORY}`", text or "")

    def test_a_line_whose_value_is_not_a_story_value_is_refused_quoting_the_line_and_naming_the_form(self):
        for given in (self.STORY, NoSpec()):
            for line in ("Implements:", "Implements: null", *(f"Implements: {value}" for value in NOT_STORY_VALUES)):
                with self.subTest(given=given, line=line):
                    text = header_problem(body("Summary", line), given) or ""
                    self.assertIn(f"`{line}`", text)
                    self.assertIn("`Implements: <folder>/spec.md § User Story <N>`", text)
                    self.assertIn("Next step:", text)

    def test_on_an_unbound_pr_a_line_naming_another_folder_or_story_is_refused_naming_both_ways_out(self):
        for named in (ANOTHER_STORY, ANOTHER_FOLDER):
            with self.subTest(named=named):
                text = header_problem(body(f"Implements: {named}"), self.STORY) or ""
                self.assertIn(f"names `{named}`", text)
                self.assertIn(f"launch with spec `{named}`", text)
                self.assertIn(f"edit the line to `Implements: {VALUE}`", text)

    def test_on_a_bound_pr_a_line_naming_another_story_is_refused_naming_only_the_line_edit(self):
        text = header_problem(body(f"Implements: {ANOTHER_STORY}"), self.STORY, bound=True) or ""
        self.assertIn(f"names `{ANOTHER_STORY}`", text)
        self.assertIn(f"Next step: edit the line to `Implements: {VALUE}`.", text)
        self.assertNotIn("launch with spec", text)

    def test_on_a_pr_bound_to_null_an_implements_line_is_refused_naming_only_its_removal(self):
        for line in (f"Implements: {VALUE}", f"Implements: {FOLDER}"):
            with self.subTest(line=line):
                text = header_problem(body("Summary", line), NoSpec(), bound=True) or ""
                self.assertIn(f"`{line}`", text)
                self.assertIn("Next step: remove the line from the PR body.", text)
                self.assertNotIn("launch with spec", text)

    def test_the_last_line_of_the_body_is_read_with_nothing_stripped(self):
        line = f"Implements: {VALUE} "
        self.assertIn(f"`{line}`", header_problem(body("Summary", line), self.STORY) or "")

    def test_a_story_with_no_implements_line_is_refused_naming_the_line_to_add(self):
        for text in ("", body("Summary", "", "Fixes the thing."), body(f"implements: {VALUE}"),
                     body(f" Implements: {VALUE}"), body(f"> Implements: {VALUE}")):
            with self.subTest(text=text):
                refusal = header_problem(text, self.STORY) or ""
                self.assertIn(f"Next step: add the line `Implements: {VALUE}`", refusal)

    def test_on_an_unbound_pr_an_implements_line_on_no_spec_is_refused_naming_both_ways_out(self):
        text = header_problem(body("Summary", f"Implements: {VALUE}"), NoSpec()) or ""
        self.assertIn(f"`Implements: {VALUE}`", text)
        self.assertIn(f"launch with spec `{VALUE}`", text)
        self.assertIn("remove the line from the PR body", text)

    def test_each_refusal_has_its_own_text(self):
        texts = {header_problem(body(f"Implements: {FOLDER}"), self.STORY),
                 header_problem(body(f"Implements: {ANOTHER_STORY}"), self.STORY),
                 header_problem("", self.STORY),
                 header_problem(body(f"Implements: {VALUE}"), NoSpec())}
        self.assertEqual(len(texts), 4)


class Bind(unittest.TestCase):
    def test_the_same_value_binds(self):
        for value in (VALUE, None):
            with self.subTest(value=value):
                self.assertIsNone(specbinding.bind(value, value))

    def test_a_different_value_is_refused_naming_both_and_that_the_binding_never_changes(self):
        for recorded, given in ((VALUE, ANOTHER_STORY), (VALUE, ANOTHER_FOLDER), (VALUE, None), (None, VALUE)):
            with self.subTest(recorded=recorded, given=given):
                text = specbinding.bind(recorded, given)
                self.assertIn(f"This PR is bound to spec {shown(recorded)}, and this launch gives spec {shown(given)}.",
                              text)
                self.assertIn("never changes", text)
                self.assertTrue(text.endswith(f"Next step: launch with spec {shown(recorded)}."), text)


class TextStep(unittest.TestCase):
    def test_equal_blobs_are_the_same(self):
        for held_at, unlocked_at in ((None, None), (EARLIER, LATER), (LATER, EARLIER)):
            with self.subTest(held_at=held_at, unlocked_at=unlocked_at):
                self.assertEqual(specbinding.text_step(BOUND_BLOB, BOUND_BLOB, held_at, unlocked_at), "same")

    def test_a_changed_spec_md_with_no_hold_is_held(self):
        for unlocked_at in (None, EARLIER):
            with self.subTest(unlocked_at=unlocked_at):
                self.assertEqual(specbinding.text_step(BOUND_BLOB, HEAD_BLOB, None, unlocked_at), "hold")

    def test_a_hold_not_unlocked_since_stays_held(self):
        for held_at, unlocked_at in ((EARLIER, None), (EARLIER, EARLIER), (LATER, EARLIER)):
            with self.subTest(held_at=held_at, unlocked_at=unlocked_at):
                self.assertEqual(specbinding.text_step(BOUND_BLOB, HEAD_BLOB, held_at, unlocked_at), "hold")

    def test_a_hold_unlocked_since_binds_heads_text(self):
        self.assertEqual(specbinding.text_step(BOUND_BLOB, HEAD_BLOB, EARLIER, LATER), "bind")


if __name__ == "__main__":
    unittest.main()
