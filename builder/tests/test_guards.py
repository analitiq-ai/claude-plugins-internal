import re
import subprocess
import unittest
from pathlib import Path

from paths import PLUGIN, REPO, tracked_text

# A command as a skill, workflow or agent of one of these plugins is called: `<plugin>:<name>`.
COMMAND = re.compile(r"\balq-(?:review|plan|build):[\w-]+")
# issue-tackle launches review's round once the code is done.
ALLOWED = {"skills/issue-tackle/SKILL.md": {"reviewer:review-round"}}


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
    return {f"{PLUGIN.parent.name}:{name}" for name in names}


def unshipped_commands(allowed: dict[str, set[str]]) -> dict[str, set[str]]:
    """Per file, each command it names that this plugin does not ship and `allowed` does not grant that file."""
    files = shipped()
    own = commands(files)
    named = {f: set(COMMAND.findall(tracked_text(PLUGIN / f))) - own - allowed.get(f, set()) for f in files}
    return {f: found for f, found in named.items() if found}


class Guards(unittest.TestCase):
    """builder requires no other plugin: it names no command it does not ship but review's round."""

    def test_no_file_names_a_command_this_plugin_does_not_ship_but_the_review_round(self):
        self.assertEqual(commands(shipped()), {"builder:issue-tackle", "builder:root-cause-check"})
        self.assertEqual(unshipped_commands(ALLOWED), {})


if __name__ == "__main__":
    unittest.main()
