import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from fnmatch import fnmatch
from pathlib import Path, PurePosixPath

from paths import PLUGIN, REPO

# A command as a skill, workflow or agent of one of these plugins is called: `<plugin>:<name>`.
COMMAND = re.compile(r"\balq-(?:review|plan|build):[\w-]+")
# What planning and building ship, alq-plan and alq-build, never alq-review.
NOT_REVIEW = ("skills/alq-spec/", "skills/alq-issue-tackle/", "skills/alq-root-cause-check/", "speckit/",
              "scripts/speclocation.py", "scripts/settled_design.py", "scripts/premise_report.py", "scripts/rootcause.py")


def shipped() -> list[str]:
    """The plugin's tracked files, relative to it."""
    out = subprocess.run(["git", "ls-files", "-z", "--", str(PLUGIN)], cwd=REPO, capture_output=True, text=True,
                         check=True).stdout
    return [str(Path(f).relative_to(PLUGIN.relative_to(REPO))) for f in out.split("\0") if f]


def commands(files: list[str]) -> set[str]:
    """What the plugin ships to be called: its skills, workflows and agents, each as `<plugin>:<name>`."""
    names = set()
    for path in map(Path, files):
        if path.parts[0] == "skills" and path.name == "SKILL.md":
            names.add(path.parts[1])
        elif (path.parts[0], path.suffix) in {("workflows", ".js"), ("agents", ".md")}:
            names.add(path.stem)
    return {f"{PLUGIN.name}:{name}" for name in names}


class ShippedTree(unittest.TestCase):
    def test_no_tracked_file_under_plugins_is_in_a_tests_folder_or_named_test_underscore_py(self):
        tracked = subprocess.run(["git", "ls-files", "-z", "plugins"], cwd=REPO, capture_output=True, text=True,
                                 check=True).stdout.split("\0")
        tests = [f for f in tracked if f and ("tests" in PurePosixPath(f).parts or fnmatch(PurePosixPath(f).name, "test_*.py"))]
        self.assertEqual(tests, [])

    def test_ships_no_planning_or_building_file(self):
        self.assertEqual([f for f in shipped() if f.startswith(NOT_REVIEW)], [])

    def test_every_script_imports_from_a_copy_holding_only_this_plugin(self):
        scripts = [f for f in shipped() if f.endswith(".py")]
        self.assertIn("scripts/gate.py", scripts)
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / PLUGIN.name
            shutil.copytree(PLUGIN, copy, ignore=shutil.ignore_patterns("__pycache__"))
            for script in scripts:
                with self.subTest(script=script):
                    done = subprocess.run([sys.executable, "-c", f"import {Path(script).stem}"],
                                          cwd=(copy / script).parent, capture_output=True, text=True)
                    self.assertEqual(done.returncode, 0, done.stderr)

    def test_no_file_names_a_command_this_plugin_does_not_ship(self):
        files = shipped()
        own = commands(files)
        self.assertIn("alq-review:review-round", own)
        named = {f: set(COMMAND.findall((PLUGIN / f).read_text())) - own for f in files}
        self.assertEqual({f: found for f, found in named.items() if found}, {})
