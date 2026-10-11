import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from paths import PLUGIN, REPO

# A command as a skill, workflow or agent of one of these plugins is called: `<plugin>:<name>`.
COMMAND = re.compile(r"\balq-(?:review|plan|build):[\w-]+")


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


def unshipped_commands(allowed: dict[str, set[str]]) -> dict[str, set[str]]:
    """Per file, each command it names that this plugin does not ship and `allowed` does not grant that file."""
    files = shipped()
    own = commands(files)
    named = {f: set(COMMAND.findall((PLUGIN / f).read_text())) - own - allowed.get(f, set()) for f in files}
    return {f: found for f, found in named.items() if found}


class Guards(unittest.TestCase):
    """alq-plan requires no other plugin: it loads alone and names no command it does not ship."""

    def test_every_script_imports_from_a_copy_holding_only_this_plugin(self):
        scripts = [f for f in shipped() if f.endswith(".py")]
        self.assertIn("skills/issue-spec/scripts/drive_workflow.py", scripts)
        with tempfile.TemporaryDirectory() as tmp:
            copy = Path(tmp) / PLUGIN.name
            shutil.copytree(PLUGIN, copy, ignore=shutil.ignore_patterns("__pycache__"))
            for script in scripts:
                with self.subTest(script=script):
                    done = subprocess.run([sys.executable, "-c", f"import {Path(script).stem}"],
                                          cwd=(copy / script).parent, capture_output=True, text=True)
                    self.assertEqual(done.returncode, 0, done.stderr)

    def test_no_file_names_a_command_this_plugin_does_not_ship(self):
        self.assertIn("alq-plan:issue-spec", commands(shipped()))
        self.assertEqual(unshipped_commands({}), {})


if __name__ == "__main__":
    unittest.main()
