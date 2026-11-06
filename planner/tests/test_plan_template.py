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

import yaml  # Spec Kit's own dependency

from paths import PLUGIN

DRIVER = PLUGIN / "skills" / "issue-spec" / "scripts"
sys.path.insert(0, str(DRIVER))
import drive_workflow  # noqa: E402

sys.path.insert(0, str(drive_workflow.PLUGIN / "scripts"))
import premise_report  # noqa: E402
import rootcause  # noqa: E402
import settled_design  # noqa: E402

PRESET = drive_workflow.PRESET[0]
WORKFLOW = drive_workflow.WORKFLOW[0]
SPECKIT_RANGE = ">=1.1.3,<1.2.0"


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


def workflow() -> dict:
    return yaml.safe_load((WORKFLOW / "workflow.yml").read_text())


def nested(steps: list) -> list:
    """Every step of `steps`, each followed by the steps its `then`, `else` or `steps` hold."""
    return [one for step in steps
            for one in [step, *nested(step.get("then", []) + step.get("else", []) + step.get("steps", []))]]


def top_level(step_id: str) -> dict:
    [step] = [step for step in workflow()["steps"] if step["id"] == step_id]
    return step


class CheckLoop(unittest.TestCase):
    """The plan check runs after critique as one do-while loop of planner's own steps (contracts/workflow-steps.md)."""

    def test_the_tasks_command_runs_only_inside_the_check_loop(self):
        ids = [step["id"] for step in workflow()["steps"]]
        self.assertEqual(ids[ids.index("to-review-critique") + 1:], ["to-adr-check"])
        tasks = [step["id"] for step in nested(workflow()["steps"]) if step.get("command") == "speckit.tasks"]
        self.assertEqual(tasks, ["adr-tasks"])
        loop = top_level("to-adr-check")["then"][0]
        self.assertIn("adr-tasks", [step["id"] for step in nested(loop["steps"])])

    def test_the_check_block_holds_the_loop_then_the_rounds_stop(self):
        block = top_level("to-adr-check")
        self.assertEqual(block["type"], "if")
        self.assertEqual(block["condition"], top_level("to-plan")["condition"])
        loop, out = block["then"]
        self.assertEqual((loop["id"], loop["type"], loop["max_iterations"]), ("adr-check", "do-while", 100))
        self.assertEqual(loop["condition"], "{{ steps.adr-report.output.data.again }}")
        self.assertEqual((out["id"], out["condition"]), ("adr-out-of-rounds", "{{ steps.adr-report.output.data.again }}"))
        [rounds] = out["then"]
        self.assertEqual(rounds["id"], "adr-rounds")
        self.assertIn('adr_check.ts" stop rounds', rounds["run"])

    def test_the_loops_steps_run_in_order_each_continuing_on_error_but_settled_design_clear_and_report(self):
        steps = top_level("to-adr-check")["then"][0]["steps"]
        self.assertEqual([step["id"] for step in steps], [
            "adr-settled-design", "adr-clear", "adr-touches", "adr-tasks-due", "adr-tasks-writing", "adr-stories",
            "adr-ask", "adr-judging", "adr-deciding", "adr-report"])
        flat = []
        for step in steps:
            flat.extend(step["then"] if step["type"] == "if" else [step])
        continuing = [step["id"] for step in flat if step.get("continue_on_error")]
        self.assertEqual(continuing, ["adr-touches", "adr-tasks-due", "adr-tasks", "adr-tasks-written", "adr-stories",
                                      "adr-ask", "adr-judge", "adr-decide"])
        writing = steps[4]
        self.assertEqual(writing["condition"], "{{ steps.adr-tasks-due.output.data.due }}")
        self.assertEqual([step["id"] for step in writing["then"]], ["adr-tasks", "adr-tasks-written"])
        self.assertEqual(writing["then"][0]["command"], "speckit.tasks")
        self.assertEqual(steps[-1]["output_format"], "json")

    def test_the_driver_reports_as_the_checks_every_step_that_fails_the_run_but_settled_design(self):
        steps = nested(top_level("to-adr-check")["then"][0]["steps"])
        stopping = [step["id"] for step in steps if step.get("type") != "if" and not step.get("continue_on_error")]
        [rounds] = top_level("to-adr-check")["then"][1]["then"]
        self.assertEqual(stopping[0], "adr-settled-design")
        self.assertEqual(drive_workflow.ADR_STOP_STEPS, (*stopping[1:], rounds["id"]))

    def test_the_workflow_and_the_preset_require_spec_kit_from_1_1_3_below_1_2(self):
        self.assertEqual(workflow()["requires"]["speckit_version"], SPECKIT_RANGE)
        self.assertEqual(yaml.safe_load((PRESET / "preset.yml").read_text())["requires"]["speckit_version"], SPECKIT_RANGE)


class TasksCommand(unittest.TestCase):
    """The tasks command names each file a task touches as a path the check can read (R5)."""

    def test_the_preset_appends_to_the_tasks_command(self):
        provided = yaml.safe_load((PRESET / "preset.yml").read_text())["provides"]["templates"]
        [tasks] = [one for one in provided if one["name"] == "speckit.tasks"]
        self.assertEqual((tasks["type"], tasks["file"], tasks["strategy"]), ("command", "commands/speckit.tasks.md", "append"))

    def test_the_installed_tasks_command_carries_the_presets_path_rule(self):
        self.assertTrue(installed_skill_carries("speckit.tasks"), "speckit-tasks SKILL.md lacks the settled-design preset")


if __name__ == "__main__":
    unittest.main()
