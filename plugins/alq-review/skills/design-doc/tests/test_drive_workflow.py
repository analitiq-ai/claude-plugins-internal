"""drive_workflow.py against the real specify CLI, in a throwaway project.

Every run here takes the rescope path, which pauses at grill before any agent step, so no
integration CLI is needed.
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import yaml  # Spec Kit's own dependency

SKILL = Path(__file__).resolve().parents[1]
DRIVER = SKILL / "scripts" / "drive_workflow.py"
SPECKIT = SKILL.parents[1] / "speckit"
sys.path.insert(0, str(DRIVER.parent))
import drive_workflow  # noqa: E402

SPEC_DIR = "specs/001-demo"


class Project:
    def __init__(self, spec_text="# Demo\n\nSettled.\n"):
        self._tmp = tempfile.TemporaryDirectory()
        self.root = Path(self._tmp.name)
        # A Spec Kit project with neither the plugin's preset nor its workflow installed.
        (self.root / ".specify" / "workflows").mkdir(parents=True)
        (self.root / SPEC_DIR).mkdir(parents=True)
        (self.root / SPEC_DIR / "spec.md").write_text(spec_text)

    def drive(self, *args):
        proc = subprocess.run([sys.executable, str(DRIVER), *args], cwd=self.root,
                              capture_output=True, text=True)
        report = json.loads(proc.stdout) if proc.returncode == 0 else None
        return proc, report

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
        steps = yaml.safe_load((SPECKIT / "workflows" / "design-doc" / "workflow.yml").read_text())["steps"]
        [step] = [s for s in steps if s["id"] == "settled-design"]
        self.assertIn('python3 "$ALQ_REVIEW_ROOT/scripts/settled_design.py" "$dir"', step["run"])
        with mock.patch.object(drive_workflow.subprocess, "run") as run:
            drive_workflow._specify(["resume", "r1"], {})
        root = Path(run.call_args.kwargs["env"]["ALQ_REVIEW_ROOT"])
        self.assertTrue((root / "scripts" / "settled_design.py").is_file())


class OpenMarkers(unittest.TestCase):
    def test_resuming_past_grill_with_markers_left_says_so(self):
        project = Project("# Demo\n\n[NEEDS CLARIFICATION: which store?]\n")
        self.addCleanup(project.close)
        _, started = project.drive("start", project.spec_file("RESCOPE x"), SPEC_DIR)
        proc, report = project.drive("resume", started["run_id"], "grill_verdict=approve")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((report["status"], report["step"]), ("failed", "no-open-markers"))
        self.assertTrue(report["open_markers"])


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
