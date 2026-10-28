"""Names the plugins dropped stay dropped: the skill that was deleted, the planning skill's old name, and where the
spec was once said to live."""
import re
import subprocess
import unittest

from paths import PLUGIN, REPO

GATE = PLUGIN / "scripts" / "gate.py"
# Every plugin and every plugin's tests: planning and building left this plugin with names it once held.
PLUGINS = ("reviewer/plugin", "planner/plugin", "builder/plugin", "auditor/plugin")
SUITES = ("reviewer/tests", "planner/tests", "builder/tests")
ROOTS = (*PLUGINS, *SUITES)
# Spelled in two halves so that this file is not itself a hit.
DELETED_SKILL = "alq-" + "shape"
# The planning skill's old name, with a hyphen or an underscore, in any case. "design document" is the
# settled-design rule's term and stays.
OLD_SKILL_NAME = re.compile("design[-_]" + "doc(?!ument)", re.I)
OLD_HOME_PHRASES = ("spec lives on the issue", "spec lives **on the issue**", "its only home")


def tracked_text(path: str) -> str:
    """What git holds for a tracked path: a link's target (a carrier's `core` link is one), else the file's text."""
    file = REPO / path
    return str(file.readlink()) if file.is_symlink() else file.read_text(errors="ignore")


class OldNames(unittest.TestCase):
    def test_every_folder_it_scans_exists(self):
        # A moved folder would otherwise be scanned as empty and every check below would pass unread.
        for root in ROOTS:
            with self.subTest(root=root):
                self.assertTrue((REPO / root).is_dir())

    def test_nothing_in_the_plugins_or_their_tests_names_the_deleted_skill(self):
        named = [path.relative_to(REPO).as_posix()
                 for root in ROOTS for path in (REPO / root).rglob("*")
                 if path.is_file() and "__pycache__" not in path.parts
                 and DELETED_SKILL in path.read_text(errors="ignore")]
        self.assertEqual(named, [])

    def test_no_tracked_file_of_the_plugins_their_tests_the_spec_kit_files_or_ci_names_the_skill_by_its_old_name(self):
        # Tracked files only: a Spec Kit run leaves ignored state in the dev project, named after the workflow it ran.
        tracked = subprocess.run(["git", "ls-files", "-z", *ROOTS, ".specify", ".github"],
                                 cwd=REPO, capture_output=True, text=True, check=True).stdout
        named = [path for path in tracked.split("\0") if path and OLD_SKILL_NAME.search(path + tracked_text(path))]
        self.assertEqual(named, [])

    def test_the_gate_holds_none_of_the_old_home_phrases(self):
        text = re.sub(r"\s+", " ", GATE.read_text()).lower()
        for phrase in OLD_HOME_PHRASES:
            with self.subTest(phrase=phrase):
                self.assertNotIn(phrase, text)


if __name__ == "__main__":
    unittest.main()
