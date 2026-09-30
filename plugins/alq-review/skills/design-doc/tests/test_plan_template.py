"""The settled-design preset teaches the format the settled-design check reads; these pin the two together."""
import json
import re
import shutil
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(REPO / ".claude" / "plugins" / "alq-review" / "scripts"))

import settled_design  # noqa: E402

PRESET = REPO / ".specify" / "presets" / "settled-design"


def composed_plan() -> str:
    """plan.md as speckit.plan's setup script writes it, from a copy of this repo's .specify."""
    with tempfile.TemporaryDirectory() as tmp:
        shutil.copytree(REPO / ".specify", Path(tmp) / ".specify",
                        ignore=shutil.ignore_patterns("feature.json", "runs", ".cache"))
        feature = Path(tmp) / "specs" / "001-demo"
        feature.mkdir(parents=True)
        (feature / "spec.md").write_text("# Spec\n")
        (Path(tmp) / ".specify" / "feature.json").write_text(json.dumps({"feature_directory": str(feature)}))
        subprocess.run(["bash", ".specify/scripts/bash/setup-plan.sh", "--json"], cwd=tmp, check=True,
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
        skill = (REPO / ".claude" / "skills" / "speckit-plan" / "SKILL.md").read_text()
        self.assertTrue(skill.rstrip().endswith(addition), "speckit-plan SKILL.md lacks the settled-design preset")


if __name__ == "__main__":
    unittest.main()
