"""What the issue-tackle and root-cause-check skills say about where the spec is and how they read values."""
import re
import unittest
from pathlib import Path

from paths import PLUGIN

TACKLE = PLUGIN / "skills" / "issue-tackle" / "SKILL.md"
ROOT_CAUSE = PLUGIN / "skills" / "root-cause-check" / "SKILL.md"
OLD_HOME_PHRASES = ("spec lives on the issue", "spec lives **on the issue**", "its only home")


def squashed(path: Path) -> str:
    return re.sub(r"\s+", " ", path.read_text())


class SpecSource(unittest.TestCase):
    def test_issue_tackle_drops_the_surface_rules_and_the_recheck_of_code_decisions(self):
        text = TACKLE.read_text()
        for phrase in ("Hand-maintained surfaces", "Write no copy", "(code)"):
            with self.subTest(phrase=phrase):
                self.assertNotIn(phrase, text)

    def test_tackle_and_root_cause_hold_none_of_the_old_home_phrases(self):
        for path in (TACKLE, ROOT_CAUSE):
            text = squashed(path).lower()
            for phrase in OLD_HOME_PHRASES:
                with self.subTest(file=path.relative_to(PLUGIN).as_posix(), phrase=phrase):
                    self.assertNotIn(phrase, text)


class CommandSubstitution(unittest.TestCase):
    """A `$(...)` inside another command's arguments does not stop the shell when it fails: the command runs on an
    empty value (`git diff ...HEAD` is an empty diff; `gh --repo ""` picks another remote's repo). A value is read
    on its own, as `name=$(...)`, before the command that uses it."""
    READ_ON_ITS_OWN = re.compile(r"^\s*\w+=\$\(")

    def test_no_command_the_skills_give_reads_a_value_inside_its_arguments(self):
        commands = [(s.parent.name, c) for s in (TACKLE, ROOT_CAUSE) for c in re.findall(r"`([^`]+)`", s.read_text())]
        for where, command in commands:
            if "$(" not in command:
                continue
            with self.subTest(where=where, command=command):
                self.assertTrue(self.READ_ON_ITS_OWN.match(command) and command.count("$(") == 1)


class RootCauseCheck(unittest.TestCase):
    """The check is handed the spec folder and reads its spec.md; it looks nothing up (R14)."""

    @staticmethod
    def sentences() -> list[str]:
        # A period inside a path (`spec.md`) is not followed by whitespace, so it does not split.
        return re.split(r"(?<=\.)\s+", squashed(ROOT_CAUSE))

    def test_takes_the_spec_folder_as_its_argument_and_reads_its_root_cause_section(self):
        self.assertTrue([s for s in self.sentences() if "argument" in s and "spec folder" in s],
                        "no sentence says the argument is the spec folder")
        text = ROOT_CAUSE.read_text()
        for read in ("`<folder>/spec.md`", "`## Root cause`"):
            with self.subTest(read=read):
                self.assertIn(read, text)

    def test_measures_the_delta_from_origins_main_as_it_is_now(self):
        """A local main behind origin's would put commits merged since into the delta, graded as this fix."""
        self.assertIn("`git fetch -q origin main && git diff origin/main...HEAD`", ROOT_CAUSE.read_text())

    def test_looks_up_no_location(self):
        text = ROOT_CAUSE.read_text()
        for lookup in ("speclocation", "SPECLOC", "location comment"):
            with self.subTest(lookup=lookup):
                self.assertNotIn(lookup, text)

    def test_a_missing_root_cause_section_gives_cannot_tell_for_that_reason_alone(self):
        said = [s for s in self.sentences() if "CANNOT TELL" in s and "no `## Root cause` section" in s]
        self.assertTrue(said, "no sentence gives CANNOT TELL for a missing `## Root cause` section")
        for sentence in said:
            for lookup in ("`show`", "spec: none", "location comment"):
                with self.subTest(lookup=lookup):
                    self.assertNotIn(lookup, sentence)



if __name__ == "__main__":
    unittest.main()
