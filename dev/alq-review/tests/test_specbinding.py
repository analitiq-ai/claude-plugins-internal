"""specbinding.py: the review-round `spec` argument, its shape, its binding to a PR, and the spec.md hold."""
import unittest
from datetime import timedelta

from helpers import T0

import ledger
import specbinding
from specbinding import Folder, NoSpec

FOLDER, OTHER = "dev/alq-review/specs/019-x", "dev/alq-review/specs/020-y"
BOUND_BLOB, HEAD_BLOB = "a" * 40, "b" * 40
EARLIER, LATER = ledger.stamp(T0), ledger.stamp(T0 + timedelta(minutes=5))


def shown(value):
    return "null" if value is None else f"`{value}`"


class Parse(unittest.TestCase):
    def test_a_folder_path_gives_a_folder(self):
        self.assertEqual(specbinding.parse(FOLDER), Folder(FOLDER))

    def test_none_gives_no_spec(self):
        self.assertEqual(specbinding.parse(None), NoSpec())

    def test_surrounding_whitespace_is_stripped(self):
        self.assertEqual(specbinding.parse(f"  {FOLDER}\n"), Folder(FOLDER))

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
                self.assertEqual(specbinding.parse(value), Folder(value))


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
    def test_the_same_value_binds(self):
        for value in (FOLDER, None):
            with self.subTest(value=value):
                self.assertIsNone(specbinding.bind(value, value))

    def test_a_different_value_is_refused_naming_both_and_that_the_binding_never_changes(self):
        for recorded, given in ((FOLDER, OTHER), (FOLDER, None), (None, FOLDER)):
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
