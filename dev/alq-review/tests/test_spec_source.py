"""What the alq-issue-tackle, alq-root-cause-check and design-doc skills say about where the spec is (spec 018)."""
import re
import unittest
from pathlib import Path

from paths import PLUGIN, REPO

import helpers  # noqa: F401  puts scripts/ on the path

import premise_report
import rootcause
import speclocation

SKILLS = PLUGIN / "skills"
TACKLE = SKILLS / "alq-issue-tackle" / "SKILL.md"
ROOT_CAUSE = SKILLS / "alq-root-cause-check" / "SKILL.md"
DESIGN_DOC = SKILLS / "design-doc" / "SKILL.md"
GATE = PLUGIN / "scripts" / "gate.py"
# Spelled in two halves so that this file is not itself a hit.
DELETED_SKILL = "alq-" + "shape"
OLD_HOME_PHRASES = ("spec lives on the issue", "spec lives **on the issue**", "its only home")


def prose(*roots: Path) -> dict[Path, str]:
    return {path: path.read_text() for root in roots for path in root.rglob("*.md") if "fixtures" not in path.parts}


def squashed(path: Path) -> str:
    return re.sub(r"\s+", " ", path.read_text())


class SpecSource(unittest.TestCase):
    def test_tackle_and_root_cause_name_the_show_command_and_design_doc(self):
        for path in (TACKLE, ROOT_CAUSE):
            text = path.read_text()
            with self.subTest(skill=path.parent.name):
                self.assertIn("speclocation.py", text)
                self.assertIn("SPECLOC show", text)
                self.assertIn("/alq-review:design-doc #<n>", text)

    def test_tackle_root_cause_and_design_doc_do_not_spell_the_marker(self):
        for path in (TACKLE, ROOT_CAUSE, DESIGN_DOC):
            with self.subTest(skill=path.parent.name):
                self.assertNotIn(speclocation.MARKER, path.read_text())

    def test_tackle_and_root_cause_hold_no_jq_filter(self):
        for path in (TACKLE, ROOT_CAUSE):
            with self.subTest(skill=path.parent.name):
                self.assertNotIn("--jq", path.read_text())

    def test_issue_tackle_drops_the_surface_rules_and_the_recheck_of_code_decisions(self):
        text = TACKLE.read_text()
        for phrase in ("Hand-maintained surfaces", "Write no copy", "(code)"):
            with self.subTest(phrase=phrase):
                self.assertNotIn(phrase, text)

    def test_nothing_in_the_plugin_or_its_tests_names_the_deleted_skill(self):
        named = [path.relative_to(REPO).as_posix()
                 for root in (PLUGIN, Path(__file__).parent) for path in root.rglob("*")
                 if path.is_file() and "__pycache__" not in path.parts
                 and DELETED_SKILL in path.read_text(errors="ignore")]
        self.assertEqual(named, [])

    def test_design_doc_says_to_stop_on_located_ahead_of_the_start_command(self):
        text = squashed(DESIGN_DOC)
        self.assertIn("SPECLOC status <issue>", text)
        stop = ("`located`: the issue's location comment names a spec folder. Run `python3 SPECLOC show <issue>`, "
                "show the user the location, and stop.")
        self.assertIn(stop, text)
        for state in ("none", speclocation.NOT_WORTH_DOING, "no comment"):
            with self.subTest(state=state):
                self.assertIn(f"`{state}`", text)
        self.assertLess(text.find(stop), text.find("DRIVE start"))

    def test_design_doc_names_the_premise_form_the_report_its_fields_and_the_resume_in_that_order(self):
        text = squashed(DESIGN_DOC)
        steps = ["PREMISE form", ".specify/workflows/runs/<run_id>/premise-report.md",
                 f"`{premise_report.RECOMMENDATION}:`", f"`{premise_report.PICK}:`", 'premise_verdict=<pick>"',
                 "/speckit-grill-me"]
        positions = [text.find(step) for step in steps]
        self.assertNotIn(-1, positions, list(zip(steps, positions)))
        self.assertEqual(positions, sorted(positions))
        for outcome in premise_report.OUTCOMES:
            with self.subTest(outcome=outcome):
                self.assertIn(f"`{outcome}`", text)
        self.assertIn("Never ask for approve or reject at this step.", text)
        self.assertIn("Ask the user only what the issue and the code cannot answer.", text)

    def test_root_cause_check_names_the_heading_and_both_openings_that_rootcause_py_grades(self):
        text = squashed(ROOT_CAUSE)
        for phrase in (f"`{rootcause.HEADING}`", f"`{rootcause.OBSERVED}`", f"`{rootcause.NOT_A_DEFECT}`"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)
        self.assertNotIn("no Root cause section yet", text)

    def test_design_doc_names_the_location_script_and_its_commands(self):
        text = DESIGN_DOC.read_text()
        for phrase in ("speclocation.py", "SPECLOC post", "SPECLOC none", "#<issue> none <reason>"):
            with self.subTest(phrase=phrase):
                self.assertIn(phrase, text)

    def test_design_doc_commits_then_pushes_then_posts_the_location_comment(self):
        text = DESIGN_DOC.read_text()
        positions = [text.find(step) for step in ("git commit", "git push", "SPECLOC post")]
        self.assertNotIn(-1, positions, positions)
        self.assertEqual(positions, sorted(positions))

    def test_design_doc_says_a_failed_run_leaves_nothing_behind(self):
        text = squashed(DESIGN_DOC)
        self.assertIn("A run that is rejected or fails commits nothing, pushes nothing and posts no location comment.", text)
        self.assertIn("starts no workflow", text)

    def test_tackle_root_cause_design_doc_and_the_gate_hold_none_of_the_old_home_phrases(self):
        for path in (TACKLE, ROOT_CAUSE, DESIGN_DOC, GATE):
            text = squashed(path).lower()
            for phrase in OLD_HOME_PHRASES:
                with self.subTest(file=path.relative_to(PLUGIN).as_posix(), phrase=phrase):
                    self.assertNotIn(phrase, text)

    def test_every_skill_reads_an_issues_comments_across_all_pages(self):
        """A lookup of the spec or premise comment by id misses it on page two as surely as a body fetch does."""
        unpaged = [f"{path.relative_to(PLUGIN)}: {line}" for path, text in prose(SKILLS).items()
                   for line in re.sub(r"\s*\\\n\s*", " ", text).splitlines()
                   if re.search(r"gh api (?!(?:.*\s)?-X\s).*issues/<n>/comments", line) and "--paginate" not in line]
        self.assertEqual(unpaged, [])


if __name__ == "__main__":
    unittest.main()
