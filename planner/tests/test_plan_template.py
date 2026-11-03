"""The settled-design preset teaches the formats planner's checks read; these pin each format to its check."""
import json
import os
import re
import subprocess
import sys
import tempfile
import textwrap
import unittest
from pathlib import Path

import yaml
from paths import PLUGIN

DRIVER = PLUGIN / "skills" / "issue-spec" / "scripts"
sys.path.insert(0, str(DRIVER))
import drive_workflow  # noqa: E402

sys.path.insert(0, str(drive_workflow.PLUGIN / "scripts"))
import premise_report  # noqa: E402
import rootcause  # noqa: E402
import settled_design  # noqa: E402

PRESET = drive_workflow.PRESET[0]
WORKFLOW = drive_workflow.WORKFLOW


def setUpModule():
    """A new Claude Code Spec Kit project with the preset installed the way an issue-spec start installs it."""
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
    feature = root / "specs" / "7-demo"
    feature.mkdir(parents=True, exist_ok=True)
    (feature / "spec.md").write_text("# Spec\n")
    (root / ".specify" / "feature.json").write_text(json.dumps({"feature_directory": str(feature)}))
    subprocess.run(["bash", ".specify/scripts/bash/setup-plan.sh", "--json"], cwd=root, check=True,
                   capture_output=True, text=True)
    return (feature / "plan.md").read_text()


def composed_spec_template() -> str:
    """The spec template as speckit.specify resolves it."""
    return subprocess.run(["bash", ".specify/scripts/bash/resolve-template.sh", "spec-template"], cwd=PROJECT.name,
                          check=True, capture_output=True, text=True).stdout


def installed_skill_carries(command: str) -> bool:
    addition = (PRESET / "commands" / f"{command}.md").read_text().split("---\n", 2)[2].strip()
    skill = Path(PROJECT.name) / ".claude" / "skills" / command.replace(".", "-") / "SKILL.md"
    return skill.read_text().rstrip().endswith(addition)


class SpecTemplate(unittest.TestCase):
    def test_the_composed_spec_template_has_the_premise_and_root_cause_sections(self):
        headings = [line for line in composed_spec_template().splitlines() if line.startswith("## ")]
        self.assertEqual(headings[-2:], ["## Why this is worth doing", rootcause.HEADING])
        self.assertIn("## Requirements *(mandatory)*", headings)

    def test_the_composed_spec_template_opens_with_the_codeworks_block_planners_writer_sets(self):
        """spec.md starts as a copy of the composed template, so only a block at its top is spec.md's front matter
        (planner ADR-0008 d1)."""
        lines = composed_spec_template().splitlines()
        self.assertEqual(lines[0], "---", lines[:3])
        self.assertIn("codeworks:", lines[1:lines.index("---", 1)])

    def test_the_template_asks_for_the_reports_questions_under_its_headings(self):
        asked = [line[4:] for line in composed_spec_template().splitlines() if line.startswith("### ")
                 and line[4:] in premise_report.QUESTIONS]
        self.assertEqual(asked, list(premise_report.QUESTIONS))

    def test_the_template_as_shipped_fails_both_checks_and_passes_them_once_filled(self):
        template = composed_spec_template()
        self.assertEqual(len(premise_report.spec_problems(template)), 2 * len(premise_report.QUESTIONS))
        self.assertEqual(len(rootcause.problems(template, None)), 1)
        filled = re.sub(r"^(Answer|Source|Observed): \[.*\]$",
                        lambda line: f"{line[1]}: {'code: scripts/gate.py' if line[1] == 'Source' else 'observed: a KeyError'}",
                        template, flags=re.MULTILINE)
        self.assertEqual(premise_report.spec_problems(filled), [])
        self.assertEqual(rootcause.problems(filled, None), [])

    def test_the_template_spells_the_root_cause_sentences_as_their_readers_read_them(self):
        """spec_facts.ts reads `hypothesis` only from the sentence the vocabulary spells, so a template teaching
        another wording would have every guessed trace read `anchored`."""
        for sentence in (rootcause.NOT_A_DEFECT, rootcause.HYPOTHESIS):
            with self.subTest(sentence=sentence):
                self.assertIn(f"`{sentence}`", composed_spec_template())

    def test_the_installed_specify_command_says_where_the_premise_answers_come_from(self):
        self.assertTrue(installed_skill_carries("speckit.specify"), "speckit-specify lacks the settled-design preset")


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
        self.assertTrue(installed_skill_carries("speckit.plan"), "speckit-plan SKILL.md lacks the settled-design preset")


class TouchesStep(unittest.TestCase):
    def plan_steps(self):
        return {step["id"]: step for step in yaml.safe_load((WORKFLOW[0] / "workflow.yml").read_text())["steps"]}

    def test_the_plan_check_clears_touches_json_then_runs_the_touches_step_before_ask(self):
        """A resume of a run stopped in the block re-runs it from its first step (specify 1.0.x), so a touches step that
        fails must find no file from the last run."""
        block = self.plan_steps().get("to-adr-plan")
        self.assertIsNotNone(block, "workflow.yml has no to-adr-plan block")
        clear, touches, ask = block["then"][:3]
        self.assertEqual((clear["id"], clear["type"]), ("adr-plan-clear", "shell"))
        self.assertIn('rm -f ".specify/workflows/runs/{{ context.run_id }}/touches.json"', clear["run"])
        self.assertEqual((touches["id"], touches["type"]), ("adr-plan-touches", "prompt"))
        self.assertIn("Follow .specify/workflows/issue-spec/adr-touches.md", touches["prompt"])
        self.assertIn("run folder .specify/workflows/runs/{{ context.run_id }}", touches["prompt"])
        self.assertEqual(ask["id"], "adr-plan-ask")

    def test_the_touches_step_writes_one_literal_path_per_file_the_plan_touches_and_nothing_else(self):
        doc = WORKFLOW[0] / "adr-touches.md"
        self.assertTrue(doc.is_file(), f"{doc} does not exist")
        text = " ".join(doc.read_text().split())
        for said in ("Read `<spec folder>/plan.md`", "write `<run folder>/touches.json`", '{"v": 1, "paths": ['):
            with self.subTest(said=said):
                self.assertIn(said, text)
        for rule in (r"one literal path per file", r"creat\w*, chang\w* or delet\w*", r"no glob", r"no brace group",
                     r"no trailing `?/`?", r"no `?\.\.`?", r"no other file"):
            with self.subTest(rule=rule):
                self.assertRegex(text, re.compile(rule, re.IGNORECASE))
        installed = Path(PROJECT.name) / WORKFLOW[1] / "adr-touches.md"
        self.assertEqual(installed.read_text(), doc.read_text())

    def test_neither_the_plan_step_nor_the_plan_command_says_anything_of_touches_json(self):
        [plan] = self.plan_steps()["to-plan"]["then"]
        self.assertEqual(plan["id"], "plan")
        self.assertNotIn("touches.json", plan["input"]["args"])
        self.assertNotIn("touches.json", (PRESET / "commands" / "speckit.plan.md").read_text())

    def test_the_plan_template_has_no_touches_section(self):
        self.assertEqual([line for line in composed_plan().splitlines() if line.startswith("## Touches")], [])


if __name__ == "__main__":
    unittest.main()
