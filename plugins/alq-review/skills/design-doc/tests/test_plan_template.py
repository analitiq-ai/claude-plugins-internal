"""The settled-design preset teaches the format the settled-design check reads; these pin the two together."""
import json
import os
import re
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

DRIVER = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(DRIVER))
import drive_workflow  # noqa: E402

sys.path.insert(0, str(drive_workflow.PLUGIN / "scripts"))
import settled_design  # noqa: E402

PRESET = drive_workflow.PRESET[0]


def setUpModule():
    """A new Claude Code Spec Kit project with the preset installed the way a design-doc start installs it."""
    global PROJECT
    PROJECT = tempfile.TemporaryDirectory()
    subprocess.run(["specify", "init", "--here", "--integration", "claude", "--script", "sh", "--ignore-agent-tools",
                    "--force"], cwd=PROJECT.name, check=True, capture_output=True, text=True)
    cwd = os.getcwd()
    os.chdir(PROJECT.name)
    try:
        drive_workflow.install()
    finally:
        os.chdir(cwd)


def tearDownModule():
    PROJECT.cleanup()


def composed_plan() -> str:
    """plan.md as speckit.plan's setup script writes it."""
    root = Path(PROJECT.name)
    feature = root / "specs" / "001-demo"
    feature.mkdir(parents=True, exist_ok=True)
    (feature / "spec.md").write_text("# Spec\n")
    (root / ".specify" / "feature.json").write_text(json.dumps({"feature_directory": str(feature)}))
    subprocess.run(["bash", ".specify/scripts/bash/setup-plan.sh", "--json"], cwd=root, check=True,
                   capture_output=True, text=True)
    return (feature / "plan.md").read_text()


class PlanTemplate(unittest.TestCase):
    def test_the_composed_plan_templates_example_passes_the_check(self):
        plan = composed_plan()
        example = re.search(r"^( {4}## R1:.*?)^-->", plan, re.MULTILINE | re.DOTALL)
        self.assertIsNotNone(example, "the composed plan template has no indented research.md example")
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "plan.md").write_text(plan)
            (Path(tmp) / "research.md").write_text(textwrap.dedent(example[1]))
            self.assertEqual(settled_design.problems(Path(tmp)), [])

    def test_the_installed_plan_command_carries_the_presets_research_format(self):
        addition = (PRESET / "commands" / "speckit.plan.md").read_text().split("---\n", 2)[2].strip()
        skill = (Path(PROJECT.name) / ".claude" / "skills" / "speckit-plan" / "SKILL.md").read_text()
        self.assertTrue(skill.rstrip().endswith(addition), "speckit-plan SKILL.md lacks the settled-design preset")


if __name__ == "__main__":
    unittest.main()
