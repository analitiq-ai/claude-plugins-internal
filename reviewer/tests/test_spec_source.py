"""Names the plugins dropped stay dropped: the skill that was deleted, the planning skill's old name, and where the
spec was once said to live."""
import re
import subprocess
import unittest
from pathlib import Path

from paths import PLUGIN, REPO

GATE = PLUGIN / "scripts" / "gate.py"
# Every plugin and every plugin's tests: planning and building left this plugin with names it once held.
PLUGINS = REPO / "plugins"
SUITES = ("reviewer/tests", "planner/tests", "builder/tests")
# Spelled in two halves so that this file is not itself a hit.
DELETED_SKILL = "alq-" + "shape"
# The planning skill's old name, with a hyphen or an underscore, in any case. "design document" is the
# settled-design rule's term and stays.
OLD_SKILL_NAME = re.compile("design[-_]" + "doc(?!ument)", re.I)
OLD_HOME_PHRASES = ("spec lives on the issue", "spec lives **on the issue**", "its only home")


class OldNames(unittest.TestCase):
    def test_nothing_in_the_plugins_or_their_tests_names_the_deleted_skill(self):
        named = [path.relative_to(REPO).as_posix()
                 for root in (PLUGINS, *(REPO / suite for suite in SUITES)) for path in root.rglob("*")
                 if path.is_file() and "__pycache__" not in path.parts
                 and DELETED_SKILL in path.read_text(errors="ignore")]
        self.assertEqual(named, [])

    def test_no_tracked_file_of_the_plugins_their_tests_the_spec_kit_files_or_ci_names_the_skill_by_its_old_name(self):
        # Tracked files only: a Spec Kit run leaves ignored state in the dev project, named after the workflow it ran.
        tracked = subprocess.run(["git", "ls-files", "-z", "plugins", *SUITES, ".specify", ".github"],
                                 cwd=REPO, capture_output=True, text=True, check=True).stdout
        named = [path for path in tracked.split("\0")
                 if path and OLD_SKILL_NAME.search(path + (REPO / path).read_text(errors="ignore"))]
        self.assertEqual(named, [])

    def test_the_gate_holds_none_of_the_old_home_phrases(self):
        text = re.sub(r"\s+", " ", GATE.read_text()).lower()
        for phrase in OLD_HOME_PHRASES:
            with self.subTest(phrase=phrase):
                self.assertNotIn(phrase, text)


if __name__ == "__main__":
    unittest.main()
