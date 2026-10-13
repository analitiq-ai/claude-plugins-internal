"""specbinding.py: the review-round `spec` and `story` arguments, the folder's shape, the PR's binding, the story
heading, and the spec.md hold."""
import unittest
from datetime import timedelta

from helpers import T0

import ledger
import specbinding
from specbinding import Folder, NoSpec

FOLDER, OTHER = "dev/alq-review/specs/019-x", "dev/alq-review/specs/020-y"
BOUND_BLOB, HEAD_BLOB = "a" * 40, "b" * 40
EARLIER, LATER = ledger.stamp(T0), ledger.stamp(T0 + timedelta(minutes=5))


def shown(binding):
    return "spec null" if binding == NoSpec() else f"spec `{binding.path}`, story {binding.story}"


class Parse(unittest.TestCase):
    def test_a_folder_path_gives_the_path(self):
        self.assertEqual(specbinding.parse(FOLDER), FOLDER)

    def test_none_gives_none(self):
        self.assertIsNone(specbinding.parse(None))

    def test_surrounding_whitespace_is_stripped(self):
        self.assertEqual(specbinding.parse(f"  {FOLDER}\n"), FOLDER)

    def test_an_empty_string_does_not_parse(self):
        for value in ("", "   "):
            with self.subTest(value=value), self.assertRaises(ValueError):
                specbinding.parse(value)

    def test_any_type_but_a_string_or_none_does_not_parse(self):
        for value in (19, 1.5, [FOLDER], {"spec": FOLDER}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                specbinding.parse(value)

    def test_a_word_is_read_as_a_folder_for_the_shape_step_to_refuse(self):
        for value in ("none", "nonesuch/specs/x"):
            with self.subTest(value=value):
                self.assertEqual(specbinding.parse(value), value)


class ParseStory(unittest.TestCase):
    """The spec's arguments table, the `story` half of it: `parse_story` runs once the folder's shape passed."""

    def refusal(self, spec, args):
        with self.assertRaises(ValueError) as raised:
            specbinding.parse_story(spec, args)
        return str(raised.exception)

    def test_a_folder_takes_a_story_of_1_or_more(self):
        for story in (1, 2, 40):
            with self.subTest(story=story):
                self.assertEqual(specbinding.parse_story(FOLDER, {"story": story}), story)

    def test_a_folder_with_no_story_is_refused(self):
        for args in ({}, {"story": None}):
            with self.subTest(args=args):
                self.assertIn("a spec folder needs a story", self.refusal(FOLDER, args))

    def test_a_story_below_1_is_refused(self):
        for story in (0, -1):
            with self.subTest(story=story):
                self.assertIn("the story is 1 or more", self.refusal(FOLDER, {"story": story}))

    def test_a_story_that_is_not_a_json_integer_is_refused(self):
        """A boolean is an int in Python, and not a JSON integer."""
        for story in ("2", 2.5, True, False, 2.0, [2]):
            with self.subTest(story=story):
                self.assertIn("the story is a JSON integer", self.refusal(FOLDER, {"story": story}))

    def test_no_spec_takes_no_story(self):
        self.assertIsNone(specbinding.parse_story(None, {}))

    def test_no_spec_beside_any_story_key_is_refused_whatever_its_form(self):
        """The null rule wins over the story's form: `story: "2"` beside null is refused for being there."""
        for story in (None, 2, "2", 0, True, 2.5):
            with self.subTest(story=story):
                text = self.refusal(None, {"story": story})
                self.assertIn("no spec has no story", text)
                self.assertNotIn("JSON integer", text)
                self.assertNotIn("1 or more", text)


class Bound(unittest.TestCase):
    def test_each_binding_a_pr_can_have(self):
        cases = (({}, None), ({"spec": None, "spec_blob": None}, NoSpec()),
                 ({"spec": FOLDER, "story": 2, "spec_blob": BOUND_BLOB}, Folder(FOLDER, 2)))
        for state, binding in cases:
            with self.subTest(state=state):
                self.assertEqual(specbinding.bound(state), binding)

    def test_a_folder_binding_with_no_story_is_not_read_as_anything(self):
        """No binding the gate makes has this shape, and none made before story existed is taken for one."""
        with self.assertRaises(KeyError):
            specbinding.bound({"spec": FOLDER, "spec_blob": BOUND_BLOB})

    def test_the_story_of_a_null_binding_is_not_read(self):
        self.assertEqual(specbinding.bound({"spec": None, "spec_blob": None, "story": 3}), NoSpec())


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


class Bind(unittest.TestCase):
    def test_the_same_arguments_bind(self):
        for binding in (Folder(FOLDER, 2), NoSpec()):
            with self.subTest(binding=binding):
                self.assertIsNone(specbinding.bind(binding, binding))

    def test_other_arguments_are_refused_naming_both_and_that_the_binding_never_changes(self):
        """The launch to make is the gate's to name, from the binding: bind stops at the fault."""
        for recorded, given in ((Folder(FOLDER, 2), Folder(OTHER, 2)), (Folder(FOLDER, 2), Folder(FOLDER, 3)),
                                (Folder(FOLDER, 2), NoSpec()), (NoSpec(), Folder(FOLDER, 2))):
            with self.subTest(recorded=recorded, given=given):
                text = specbinding.bind(recorded, given)
                self.assertIn(f"This PR is bound to {shown(recorded)}, and this launch gives {shown(given)}.", text)
                self.assertIn("never changes", text)
                self.assertNotIn("Next step", text)


class HasStory(unittest.TestCase):
    def test_the_heading_is_a_line_starting_with_the_story_and_its_number(self):
        for line in ("### User Story 1 - Sign in (Priority: P1)", "### User Story 1: Sign in", "### User Story 1",
                     "### User Story 1\r"):
            with self.subTest(line=line):
                self.assertTrue(specbinding.has_story(f"# Spec\n\n{line}\n\nText.\n", 1))

    def test_the_number_ends_at_a_word_boundary(self):
        self.assertFalse(specbinding.has_story("### User Story 12 - Other\n", 1))
        self.assertTrue(specbinding.has_story("### User Story 12 - Other\n", 12))

    def test_a_heading_inside_a_fenced_code_block_counts(self):
        """The check is textual: the gate does not parse Markdown."""
        self.assertTrue(specbinding.has_story("# Spec\n\n```\n### User Story 1 - Fenced\n```\n", 1))

    def test_anything_else_is_no_heading(self):
        for text in ("### User Story 2 - Reset\n", "  ### User Story 1 - Indented\n", "## User Story 1 - Level 2\n",
                     "See ### User Story 1 - Mentioned\n", "### User story 1 - Lower case\n", "### User Story 1x\n",
                     ""):
            with self.subTest(text=text):
                self.assertFalse(specbinding.has_story(text, 1))

    def test_the_heading_looked_for_is_named(self):
        self.assertEqual(specbinding.story_heading(4), "### User Story 4")


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
