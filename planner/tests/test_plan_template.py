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


def workflow_yml():
    return yaml.safe_load((WORKFLOW[0] / "workflow.yml").read_text())


def top_level_steps():
    return {step["id"]: step for step in workflow_yml()["steps"]}


AGAIN = "{{ steps.adr-report.output.data.again }}"
ADR_CHECK = 'node "$PLANNER_ROOT/scripts/adr_check.ts"'
RUN = '".specify/workflows/runs/{{ context.run_id }}"'
INTEGRATION = "{{ inputs.integration }}"


def follow(doc):
    return (f"Follow .specify/workflows/issue-spec/{doc} for spec folder {{{{ inputs.spec_dir }}}}, run folder "
            ".specify/workflows/runs/{{ context.run_id }}.")


# contracts/workflow-steps.md's round, each step's settings but the ifs' bodies.
ROUND = {
    "adr-settled-design": {"type": "shell",
                           "run": 'set -eu\npython3 "$PLANNER_ROOT/scripts/settled_design.py" "$SPECIFY_FEATURE_DIRECTORY"\n'},
    "adr-clear": {"type": "shell", "timeout": 60, "run": f'{ADR_CHECK} clear "$SPECIFY_FEATURE_DIRECTORY" {RUN}'},
    "adr-touches": {"type": "prompt", "integration": INTEGRATION, "timeout": 1800, "continue_on_error": True,
                    "prompt": follow("adr-touches.md")},
    "adr-tasks-due": {"type": "shell", "output_format": "json", "timeout": 60, "continue_on_error": True,
                      "run": f'{ADR_CHECK} tasks-due "$SPECIFY_FEATURE_DIRECTORY" {RUN}'},
    "adr-tasks-writing": {"type": "if", "condition": "{{ steps.adr-tasks-due.output.data.due }}"},
    "adr-tasks": {"command": "speckit.tasks", "integration": INTEGRATION, "continue_on_error": True},
    "adr-tasks-written": {"type": "shell", "timeout": 60, "continue_on_error": True,
                          "run": f'{ADR_CHECK} tasks-written {RUN} "{{{{ steps.adr-tasks.output.exit_code }}}}"'},
    "adr-stories": {"type": "shell", "timeout": 300, "continue_on_error": True,
                    "run": f'{ADR_CHECK} stories "$ISSUE" "{{{{ inputs.kind }}}}" "$SPECIFY_FEATURE_DIRECTORY" {RUN}'},
    "adr-ask": {"type": "shell", "output_format": "json", "timeout": 1800, "continue_on_error": True,
                "run": f'{ADR_CHECK} ask "$SPECIFY_FEATURE_DIRECTORY" {RUN} "{{{{ steps.adr-touches.output.exit_code }}}}"'},
    "adr-judging": {"type": "if", "condition": "{{ steps.adr-ask.output.data.judge }}"},
    "adr-judge": {"type": "prompt", "integration": INTEGRATION, "timeout": 1800, "continue_on_error": True,
                  "prompt": follow("adr-judge.md")},
    "adr-deciding": {"type": "if", "condition": "{{ steps.adr-ask.output.data.decide }}"},
    "adr-decide": {"type": "shell", "timeout": 1800, "continue_on_error": True,
                   "run": (f'{ADR_CHECK} decide "$SPECIFY_FEATURE_DIRECTORY" {RUN} '
                           '"{{ steps.adr-ask.output.data.asked }}" "{{ steps.adr-judge.output.exit_code }}"')},
    "adr-report": {"type": "shell", "output_format": "json", "timeout": 60,
                   "run": f'{ADR_CHECK} report "$SPECIFY_FEATURE_DIRECTORY" {RUN}'},
}


class AdrCheckLoop(unittest.TestCase):
    """The ADR check is one do-while loop after the critique gate, in place of the tasks step; report's `again` asks
    for the next round."""

    def check(self):
        block = top_level_steps().get("to-adr-check")
        self.assertIsNotNone(block, "workflow.yml has no to-adr-check block")
        self.assertEqual([step["id"] for step in block["then"]], ["adr-check", "adr-out-of-rounds"])
        return block

    def round_steps(self):
        """The loop's steps in order, each `if` followed by the steps it holds."""
        def walk(steps):
            for step in steps:
                yield step
                yield from walk(step.get("then", []))
        return list(walk(self.check()["then"][0]["steps"]))

    def test_the_check_replaces_to_tasks_right_after_the_critique_gate(self):
        ids = [step["id"] for step in workflow_yml()["steps"]]
        self.assertNotIn("to-tasks", ids)
        self.assertIn("to-review-critique", ids)
        self.assertEqual(ids[ids.index("to-review-critique") + 1:], ["to-adr-check"])
        steps = top_level_steps()
        self.assertEqual(self.check()["condition"], steps["to-review-critique"]["condition"])

    def test_the_check_loops_while_report_asks_again_then_names_a_loop_out_of_rounds(self):
        loop, out_of_rounds = self.check()["then"]
        self.assertEqual((loop["type"], loop["max_iterations"], loop["condition"]), ("do-while", 100, AGAIN))
        self.assertEqual((out_of_rounds["type"], out_of_rounds["condition"]), ("if", AGAIN))
        [rounds] = out_of_rounds["then"]
        self.assertEqual(rounds,
                         {"id": "adr-rounds", "type": "shell", "timeout": 60,
                          "run": f'{ADR_CHECK} stop rounds "{{{{ inputs.kind }}}}" "$ISSUE" "$SPECIFY_FEATURE_DIRECTORY"'})

    def test_a_round_runs_its_steps_in_order_and_ends_with_report(self):
        self.assertEqual([step["id"] for step in self.round_steps()],
                         ["adr-settled-design", "adr-clear", "adr-touches", "adr-tasks-due", "adr-tasks-writing",
                          "adr-tasks", "adr-tasks-written", "adr-stories", "adr-ask", "adr-judging", "adr-judge",
                          "adr-deciding", "adr-decide", "adr-report"])
        self.assertEqual(self.check()["then"][0]["steps"][-1]["id"], "adr-report")

    def test_the_tasks_command_and_its_record_run_only_in_a_round_due_to_write_tasks_md(self):
        writing = {step["id"]: step for step in self.check()["then"][0]["steps"]}["adr-tasks-writing"]
        self.assertEqual(writing["condition"], "{{ steps.adr-tasks-due.output.data.due }}")
        self.assertEqual([step["id"] for step in writing["then"]], ["adr-tasks", "adr-tasks-written"])

    def test_every_step_from_touches_to_decide_continues_on_error_and_settled_design_clear_and_report_do_not(self):
        continues = [step["id"] for step in self.round_steps()
                     if step.get("type") != "if" and step.get("continue_on_error") is True]
        self.assertEqual(continues, ["adr-touches", "adr-tasks-due", "adr-tasks", "adr-tasks-written", "adr-stories",
                                     "adr-ask", "adr-judge", "adr-decide"])
        for step in self.round_steps():
            if step["id"] in ("adr-settled-design", "adr-clear", "adr-report"):
                with self.subTest(step=step["id"]):
                    self.assertNotIn("continue_on_error", step)

    def test_each_step_of_the_round_has_the_settings_the_contract_gives(self):
        for step in self.round_steps():
            with self.subTest(step=step["id"]):
                given = {key: value for key, value in step.items() if key not in ("id", "then")}
                self.assertEqual(given, ROUND.get(step["id"]))

    def test_each_round_starts_with_the_settled_design_check(self):
        settled = self.round_steps()[0]
        self.assertEqual((settled["id"], settled["type"]), ("adr-settled-design", "shell"))
        self.assertIn('python3 "$PLANNER_ROOT/scripts/settled_design.py" "$SPECIFY_FEATURE_DIRECTORY"', settled["run"])

    def test_the_workflow_and_the_preset_require_spec_kit_1_1_3_and_below_1_2(self):
        for name, requires in (("workflow.yml", workflow_yml()["requires"]),
                               ("preset.yml", yaml.safe_load((PRESET / "preset.yml").read_text())["requires"])):
            with self.subTest(file=name):
                self.assertEqual(requires["speckit_version"], ">=1.1.3,<1.2.0")


class TouchesStep(unittest.TestCase):

    def test_the_touches_step_writes_one_literal_path_per_file_the_plan_touches_and_nothing_else(self):
        doc = WORKFLOW[0] / "adr-touches.md"
        self.assertTrue(doc.is_file(), f"{doc} does not exist")
        text = " ".join(doc.read_text().split())
        for said in ("Read `<spec folder>/plan.md`", "write `<run folder>/touches.json`", '{"v": 1, "paths": ['):
            with self.subTest(said=said):
                self.assertIn(said, text)
        for rule in (r"one literal path per file", r"creat\w*, chang\w* or delet\w*", r"no glob", r"no brace group",
                     r"no other file"):
            with self.subTest(rule=rule):
                self.assertRegex(text, re.compile(rule, re.IGNORECASE))
        installed = Path(PROJECT.name) / WORKFLOW[1] / "adr-touches.md"
        self.assertEqual(installed.read_text(), doc.read_text())

    def test_neither_the_plan_step_nor_the_plan_command_says_anything_of_touches_json(self):
        [plan] = top_level_steps()["to-plan"]["then"]
        self.assertEqual(plan["id"], "plan")
        self.assertNotIn("touches.json", plan["input"]["args"])
        self.assertNotIn("touches.json", (PRESET / "commands" / "speckit.plan.md").read_text())

    def test_the_plan_template_has_no_touches_section(self):
        self.assertEqual([line for line in composed_plan().splitlines() if line.startswith("## Touches")], [])


class TasksCommand(unittest.TestCase):
    """The check reads a task's paths from its backticked spans, so the tasks command writes them as literal paths."""

    def test_the_preset_appends_its_tasks_command_to_spec_kits(self):
        provided = yaml.safe_load((PRESET / "preset.yml").read_text())["provides"]["templates"]
        tasks = [entry for entry in provided if entry.get("name") == "speckit.tasks"]
        self.assertEqual([(entry["type"], entry["file"], entry["strategy"]) for entry in tasks],
                         [("command", "commands/speckit.tasks.md", "append")])

    def test_the_tasks_command_names_each_file_a_task_touches_as_one_literal_path_per_backtick_span(self):
        doc = PRESET / "commands" / "speckit.tasks.md"
        self.assertTrue(doc.is_file(), f"{doc} does not exist")
        text = " ".join(doc.read_text().split())
        for rule in (r"each file a task creates, changes or deletes as one literal path per backtick span", r"no glob",
                     r"no brace group", r"a folder is not a path, so name each file in it the task touches"):
            with self.subTest(rule=rule):
                self.assertRegex(text, re.compile(rule, re.IGNORECASE))


if __name__ == "__main__":
    unittest.main()
