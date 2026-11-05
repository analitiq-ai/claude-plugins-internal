import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from fnmatch import fnmatch
from pathlib import Path, PurePosixPath

from paths import PLUGIN, REPO, tracked_text

# A command as a skill, workflow or agent of one of these plugins is called: `<plugin>:<name>`.
COMMAND = re.compile(r"\b(?:reviewer|planner|builder):[\w-]+")
# Paths reviewer must never ship, whatever another plugin ships at them: the planning and building skills under
# their names before the move, speclocation.py, deleted with them, and speckit/, the tree every Spec Kit preset and
# workflow lives under. The overlap guard below covers only the paths planner and builder ship today.
NEVER_IN_REVIEW = ("skills/issue-spec/", "skills/alq-issue-tackle/", "skills/alq-root-cause-check/",
                   "scripts/speclocation.py", "speckit/")
# Paths whose place is fixed rather than chosen by the plugin: the plugin format's hook config, and a core carrier's
# link and pinned packages (root ADR-0001). Two plugins sharing one is not one shipping the other's file.
FIXED_PATHS = ("hooks/hooks.json", "core", "package.json", "package-lock.json")


def blobs(plugin: Path = PLUGIN) -> dict[str, str]:
    """The plugin's tracked files, relative to it, each with the id of the blob git holds for it."""
    out = subprocess.run(["git", "ls-files", "-s", "-z", "--", str(plugin)], cwd=REPO, capture_output=True, text=True,
                         check=True).stdout
    # Each entry is `<mode> <blob> <stage>\t<path>`.
    entries = (entry.split("\t", 1) for entry in out.split("\0") if entry)
    return {str(Path(path).relative_to(plugin.relative_to(REPO))): meta.split()[1] for meta, path in entries}


def shipped(plugin: Path = PLUGIN) -> list[str]:
    """The plugin's tracked files, relative to it."""
    return list(blobs(plugin))


def content(files: list[str]) -> set[str]:
    """The plugin's files without its manifest and the other paths fixed for it."""
    return {f for f in files if Path(f).parts[0] != ".claude-plugin" and f not in FIXED_PATHS}


def commands(files: list[str]) -> set[str]:
    """What the plugin ships to be called: its skills, workflows and agents, each as `<plugin>:<name>`."""
    names = set()
    for path in map(Path, files):
        if path.parts[0] == "skills" and path.name == "SKILL.md":
            names.add(path.parts[1])
        elif (path.parts[0], path.suffix) in {("workflows", ".js"), ("agents", ".md")}:
            names.add(path.stem)
    return {f"{PLUGIN.parent.name}:{name}" for name in names}


class ShippedTree(unittest.TestCase):
    def test_no_tracked_file_under_plugins_is_in_a_tests_folder_or_named_test_underscore_py(self):
        tracked = subprocess.run(["git", "ls-files", "-z", ":(glob)*/plugin/**"], cwd=REPO, capture_output=True, text=True,
                                 check=True).stdout.split("\0")
        tests = [f for f in tracked if f and ("tests" in PurePosixPath(f).parts or fnmatch(PurePosixPath(f).name, "test_*.py"))]
        self.assertEqual(tests, [])

    def test_ships_no_path_alq_review_must_never_ship(self):
        self.assertEqual([f for f in shipped() if f.startswith(NEVER_IN_REVIEW)], [])

    # A file is its path and its bytes: carriers each ship their own module at a path another carrier also uses
    # (lib/settings.ts, hooks/pre-tool-use.ts), and that is not one plugin shipping the other's file.
    def test_ships_no_file_alq_plan_or_alq_build_ships(self):
        def files(plugin: Path) -> set[tuple[str, str]]:
            held = blobs(plugin)
            return {(f, held[f]) for f in content(list(held))}

        theirs = files(REPO / "planner" / "plugin") | files(REPO / "builder" / "plugin")
        self.assertIn("skills/issue-spec/SKILL.md", {f for f, _ in theirs})
        self.assertIn("skills/issue-tackle/SKILL.md", {f for f, _ in theirs})
        self.assertEqual(sorted(theirs & files(PLUGIN)), [])

    def test_every_script_imports_from_a_copy_holding_only_this_plugin(self):
        scripts = [f for f in shipped() if f.endswith(".py")]
        self.assertIn("scripts/gate.py", scripts)
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / PLUGIN.parent.name
            shutil.copytree(PLUGIN, copy, ignore=shutil.ignore_patterns("__pycache__"))
            for script in scripts:
                with self.subTest(script=script):
                    done = subprocess.run([sys.executable, "-c", f"import {Path(script).stem}"],
                                          cwd=(copy / script).parent, capture_output=True, text=True)
                    self.assertEqual(done.returncode, 0, done.stderr)

    def test_no_file_names_a_command_this_plugin_does_not_ship(self):
        files = shipped()
        own = commands(files)
        self.assertIn("reviewer:review-round", own)
        named = {f: set(COMMAND.findall(tracked_text(PLUGIN / f))) - own for f in files}
        self.assertEqual({f: found for f, found in named.items() if found}, {})
