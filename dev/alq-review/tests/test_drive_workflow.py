"""drive_workflow.py against the real specify CLI, in a throwaway project.

A rescope run pauses at grill before any agent step. A new-spec run reaches `specify`, which gets a
stand-in `claude` that writes the spec the test names.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from paths import PLUGIN
from test_premise_report import report as premise_report_text
from test_rootcause import SPEC as SPEC_WITH
from test_speclocation import Issue

import yaml  # Spec Kit's own dependency

import speclocation
from premise_report import NO_SPEC, NOT_WORTH_DOING, WRITE

SKILL = PLUGIN / "skills" / "design-doc"
DRIVER = SKILL / "scripts" / "drive_workflow.py"
SPECKIT = PLUGIN / "speckit"
sys.path.insert(0, str(DRIVER.parent))
import drive_workflow  # noqa: E402

SPEC_DIR = "specs/001-demo"
TRACED, UNTRACED = SPEC_WITH.format(section="Observed: test_gate fails on main."), "# Demo\n\nSettled.\n"
SETTLED = SPEC_WITH.format(section="Not a defect report.")


def drive(root, env, *args):
    proc = subprocess.run([sys.executable, str(DRIVER), *args], cwd=root, env=env, capture_output=True, text=True)
    return proc, json.loads(proc.stdout) if proc.returncode == 0 else None


class Project:
    def __init__(self, spec_text=SETTLED):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        # A Spec Kit project with neither the plugin's preset nor its workflow installed.
        (self.root / ".specify" / "workflows").mkdir(parents=True)
        (self.root / SPEC_DIR).mkdir(parents=True)
        (self.root / SPEC_DIR / "spec.md").write_text(spec_text)

    def drive(self, *args):
        return drive(self.root, None, *args)

    def spec_file(self, text):
        path = self.root / "spec.txt"
        path.write_text(text)
        return str(path)

    def runs(self):
        runs = self.root / ".specify" / "workflows" / "runs"
        return sorted(runs.iterdir()) if runs.is_dir() else []

    def close(self):
        self._tmp.cleanup()


class Rescope(unittest.TestCase):
    def setUp(self):
        self.project = Project()
        self.addCleanup(self.project.close)

    def test_a_rescope_start_pauses_at_grill_on_the_given_folder(self):
        proc, report = self.project.drive("start", self.project.spec_file("RESCOPE x"), SPEC_DIR)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((report["status"], report["step"]), ("paused", "grill"))
        feature = json.loads((self.project.root / ".specify" / "feature.json").read_text())
        self.assertEqual(feature["feature_directory"], SPEC_DIR)

    def test_an_empty_folder_stops_before_the_workflow_starts(self):
        proc, _ = self.project.drive("start", self.project.spec_file("RESCOPE x"), "")
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(self.project.runs(), [])

    def test_an_empty_spec_stops_before_the_workflow_starts(self):
        proc, _ = self.project.drive("start", self.project.spec_file(" \n"), SPEC_DIR)
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(self.project.runs(), [])

    def test_spec_text_reaches_the_run_verbatim_and_runs_nothing(self):
        text = "RESCOPE `touch PWNED1` $(touch PWNED2) a=b 'q' \"dq\""
        proc, report = self.project.drive("start", self.project.spec_file(text), SPEC_DIR)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        run = self.project.root / ".specify" / "workflows" / "runs" / report["run_id"]
        self.assertEqual(json.loads((run / "inputs.json").read_text())["inputs"]["spec"], text)
        self.assertEqual(list(self.project.root.glob("PWNED*")), [])

    def test_a_rejected_folder_reports_the_steps_own_error(self):
        bad = "specs/x'; touch PWNED; echo '"
        proc, report = self.project.drive("start", self.project.spec_file("RESCOPE x"), bad)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((report["status"], report["step"]), ("failed", "select-spec"))
        self.assertIn("spec_dir must be specs/<feature>", report["stderr"])
        self.assertFalse(report["open_markers"])
        self.assertFalse((self.project.root / "PWNED").exists())


def workflow_steps(steps=None):
    """Every step of the plugin's workflow, the ones nested in an `if` included."""
    if steps is None:
        steps = yaml.safe_load((SPECKIT / "workflows" / "design-doc" / "workflow.yml").read_text())["steps"]
    for step in steps:
        yield step
        yield from workflow_steps(step.get("then", []) + step.get("else", []))


def same_files(source: Path, installed: Path) -> bool:
    return all((installed / f.relative_to(source)).is_file()
               and (installed / f.relative_to(source)).read_bytes() == f.read_bytes()
               for f in source.rglob("*") if f.is_file())


class Install(unittest.TestCase):
    """A start installs the plugin's settled-design preset and design-doc workflow into the project it runs in."""

    def setUp(self):
        self.project = Project()
        self.addCleanup(self.project.close)
        self.preset = self.project.root / ".specify" / "presets" / "settled-design"
        self.workflow = self.project.root / ".specify" / "workflows" / "design-doc"

    def start(self):
        proc, report = self.project.drive("start", self.project.spec_file("RESCOPE x"), SPEC_DIR)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((report["status"], report["step"]), ("paused", "grill"))

    def test_a_project_without_them_gets_both(self):
        self.start()
        self.assertTrue(same_files(SPECKIT / "presets" / "settled-design", self.preset))
        self.assertTrue(same_files(SPECKIT / "workflows" / "design-doc", self.workflow))

    def test_an_installed_copy_that_differs_from_the_plugins_is_replaced(self):
        self.start()
        (self.preset / "templates" / "plan-template.md").write_text("stale\n")
        (self.workflow / "critique_report.py").write_text("stale\n")
        self.start()
        self.assertTrue(same_files(SPECKIT / "presets" / "settled-design", self.preset))
        self.assertTrue(same_files(SPECKIT / "workflows" / "design-doc", self.workflow))

    def test_the_settled_design_step_runs_the_check_under_the_root_specify_runs_with(self):
        """The step runs in the project, which has no copy of alq-review's scripts; the driver says where they are."""
        [step] = [s for s in workflow_steps() if s["id"] == "settled-design"]
        self.assertIn('python3 "$ALQ_REVIEW_ROOT/scripts/settled_design.py" "$dir"', step["run"])
        with mock.patch.object(drive_workflow.subprocess, "run") as run:
            drive_workflow._specify(["resume", "r1"], {})
        root = Path(run.call_args.kwargs["env"]["ALQ_REVIEW_ROOT"])
        self.assertTrue((root / "scripts" / "settled_design.py").is_file())


class AfterGrill(unittest.TestCase):
    def approved(self, spec_text):
        project = Project(spec_text)
        self.addCleanup(project.close)
        _, started = project.drive("start", project.spec_file("RESCOPE x"), SPEC_DIR)
        proc, report = project.drive("resume", started["run_id"], "grill_verdict=approve")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return report

    def test_resuming_past_grill_with_markers_left_says_so(self):
        report = self.approved("# Demo\n\n[NEEDS CLARIFICATION: which store?]\n")
        self.assertEqual((report["status"], report["step"]), ("failed", "no-open-markers"))
        self.assertTrue(report["open_markers"])

    def test_a_rescoped_spec_with_no_labelled_root_cause_stops_the_run(self):
        report = self.approved(UNTRACED)
        self.assertEqual((report["status"], report["step"]), ("failed", "root-cause-of-rescope"))
        self.assertIn("## Root cause", report["stderr"])


class Premise(Issue):
    """A new spec: the run pauses at `premise` first, and the user's pick decides whether a spec is written."""
    NEW = "specs/001-new"

    def setUp(self):
        super().setUp()
        self.comments()
        (self.root / ".specify" / "workflows").mkdir(parents=True)
        # Stands in for the agent `specify` dispatches to: writes $CLAUDE_SPEC as the new spec, keeps its prompt.
        claude = Path(self.tmp.name) / "bin" / "claude"
        claude.write_text('#!/bin/sh\nprintf "%s\\n" "$2" >> "$CLAUDE_LOG"\nmkdir -p ' + self.NEW + '\n'
                          'printf "%s" "$CLAUDE_SPEC" > ' + self.NEW + '/spec.md\n'
                          'printf \'{"feature_directory": "' + self.NEW + '"}\' > .specify/feature.json\n')
        claude.chmod(0o755)
        self.env.update(CLAUDE_LOG=str(Path(self.tmp.name) / "claude.log"), CLAUDE_SPEC=TRACED)
        spec_file = Path(self.tmp.name) / "spec.txt"
        spec_file.write_text("https://github.test/acme/demo/issues/1\n# Demo\n")
        proc, self.started = drive(self.root, self.env, "start", str(spec_file))
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.report_path = f".specify/workflows/runs/{self.started['run_id']}/premise-report.md"

    def resume(self, verdict, report_text=None):
        if report_text is not None:
            (self.root / self.report_path).write_text(report_text)
        proc, report = drive(self.root, self.env, "resume", self.started["run_id"], verdict)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return report

    def prompts(self):
        log = Path(self.env["CLAUDE_LOG"])
        return log.read_text() if log.exists() else ""

    def posted(self):
        path = Path(self.env["GH_POSTED"])
        return path.read_text() if path.exists() else None

    def test_a_new_spec_pauses_at_premise_before_anything_is_written(self):
        self.assertEqual((self.started["status"], self.started["step"]), ("paused", "premise"))
        self.assertEqual(self.prompts(), "")

    def test_a_stop_pick_posts_its_comment_and_ends_the_run_with_no_spec(self):
        for pick, render in ((NO_SPEC, speclocation.render_none),
                             (NOT_WORTH_DOING, speclocation.render_not_worth_doing)):
            with self.subTest(pick):
                self.setUp()
                report = self.resume(f"premise_verdict={pick}", premise_report_text(
                    pick, rests_on="needs-spec", reason="a typo, fixed by the request", wrong="no"))
                self.assertEqual(report["status"], "completed", report)
                self.assertEqual(self.posted(), render("a typo, fixed by the request"))
                self.assertEqual(self.prompts(), "")
                self.assertFalse((self.root / "specs").exists())

    def test_writing_the_spec_hands_specify_the_report_and_pauses_at_grill(self):
        report = self.resume(f"premise_verdict={WRITE}", premise_report_text())
        self.assertEqual((report["status"], report["step"]), ("paused", "grill"), report)
        self.assertEqual(self.prompts().rstrip().splitlines()[-1], f"Premise report: {self.report_path}")
        self.assertIsNone(self.posted())

    def test_a_pick_that_is_none_of_the_three_outcomes_fails_at_the_pause(self):
        report = self.resume("premise_verdict=approve", premise_report_text())
        self.assertEqual((report["status"], report["step"]), ("failed", "premise"), report)

    def test_a_report_that_is_incomplete_or_was_never_written_stops_the_run(self):
        for text in (premise_report_text(answers={}), None):
            with self.subTest(written=text is not None):
                self.setUp()
                report = self.resume(f"premise_verdict={WRITE}", text)
                self.assertEqual((report["status"], report["step"]), ("failed", "premise-report"), report)
                self.assertIn("Next step:", report["stderr"])
                self.assertEqual(self.prompts(), "")

    def test_a_new_spec_with_no_labelled_root_cause_stops_the_run(self):
        self.env["CLAUDE_SPEC"] = UNTRACED
        report = self.resume(f"premise_verdict={WRITE}", premise_report_text())
        self.assertEqual((report["status"], report["step"]), ("failed", "root-cause"), report)
        self.assertIn("## Root cause", report["stderr"])

    def test_a_defect_the_spec_calls_no_defect_stops_the_run(self):
        self.env["CLAUDE_SPEC"] = SETTLED
        report = self.resume(f"premise_verdict={WRITE}", premise_report_text(wrong="yes"))
        self.assertEqual((report["status"], report["step"]), ("failed", "root-cause"), report)
        self.assertIn("Reports wrong behaviour: yes", report["stderr"])

    def test_a_root_cause_that_grill_left_unlabelled_stops_the_run(self):
        self.resume(f"premise_verdict={WRITE}", premise_report_text(wrong="yes"))
        for text, said in ((UNTRACED, "## Root cause"), (SETTLED, "Reports wrong behaviour: yes")):
            with self.subTest(said):
                (self.root / self.NEW / "spec.md").write_text(text)
                report = self.resume("grill_verdict=approve")
                self.assertEqual((report["status"], report["step"]), ("failed", "root-cause-after-grill"), report)
                self.assertIn(said, report["stderr"])


class Report(unittest.TestCase):
    """report() trusts a step record only when it belongs to the attempt the run stopped on: the engine
    records nothing for a step that raises, and a resumed step keeps its previous attempt's record."""

    def failed(self, step, step_results):
        return {"run_id": "r1", "status": "failed", "current_step_id": step,
                "error": "boom: expression failed", "step_results": step_results}

    def test_a_step_that_raised_reports_the_run_error(self):
        out = drive_workflow.report(self.failed("plan", {}))
        self.assertEqual((out["error"], out["stderr"], out["open_markers"]),
                         ("boom: expression failed", "", False))

    def test_a_previous_attempts_open_markers_are_not_reported_again(self):
        stale = {"status": "failed", "error": "Shell command exited with code 1.",
                 "output": {"stderr": "Open clarification markers remain in specs/001-demo/spec.md\n"}}
        out = drive_workflow.report(self.failed("no-open-markers", {"no-open-markers": stale}))
        self.assertEqual((out["error"], out["stderr"], out["open_markers"]),
                         ("boom: expression failed", "", False))

    def test_a_run_paused_at_critique_review_names_the_file_the_gate_shows(self):
        state = {
            "run_id": "r1", "status": "paused", "current_step_id": "review-critique", "error": None,
            "step_results": {"review-critique": {
                "status": "paused", "output": {"show_file": "specs/001-demo/critiques/critique-2.md"}}},
        }
        self.assertEqual(drive_workflow.report(state)["critique"],
                         "specs/001-demo/critiques/critique-2.md")


if __name__ == "__main__":
    unittest.main()
