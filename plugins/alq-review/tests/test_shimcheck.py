import hashlib
import unittest

import helpers  # noqa: F401  (puts scripts/ on the path)

import briefs
import shimcheck

HEAD_FILES = {"src/load.py": 40, "src/save.py": 12}


def located(path):
    return HEAD_FILES.get(path)


def site(file="src/load.py", line=12, function="load", does="reads the file unchecked"):
    return {"file": file, "line": line, "function": function, "does": does}


def sweep(same=(), callers=()):
    return {"check_ref": "shim-acme/demo-0123456789ab", "same_operation": list(same), "callers": list(callers)}


def hunk(file="src/load.py", old=(12, 1)):
    return {"file": file, "old_start": old[0], "old_count": old[1]}


class SiteId(unittest.TestCase):
    def test_a_site_is_named_by_its_file_and_function(self):
        expected = hashlib.sha256(b"src/load.py\0load").hexdigest()[:16]
        self.assertEqual(shimcheck.site_id("src/load.py", "load"), expected)
        self.assertNotEqual(shimcheck.site_id("src/load.py", "load"), shimcheck.site_id("src/save.py", "load"))


class ValidateSweep(unittest.TestCase):
    def test_sites_that_exist_in_head_are_accepted(self):
        self.assertEqual(shimcheck.validate_sweep(sweep([site()], [site("src/save.py", 3, "main")]), located), [])

    def test_every_reason_is_returned(self):
        errors = shimcheck.validate_sweep(sweep(
            [site("src/gone.py"), site(line=41, function="parse"), site(function=" "), site(function="dump", does="")],
            [site("src/save.py", 3, "main"), site("src/save.py", 5, "main")]), located)
        self.assertEqual(len(errors), 5, errors)
        for part in ("src/gone.py", "src/load.py:41", "function", "does", "src/save.py main"):
            self.assertTrue(any(part in e for e in errors), (part, errors))

    def test_a_line_before_the_first_is_rejected(self):
        self.assertEqual(len(shimcheck.validate_sweep(sweep([site(line=0)]), located)), 1)

    def test_the_same_site_in_both_lists_is_accepted(self):
        self.assertEqual(shimcheck.validate_sweep(sweep([site()], [site()]), located), [])


class Verdict(unittest.TestCase):
    def test_complete_only_for_a_cause_fix_that_covers_every_site_or_a_non_fix(self):
        self.assertEqual(shimcheck.verdict("not_fix", None, None), "complete")
        for coverage in ("all", "none_other"):
            self.assertEqual(shimcheck.verdict("fix", "cause", coverage), "complete")
        for level, coverage in (("cause", "edited_only"), ("cause", "some"), ("symptom", "all"),
                                ("symptom", "none_other")):
            self.assertEqual(shimcheck.verdict("fix", level, coverage), "patch", (level, coverage))


class Overlap(unittest.TestCase):
    def test_old_side_ranges_of_one_file_overlap(self):
        self.assertTrue(shimcheck.overlaps([hunk(old=(10, 3))], [hunk(old=(12, 1))]))
        self.assertFalse(shimcheck.overlaps([hunk(old=(10, 3))], [hunk("src/save.py", old=(12, 1))]))
        self.assertFalse(shimcheck.overlaps([hunk(old=(10, 1))], [hunk(old=(30, 2))]))
        self.assertFalse(shimcheck.overlaps([], [hunk()]))

    def test_a_site_counts_as_its_line(self):
        self.assertEqual(shimcheck.site_range(site(line=7)), {"file": "src/load.py", "old_start": 7, "old_count": 1})


class Touched(unittest.TestCase):
    def test_each_site_is_marked_by_whether_a_staged_hunk_reaches_its_line(self):
        sites = [site(), site("src/save.py", 3, "main")]
        marks = shimcheck.touched(sites, [hunk(old=(12, 2))])
        self.assertEqual(marks, {shimcheck.site_id("src/load.py", "load"): True,
                                 shimcheck.site_id("src/save.py", "main"): False})


class OverrideId(unittest.TestCase):
    def test_a_chain_is_overridden_by_its_id_and_an_unchained_tree_by_its_prefix(self):
        self.assertEqual(shimcheck.override_id({"id": "c" * 16}, "a" * 40), "c" * 16)
        self.assertEqual(shimcheck.override_id(None, "0123456789abcdef" * 2 + "01234567"), "0123456789ab")


class IsTestFile(unittest.TestCase):
    def test_each_test_file_name_pattern_is_a_test_file(self):
        for path in ("test_load.py", "src/test_load.py", "src/load_test.py", "cmd/load_test.go", "web/App.test.tsx",
                     "web/app.spec.js", "lib/util.test.mjs", "lib/util.spec.cjs", "web/a.test.ts", "web/a.spec.jsx",
                     "modules/vpc/main.tftest.hcl"):
            with self.subTest(path=path):
                self.assertTrue(shimcheck.is_test_file(path))

    def test_any_file_under_a_tests_test_or___tests___folder_is_a_test_file(self):
        for path in ("tests/fixtures/repo.json", "pkg/test/helpers.go", "web/__tests__/App.jsx",
                     "web/__tests__/data.json"):
            with self.subTest(path=path):
                self.assertTrue(shimcheck.is_test_file(path))

    def test_a_near_miss_is_not_a_test_file(self):
        for path in ("specs/006/spec.md", "src/contest.py", "latest.py", "src/testing.py", "attest/main.py",
                     "src/test_load.go", "web/a.test.md", "load_test.pyc"):
            with self.subTest(path=path):
                self.assertFalse(shimcheck.is_test_file(path))


class Swept(unittest.TestCase):
    def test_a_tree_whose_code_is_all_in_test_files_has_nothing_to_sweep(self):
        hunks = [dict(hunk("tests/test_load.py"), id="h1"), dict(hunk("src/test_save.py"), id="h2"),
                 dict(hunk("README.md"), id="h3")]
        self.assertEqual(shimcheck.swept(hunks, {"h1": "CODE", "h2": "MIXED", "h3": "PROSE"}), [])

    def test_a_tree_with_code_outside_test_files_sweeps_its_test_hunks_too(self):
        hunks = [dict(hunk("tests/test_load.py"), id="h1"), dict(hunk(), id="h2"), dict(hunk("README.md"), id="h3")]
        self.assertEqual(shimcheck.swept(hunks, {"h1": "CODE", "h2": "CODE", "h3": "PROSE"}), hunks[:2])


class CommitDecision(unittest.TestCase):
    def test_a_held_bug_refuses_though_another_bug_the_tree_reaches_is_overridden(self):
        held = shimcheck.new_chain("acme/demo", "main", "a" * 40, "b" * 40, [hunk()], state="held")
        overridden = dict(shimcheck.new_chain("acme/demo", "main", "a" * 40, "c" * 40, [hunk()]), state="overridden")
        for chains in ([overridden, held], [held, overridden]):
            decided = shimcheck.commit_decision(None, chains, empty=False, concluding=False, staging=False, alone=True,
                                                hunks=[dict(hunk(), id="h1")], labels={"h1": "CODE"}, tree="d" * 40,
                                                root="/w")
            self.assertFalse(decided.allow)
            self.assertIn(f"override shim-{held['id']}", decided.reason)


class SettledChains(unittest.TestCase):
    def check(self, mode="sweep", verdict="patch"):
        return {"repo": "acme/demo", "branch": "main", "head": "a" * 40, "tree": "e" * 40, "hunks": [hunk()],
                "same_operation": [site()], "callers": [], "mode": mode, "verdict": verdict}

    def test_an_overridden_bug_is_left_as_the_user_set_it(self):
        for count in (2, 3):
            overridden = dict(shimcheck.new_chain("acme/demo", "main", "a" * 40, "c" * 40, [hunk()]),
                              count=count, members=["d" * 40] * count, state="overridden")
            for mode, verdict in (("sweep", "patch"), ("deep", "patch"), ("sweep", "complete")):
                with self.subTest(count=count, mode=mode, verdict=verdict):
                    self.assertEqual(shimcheck.settled_chains([overridden], self.check(mode, verdict)), [])


class Shapes(unittest.TestCase):
    """The schemas agents answer through hold the shapes of contracts/shim-check.md."""

    check = {"ref": "shim:acme/demo#tree:" + "a" * 40, "root": "/w/demo"}

    def test_a_sweep_is_two_lists_of_sites(self):
        schema = briefs.sweep_schema(self.check)
        self.assertEqual(set(schema["required"]), {"check_ref", "same_operation", "callers"})
        self.assertEqual(schema["properties"]["check_ref"], {"enum": [self.check["ref"]]})
        for name in shimcheck.LISTS:
            entry = schema["properties"][name]["items"]
            self.assertEqual(set(entry["required"]), {"file", "line", "function", "does"})
            self.assertFalse(entry["additionalProperties"])

    def test_a_ruling_names_one_site_and_says_how_it_relates(self):
        schema = briefs.ruling_schema(self.check, "0123456789abcdef")
        self.assertEqual(set(schema["required"]), {"check_ref", "site", "ruling", "evidence", "reason"})
        self.assertEqual(schema["properties"]["site"], {"enum": ["0123456789abcdef"]})
        self.assertEqual(schema["properties"]["ruling"], {"enum": list(shimcheck.RULINGS)})
        self.assertEqual(schema["properties"]["issue"]["type"], "integer")
        self.assertEqual(schema["properties"]["evidence"]["items"], {"type": "string"})

    def test_the_standard_brief_is_the_replays_prompt_and_the_callers_first_brief_starts_from_callers(self):
        standard = briefs.sweep_prompt(self.check, "DIFF TEXT", "/snap/shim-aaaaaaaaaaaa")
        for part in ("DIFF TEXT", "/snap/shim-aaaaaaaaaaaa", "Judge by behaviour, not by name.",
                     "Follow the chain until it leaves the repo.", "Verify each item by reading the code."):
            self.assertIn(part, standard)
        first = briefs.sweep_prompt(self.check, "DIFF TEXT", "/snap/shim-aaaaaaaaaaaa", callers_first=True)
        self.assertLess(first.index("caller"), first.index("same operation"))


if __name__ == "__main__":
    unittest.main()
