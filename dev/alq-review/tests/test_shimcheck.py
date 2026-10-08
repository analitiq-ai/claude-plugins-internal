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
        self.assertEqual(shimcheck.verdict("not_fix", None, None, sites_left=True), "complete")
        for coverage in ("all", "none_other"):
            self.assertEqual(shimcheck.verdict("fix", "cause", coverage, sites_left=True), "complete")
        for level, coverage in (("cause", "edited_only"), ("cause", "some"), ("symptom", "all"),
                                ("symptom", "none_other")):
            self.assertEqual(shimcheck.verdict("fix", level, coverage, sites_left=True), "patch", (level, coverage))

    def test_with_no_site_left_a_cause_fix_is_complete_whatever_the_coverage_answer(self):
        for coverage in ("all", "edited_only", "none_other"):
            self.assertEqual(shimcheck.verdict("fix", "cause", coverage, sites_left=False), "complete", coverage)
        self.assertEqual(shimcheck.verdict("not_fix", None, None, sites_left=False), "complete")

    def test_with_no_site_left_a_symptom_fix_is_still_a_patch(self):
        for coverage in ("all", "edited_only", "none_other"):
            self.assertEqual(shimcheck.verdict("fix", "symptom", coverage, sites_left=False), "patch", coverage)


class Overlap(unittest.TestCase):
    def test_old_side_ranges_of_one_file_overlap(self):
        self.assertTrue(shimcheck.overlaps([hunk(old=(10, 3))], [hunk(old=(12, 1))]))
        self.assertFalse(shimcheck.overlaps([hunk(old=(10, 3))], [hunk("src/save.py", old=(12, 1))]))
        self.assertFalse(shimcheck.overlaps([hunk(old=(10, 1))], [hunk(old=(30, 2))]))
        self.assertFalse(shimcheck.overlaps([], [hunk()]))

    def test_a_site_counts_as_its_line(self):
        self.assertEqual(shimcheck.site_range(site(line=7)), {"file": "src/load.py", "old_start": 7, "old_count": 1})


class Altered(unittest.TestCase):
    def test_each_site_gets_the_lines_the_staged_change_alters_in_its_file(self):
        sites = [site(line=329), site("src/save.py", 3, "main"), site("src/other.py", 1, "run")]
        marks = shimcheck.altered(sites, [hunk(old=(333, 1)), hunk(old=(340, 13)), hunk("src/save.py", old=(9, 2))])
        self.assertEqual(marks, {shimcheck.site_id("src/load.py", "load"): [(333, 333), (340, 352)],
                                 shimcheck.site_id("src/save.py", "main"): [(9, 10)],
                                 shimcheck.site_id("src/other.py", "run"): None})

    def test_a_pure_insertion_is_the_line_it_follows(self):
        marks = shimcheck.altered([site()], [hunk(old=(7, 0))])
        self.assertEqual(marks, {shimcheck.site_id("src/load.py", "load"): [(7, 7)]})

    def test_the_lines_are_written_for_the_refusal(self):
        self.assertEqual(shimcheck.lines_text([(333, 333), (340, 352)]), "alters lines 333, 340-352 of this file")
        self.assertEqual(shimcheck.lines_text(None), "this file is not in the staged change")


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
        held = shimcheck.new_chain("acme/demo", "main", "b" * 40, [hunk()], state="held")
        overridden = dict(shimcheck.new_chain("acme/demo", "main", "c" * 40, [hunk()]), state="overridden")
        for chains in ([overridden, held], [held, overridden]):
            decided = shimcheck.commit_decision(None, chains, empty=False, concluding=False, staging=False, alone=True,
                                                hunks=[dict(hunk(), id="h1")], labels={"h1": "CODE"}, tree="d" * 40,
                                                root="/w")
            self.assertFalse(decided.allow)
            self.assertIn(f"override shim-{held['id']}", decided.reason)


    def decide(self, chains):
        return shimcheck.commit_decision(None, chains, empty=False, concluding=False, staging=False, alone=True,
                                         hunks=[dict(hunk(), id="h1")], labels={"h1": "CODE"}, tree="d" * 40, root="/w")

    def test_an_overridden_bug_lets_the_commit_through_only_when_no_other_bug_is_reached(self):
        overridden = dict(shimcheck.new_chain("acme/demo", "main", "c" * 40, [hunk()]), state="overridden")
        other = shimcheck.new_chain("acme/demo", "main", "d" * 40, [hunk()])
        self.assertTrue(self.decide([overridden]).allow)
        refused = self.decide([overridden, other])
        self.assertFalse(refused.allow)
        self.assertIn("has not been shim-checked", refused.reason)
        self.assertFalse(self.decide([]).allow)


def bug(ident="c" * 16, count=1, state="open", ranges=None, **more):
    return {"id": ident, "branch": "main", "count": count, "members": [f"t{i}" for i in range(count)], "state": state,
            "target": None, "seen": {}, "ranges": [hunk()] if ranges is None else ranges, **more}


class SettledChains(unittest.TestCase):
    def check(self, mode="sweep", verdict="patch", hunks=None, sites=None):
        return {"repo": "acme/demo", "branch": "main", "head": "a" * 40, "tree": "e" * 40,
                "hunks": [hunk()] if hunks is None else hunks, "same_operation": [site()] if sites is None else sites,
                "callers": [], "mode": mode, "verdict": verdict}

    def by_id(self, settled):
        return {item["id"]: item for item in settled}

    def test_an_overridden_bug_is_left_as_the_user_set_it(self):
        for count in (2, 3):
            overridden = bug(count=count, state="overridden")
            for mode, verdict in (("sweep", "patch"), ("deep", "patch"), ("sweep", "complete")):
                with self.subTest(count=count, mode=mode, verdict=verdict):
                    self.assertEqual(shimcheck.settled_chains([overridden], self.check(mode, verdict)), [])

    def test_a_new_bug_has_no_head_and_is_opened_by_its_tree(self):
        [opened] = shimcheck.settled_chains([], self.check())
        self.assertNotIn("head", opened)
        self.assertEqual((opened["count"], opened["members"], opened["state"]), (1, ["e" * 40], "open"))

    def test_bugs_at_1_and_3_become_one_at_3_and_then_4_with_this_patch_so_held(self):
        low, high = bug("a" * 16, 1, ranges=[hunk(old=(11, 1))]), bug("b" * 16, 3, state="deep_due",
                                                                      ranges=[hunk(old=(12, 1))])
        merged = self.by_id(shimcheck.settled_chains([low, high], self.check()))
        self.assertEqual((merged["b" * 16]["count"], merged["b" * 16]["state"]), (4, "held"))
        self.assertEqual((merged["a" * 16]["state"], merged["a" * 16]["into"], merged["a" * 16]["count"]),
                         ("merged", "b" * 16, 1))
        self.assertEqual(len(merged["b" * 16]["ranges"]), 2)
        self.assertEqual(merged["b" * 16]["members"], ["t0", "t1", "t2", "e" * 40])

    def test_the_smaller_id_goes_on_when_the_counts_tie(self):
        merged = self.by_id(shimcheck.settled_chains([bug("b" * 16, 2), bug("a" * 16, 2)], self.check()))
        self.assertEqual((merged["a" * 16]["state"], merged["b" * 16]["state"], merged["a" * 16]["count"]),
                         ("deep_due", "merged", 3))

    def test_a_merged_bug_is_held_if_any_was_and_an_override_is_not_carried(self):
        held, overridden = bug("a" * 16, 4, state="held"), bug("b" * 16, 2, state="overridden")
        merged = self.by_id(shimcheck.settled_chains([overridden, held], self.check()))
        self.assertEqual(merged["a" * 16]["state"], "held")
        only = self.by_id(shimcheck.settled_chains([bug("a" * 16, 3, state="deep_due"), overridden],
                                                   self.check("deep")))
        self.assertEqual(only["a" * 16]["state"], "deep_done")

    def test_the_merged_survivor_counts_once_though_it_absorbed_the_counting_tree(self):
        counted = bug("a" * 16, 2, members=["t0", "e" * 40])
        [again] = [item for item in shimcheck.settled_chains([counted, bug("b" * 16, 1)], self.check())
                   if item["state"] != "merged"]
        self.assertEqual(again["count"], 2)

    def test_a_count_of_3_is_deep_due_and_4_or_more_is_held(self):
        for before, state in ((1, "open"), (2, "deep_due"), (3, "held"), (4, "held")):
            with self.subTest(before=before):
                [after] = shimcheck.settled_chains([bug(count=before)], self.check())
                self.assertEqual((after["count"], after["state"]), (before + 1, state))

    def test_a_complete_verdict_ends_the_bugs_it_reaches(self):
        ended = shimcheck.settled_chains([bug("a" * 16, 1), bug("b" * 16, 3)], self.check(verdict="complete"))
        self.assertEqual([item["state"] for item in ended], ["ended", "ended"])


class Carried(unittest.TestCase):
    """Bug ranges move with the file from the text they were measured in to the text commits are measured against."""
    old = "".join(f"line {n}\n" for n in range(1, 21))

    def hunks_for(self, old, new):
        import worktree
        return lambda file: worktree.text_hunks(self.root, old, new)

    def setUp(self):
        import subprocess, tempfile
        self.dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.dir.cleanup)
        self.root = self.dir.name
        subprocess.run(["git", "init", "-q", self.root], check=True)

    def carry(self, bugs, new, file="src/load.py"):
        return shimcheck.carried(bugs, {file: self.old}, {file: new}, self.hunks_for(self.old, new) if new else None)

    def test_lines_added_above_a_bug_move_it_down(self):
        new = "top\ntop2\n" + self.old
        [moved] = self.carry([bug(ranges=[hunk(old=(10, 2))])], new)
        self.assertEqual(moved["ranges"], [hunk(old=(12, 2))])
        self.assertEqual(moved["state"], "open")

    def test_a_text_that_did_not_change_leaves_the_ranges_alone(self):
        [same] = self.carry([bug(ranges=[hunk(old=(10, 2))])], self.old)
        self.assertEqual(same["ranges"], [hunk(old=(10, 2))])

    def test_a_bug_whose_lines_are_deleted_is_ended(self):
        new = "".join(line for n, line in enumerate(self.old.splitlines(True), 1) if not 9 <= n <= 12)
        [gone] = self.carry([bug(ranges=[hunk(old=(10, 2))])], new)
        self.assertEqual((gone["state"], gone["ranges"]), ("ended", []))

    def test_a_file_that_is_no_longer_there_takes_its_ranges(self):
        [gone] = shimcheck.carried([bug(ranges=[hunk(old=(10, 2))])], {"src/load.py": self.old}, {"src/load.py": None},
                                   None)
        self.assertEqual(gone["state"], "ended")

    def test_a_range_in_another_file_is_kept_when_one_range_is_dropped(self):
        new = "".join(line for n, line in enumerate(self.old.splitlines(True), 1) if not 9 <= n <= 12)
        [kept] = shimcheck.carried([bug(ranges=[hunk(old=(10, 2)), hunk("src/save.py", old=(3, 1))])],
                                   {"src/load.py": self.old, "src/save.py": "x\ny\nz\n"},
                                   {"src/load.py": new, "src/save.py": "x\ny\nz\n"},
                                   lambda file: __import__("worktree").text_hunks(self.root, self.old, new))
        self.assertEqual((kept["state"], kept["ranges"]), ("open", [hunk("src/save.py", old=(3, 1))]))

    def test_an_override_ends_when_a_change_reaches_the_bugs_lines_and_not_before(self):
        elsewhere = self.old.replace("line 18\n", "changed 18\n")
        [still] = self.carry([bug(count=4, state="overridden", ranges=[hunk(old=(10, 2))])], elsewhere)
        self.assertEqual(still["state"], "overridden")
        inside = self.old.replace("line 11\n", "changed 11\n")
        [back] = self.carry([bug(count=4, state="overridden", ranges=[hunk(old=(10, 2))])], inside)
        self.assertEqual(back["state"], "held")
        [open_again] = self.carry([bug(count=1, state="overridden", ranges=[hunk(old=(10, 2))])], inside)
        self.assertEqual(open_again["state"], "open")


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
