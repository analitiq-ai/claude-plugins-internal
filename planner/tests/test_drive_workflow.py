"""drive_workflow.py against the real specify CLI, in a throwaway project.

No test runs the real agent or reaches GitHub: `plan` on a rescope gets a stand-in `claude` that writes no plan,
`specify` on a new spec gets one that writes the spec the test names where the test names, `gh` is a stand-in
that keeps each call, and `node` is a stand-in for the preflight step that keeps each call and passes the issue
unless the test makes it stop the run; any other script it hands to the real node.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from paths import PLUGIN, REPO
from test_premise_report import report as premise_report_text
from test_premise_report import spec_section
from test_rootcause import SPEC as SPEC_WITH

import yaml  # Spec Kit's own dependency

import no_spec
from premise_report import NO_SPEC, NOT_WORTH_DOING, WRITE

SKILL = PLUGIN / "skills" / "issue-spec"
DRIVER = SKILL / "scripts" / "drive_workflow.py"
SPECKIT = PLUGIN / "speckit"
sys.path.insert(0, str(DRIVER.parent))
import drive_workflow  # noqa: E402

SPEC_DIR = "specs/7-demo"
NEW = "specs/7-new"
ISSUE = "7"
ISSUE_TEXT = "https://github.test/acme/demo/issues/7\n# Demo\n"
FOLDER_FORM = "specs/<issue>-<short-name>"
# What the skill writes for a rescope: the issue's title and description, then the open decision.
RESCOPE = ("https://github.test/acme/demo/issues/7\n# Demo\n\nThe gate fails on main.\n\n"
           "Open decision: which store keeps the binding?")
TRACED, UNTRACED = SPEC_WITH.format(section="Observed: test_gate fails on main."), "# Demo\n\nSettled.\n"
SETTLED = SPEC_WITH.format(section="Not a defect report.")
UNANSWERED = TRACED.replace(spec_section(), "")


# Stands in for the agent `specify` dispatches to. It keeps the folder it was given, in its environment and its
# prompt, then writes $CLAUDE_SPEC as spec.md of $CLAUDE_WRITES_TO and names that folder in .specify/feature.json;
# CLAUDE_NO_FEATURE_JSON makes it name none.
SPECIFY = '''#!{python}
import json, os, sys
prompt = sys.argv[2]
with open({prompts!r}, "a") as log:
    log.write(prompt + "\\n")
with open({given!r}, "a") as log:
    log.write(json.dumps({{"env": os.environ.get("SPECIFY_FEATURE_DIRECTORY"), "prompt": prompt}}) + "\\n")
folder = os.environ["CLAUDE_WRITES_TO"]
os.makedirs(folder, exist_ok=True)
with open(os.path.join(folder, "spec.md"), "w") as spec:
    spec.write(os.environ["CLAUDE_SPEC"])
if not os.environ.get("CLAUDE_NO_FEATURE_JSON"):
    with open(".specify/feature.json", "w") as feature:
        feature.write(json.dumps({{"feature_directory": folder}}))
'''


def drive(root, env, *args):
    proc = subprocess.run([sys.executable, str(DRIVER), *args], cwd=root, env=env, capture_output=True, text=True,
                          check=False)
    return proc, json.loads(proc.stdout) if proc.returncode == 0 else None


class Project:
    """A Spec Kit project with neither the plugin's preset nor its workflow installed, in a git checkout, at `under`
    in it; `spec_text` None gives it no spec folder."""

    def __init__(self, spec_text=SETTLED, under=""):
        self._tmp = tempfile.TemporaryDirectory()
        checkout = Path(self._tmp.name) / "checkout"
        subprocess.run(["git", "init", "-q", str(checkout)], check=True)
        self.root = checkout / under
        self.bin = Path(self._tmp.name) / "bin"
        self.bin.mkdir()
        self.prompts = Path(self._tmp.name) / "claude.log"
        self.prompts.write_text("")
        self.gh_log = Path(self._tmp.name) / "gh.log"
        # Stands in for the agent `plan` dispatches to: keeps its prompt, writes no plan.
        self.stand_in("claude", f'#!/bin/sh\nprintf "%s\\n" "$2" >> "{self.prompts}"\n')
        # The issue is open, so a step that checked its state before closing it would go on to close it: every
        # call such a step makes is kept, not just the first.
        self.stand_in("gh", f"#!{sys.executable}\nimport json, sys\n"
                            f"with open({str(self.gh_log)!r}, 'a') as log:\n"
                            "    log.write(json.dumps(sys.argv[1:]) + '\\n')\n"
                            "if sys.argv[1:3] == ['issue', 'view']:\n"
                            "    print('OPEN')\n")
        self.node_log = Path(self._tmp.name) / "node.log"
        # Preflight reads GitHub, so it is kept and passes unless PREFLIGHT_STOP names the stop to print. The
        # spec-facts steps read and write only the folder, so the real node runs them.
        real_node = shutil.which("node")
        self.stand_in("node", f"#!{sys.executable}\nimport json, os, sys\n"
                              "if not sys.argv[1].endswith('/scripts/preflight.ts'):\n"
                              f"    os.execv({real_node!r}, [{real_node!r}, *sys.argv[1:]])\n"
                              f"with open({str(self.node_log)!r}, 'a') as log:\n"
                              "    log.write(json.dumps(sys.argv[1:]) + '\\n')\n"
                              "if os.environ.get('PREFLIGHT_STOP'):\n"
                              "    sys.exit(os.environ['PREFLIGHT_STOP'])\n")
        self.env = {**os.environ, "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}"}
        (self.root / ".specify" / "workflows").mkdir(parents=True)
        if spec_text is not None:
            self.add_folder(SPEC_DIR, spec_text)

    def add_folder(self, folder, spec_text=SETTLED):
        (self.root / folder).mkdir(parents=True)
        (self.root / folder / "spec.md").write_text(spec_text)

    def with_specify(self, spec_text=TRACED, writes_to=NEW):
        self.given = self.root.parent / "specify-given.log"
        self.stand_in("claude", SPECIFY.format(python=sys.executable, prompts=str(self.prompts),
                                               given=str(self.given)))
        self.env.update(CLAUDE_SPEC=spec_text, CLAUDE_WRITES_TO=writes_to)

    def specify_given(self):
        """What each `specify` call was given: (its SPECIFY_FEATURE_DIRECTORY, its prompt)."""
        if not self.given.exists():
            return []
        return [(c["env"], c["prompt"]) for c in map(json.loads, self.given.read_text().splitlines())]

    def folders(self):
        specs = self.root / "specs"
        return sorted(p.name for p in specs.iterdir()) if specs.is_dir() else []

    def stand_in(self, name, script):
        path = self.bin / name
        path.write_text(script)
        path.chmod(0o755)

    def drive(self, *args):
        return drive(self.root, self.env, *args)

    def spec_file(self, text):
        path = self.root / "spec.txt"
        path.write_text(text)
        return str(path)

    def runs(self):
        runs = self.root / ".specify" / "workflows" / "runs"
        return sorted(runs.iterdir()) if runs.is_dir() else []

    def inputs(self, run_id):
        return json.loads((self.root / ".specify" / "workflows" / "runs" / run_id / "inputs.json").read_text())["inputs"]

    def node_calls(self):
        return [json.loads(line) for line in self.node_log.read_text().splitlines()] if self.node_log.exists() else []

    def gh_calls(self):
        return [json.loads(line) for line in self.gh_log.read_text().splitlines()] if self.gh_log.exists() else []

    def close(self):
        self._tmp.cleanup()


class Rescope(unittest.TestCase):
    """`rescope <spec folder> #<issue>`: the driver starts on the folder with the issue the skill names."""

    def setUp(self):
        self.project = Project()
        self.addCleanup(self.project.close)

    def test_a_rescope_start_pauses_at_grill_on_the_given_folder_with_the_issue_as_its_spec(self):
        proc, report = self.project.drive("rescope", self.project.spec_file(RESCOPE), ISSUE, SPEC_DIR)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((report["status"], report["step"]), ("paused", "grill"))
        feature = json.loads((self.project.root / ".specify" / "feature.json").read_text())
        self.assertEqual(feature["feature_directory"], SPEC_DIR)
        inputs = self.project.inputs(report["run_id"])
        self.assertEqual((inputs["spec"], inputs["issue"], inputs["spec_dir"], inputs["kind"]),
                         (RESCOPE, ISSUE, SPEC_DIR, "rescope"))

    def test_an_empty_folder_stops_before_the_workflow_starts(self):
        proc, _ = self.project.drive("rescope", self.project.spec_file(RESCOPE), ISSUE, "")
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("spec folder", proc.stderr)
        self.assertEqual(self.project.runs(), [])

    def test_an_empty_issue_stops_before_the_workflow_starts(self):
        proc, _ = self.project.drive("rescope", self.project.spec_file(RESCOPE), "", SPEC_DIR)
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("issue", proc.stderr)
        self.assertEqual(self.project.runs(), [])

    def test_an_empty_spec_stops_before_the_workflow_starts(self):
        proc, _ = self.project.drive("rescope", self.project.spec_file(" \n"), ISSUE, SPEC_DIR)
        self.assertNotEqual(proc.returncode, 0)
        self.assertEqual(self.project.runs(), [])

    def test_spec_text_reaches_the_run_verbatim_and_runs_nothing(self):
        text = "RESCOPE `touch PWNED1` $(touch PWNED2) a=b 'q' \"dq\""
        proc, report = self.project.drive("rescope", self.project.spec_file(text), ISSUE, SPEC_DIR)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(self.project.inputs(report["run_id"])["spec"], text)
        self.assertEqual(list(self.project.root.glob("PWNED*")), [])

    def test_a_rejected_folder_reports_the_steps_own_error(self):
        bad = "specs/x'; touch PWNED; echo '"
        proc, report = self.project.drive("rescope", self.project.spec_file(RESCOPE), ISSUE, bad)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((report["status"], report["step"]), ("failed", "check-folder"))
        self.assertIn(FOLDER_FORM, report["stderr"])
        self.assertFalse(report["open_markers"])
        self.assertFalse((self.project.root / "PWNED").exists())

    def refused(self, issue):
        proc, report = self.project.drive("rescope", self.project.spec_file(RESCOPE), issue, SPEC_DIR)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((report["status"], report["step"]), ("failed", "check-folder"), report)
        self.assertIn("Next step:", report["stderr"])
        self.assertFalse((self.project.root / ".specify" / "feature.json").exists())
        return report["stderr"]

    def test_a_rescope_of_another_issues_folder_is_refused_saying_its_name_does_not_start_with_the_issue(self):
        stderr = self.refused("8")
        self.assertIn(SPEC_DIR, stderr)
        self.assertIn("does not start with `8-`", stderr)

    def test_a_rescope_while_the_issue_has_a_second_folder_is_refused_naming_it(self):
        self.project.add_folder("specs/7-other")
        self.assertIn("specs/7-other", self.refused(ISSUE))

    def test_a_rescope_names_the_issues_other_folder_from_the_checkout(self):
        self.project = Project(under="dev/demo")
        self.addCleanup(self.project.close)
        self.project.add_folder("specs/7-other")
        self.assertIn("`dev/demo/specs/7-other`", self.refused(ISSUE))

    def test_a_rescope_of_a_folder_that_does_not_exist_is_refused(self):
        self.project = Project(spec_text=None)
        self.addCleanup(self.project.close)
        self.assertIn("spec.md", self.refused(ISSUE))


class Scope(unittest.TestCase):
    """`#<issue>`: a new scope starts on the folder the skill picked, and the run checks it before anything is
    written."""

    def setUp(self):
        self.project = Project(spec_text=None)
        self.addCleanup(self.project.close)
        self.project.with_specify()

    def start(self, folder=NEW):
        proc, report = self.project.drive("start", self.project.spec_file(ISSUE_TEXT), ISSUE, folder)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return report

    def assert_refused(self, report, *said):
        self.assertEqual((report["status"], report["step"]), ("failed", "check-folder"), report)
        for phrase in (*said, "Next step:"):
            self.assertIn(phrase, report["stderr"])
        self.assertEqual(self.project.prompts.read_text(), "")
        self.assertFalse((self.project.root / ".specify" / "feature.json").exists())

    def test_a_new_scope_runs_on_the_folder_it_was_started_with_and_pauses_at_premise(self):
        """The kind of run is its own input: a folder given does not make the run a rescope."""
        report = self.start()
        self.assertEqual((report["status"], report["step"]), ("paused", "premise"), report)
        inputs = self.project.inputs(report["run_id"])
        self.assertEqual((inputs["issue"], inputs["spec_dir"], inputs["kind"]), (ISSUE, NEW, "new"))

    def test_a_start_without_a_folder_starts_no_run(self):
        for folder in ((), ("",)):
            with self.subTest(folder=folder):
                proc, _ = self.project.drive("start", self.project.spec_file(ISSUE_TEXT), ISSUE, *folder)
                self.assertNotEqual(proc.returncode, 0)
                self.assertEqual(self.project.runs(), [])

    def test_a_folder_not_of_the_form_or_not_numbered_for_the_issue_fails_the_run_before_anything_is_written(self):
        for folder, said in (("7-new", FOLDER_FORM), ("specs/7_new", FOLDER_FORM), ("specs/7-New", FOLDER_FORM),
                             ("specs/7-new/x", FOLDER_FORM), ("dev/planner/specs/7-new", FOLDER_FORM),
                             ("specs/07-new", "does not start with `7-`"), ("specs/8-new", "does not start with `7-`")):
            with self.subTest(folder=folder):
                self.assert_refused(self.start(folder), said)
                self.assertEqual(self.project.folders(), [])

    def test_a_new_scope_of_an_issue_that_has_a_folder_is_refused_naming_the_rescope_form(self):
        self.project.add_folder(SPEC_DIR)
        for folder in (NEW, SPEC_DIR):
            with self.subTest(folder=folder):
                self.assert_refused(self.start(folder), f"`rescope {SPEC_DIR} #{ISSUE}`")
                self.assertEqual(self.project.folders(), ["7-demo"])

    def test_a_refused_new_scope_names_the_rescope_form_from_the_checkout(self):
        """The skill reads a rescope's folder relative to the checkout, not to the project under it."""
        self.project = Project(spec_text=SETTLED, under="dev/demo")
        self.addCleanup(self.project.close)
        self.project.with_specify()
        self.assert_refused(self.start(), f"`rescope dev/demo/{SPEC_DIR} #{ISSUE}`")

    def test_folders_of_other_issues_do_not_refuse_a_new_scope(self):
        for folder in ("specs/70-x", "specs/17-y", "specs/007-old"):
            self.project.add_folder(folder)
        self.assertEqual(self.start()["step"], "premise")


class Preflight(unittest.TestCase):
    """The run's first step reads the issue and its card before any step writes."""

    def setUp(self):
        self.project = Project(spec_text=None)
        self.addCleanup(self.project.close)
        self.project.with_specify()

    def start(self):
        proc, report = self.project.drive("start", self.project.spec_file(ISSUE_TEXT), ISSUE, NEW)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return report

    def test_the_first_step_runs_the_plugins_preflight_on_the_issue(self):
        self.assertEqual(list(workflow_steps())[0]["id"], "preflight")
        report = self.start()
        self.assertEqual((report["status"], report["step"]), ("paused", "premise"), report)
        [(script, *args)] = self.project.node_calls()
        self.assertEqual((Path(script).resolve(), args), ((PLUGIN / "scripts" / "preflight.ts").resolve(), [ISSUE]))

    def test_a_preflight_stop_fails_the_run_at_preflight_before_anything_is_written(self):
        stop = "#7's card is in Ready. Next step: move #7 from Ready to Backlog or Blocked."
        self.project.env["PREFLIGHT_STOP"] = stop
        report = self.start()
        self.assertEqual((report["status"], report["step"]), ("failed", "preflight"), report)
        self.assertIn(stop, report["stderr"])
        self.assertEqual(self.project.prompts.read_text(), "")
        self.assertEqual(self.project.folders(), [])
        self.assertFalse((self.project.root / ".specify" / "feature.json").exists())

    def test_a_resume_once_the_stop_is_cleared_runs_preflight_again_and_goes_on(self):
        self.project.env["PREFLIGHT_STOP"] = "#7 has no card on the board. Next step: add #7 to the board."
        failed = self.start()
        del self.project.env["PREFLIGHT_STOP"]
        proc, report = self.project.drive("resume", failed["run_id"])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((report["status"], report["step"]), ("paused", "premise"), report)
        self.assertEqual(len(self.project.node_calls()), 2)


class Specify(unittest.TestCase):
    """`specify` is given the run's folder, and the run goes on only if `specify` recorded that folder."""

    def setUp(self):
        self.project = Project(spec_text=None)
        self.addCleanup(self.project.close)
        self.project.with_specify()
        proc, self.started = self.project.drive("start", self.project.spec_file(ISSUE_TEXT), ISSUE, NEW)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        run = self.project.root / ".specify" / "workflows" / "runs" / self.started["run_id"]
        (run / "premise-report.md").write_text(premise_report_text())

    def resume(self, *verdict):
        proc, report = self.project.drive("resume", self.started["run_id"], *verdict)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return report

    def test_specify_is_given_the_folder_as_its_feature_directory(self):
        self.resume(f"premise_verdict={WRITE}")
        [(env, prompt)] = self.project.specify_given()
        self.assertEqual(env, NEW)
        self.assertIn(f"SPECIFY_FEATURE_DIRECTORY: {NEW}", prompt.splitlines())

    def test_specify_recording_the_folder_it_was_given_lets_the_run_go_on(self):
        report = self.resume(f"premise_verdict={WRITE}")
        self.assertEqual((report["status"], report["step"]), ("paused", "grill"), report)
        self.assertEqual(self.project.folders(), ["7-new"])

    def test_specify_recording_another_folder_or_none_fails_the_run_naming_both(self):
        for env, recorded in (({"CLAUDE_WRITES_TO": "specs/001-demo"}, "`specs/001-demo`"),
                              ({"CLAUDE_NO_FEATURE_JSON": "1"}, "no folder")):
            with self.subTest(recorded=recorded):
                self.setUp()
                self.project.env.update(env)
                report = self.resume(f"premise_verdict={WRITE}")
                self.assertEqual((report["status"], report["step"]), ("failed", "check-specify-folder"), report)
                for said in (recorded, f"`{NEW}`", "Next step:", "start the scope again"):
                    self.assertIn(said, report["stderr"])


class Resume(unittest.TestCase):
    def test_a_run_started_without_a_folder_input_stops_naming_the_next_step(self):
        """A run started before every run took a folder: no step can tell which folder it is for."""
        project = Project(spec_text=None)
        self.addCleanup(project.close)
        run = project.root / ".specify" / "workflows" / "runs" / "old"
        run.mkdir(parents=True)
        (run / "state.json").write_text(json.dumps({"run_id": "old", "status": "paused"}))
        (run / "inputs.json").write_text(json.dumps({"inputs": {"spec": "x", "issue": ISSUE}}))
        proc, _ = project.drive("resume", "old", f"premise_verdict={WRITE}")
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("Next step:", proc.stderr)


def workflow_steps(steps=None):
    """Every step of the plugin's workflow, the ones nested in an `if` included."""
    if steps is None:
        steps = yaml.safe_load((SPECKIT / "workflows" / "issue-spec" / "workflow.yml").read_text())["steps"]
    for step in steps:
        yield step
        yield from workflow_steps(step.get("then", []) + step.get("else", []))


def same_files(source: Path, installed: Path) -> bool:
    return all((installed / f.relative_to(source)).is_file()
               and (installed / f.relative_to(source)).read_bytes() == f.read_bytes()
               for f in source.rglob("*") if f.is_file())


class Install(unittest.TestCase):
    """A start installs the plugin's settled-design preset and issue-spec workflow into the project it runs in."""

    def test_the_copies_installed_in_this_repo_are_the_plugins(self):
        installed = REPO / ".specify"
        self.assertTrue(same_files(SPECKIT / "presets" / "settled-design", installed / "presets" / "settled-design"))
        self.assertTrue(same_files(SPECKIT / "workflows" / "issue-spec", installed / "workflows" / "issue-spec"))

    def setUp(self):
        self.project = Project()
        self.addCleanup(self.project.close)
        self.preset = self.project.root / ".specify" / "presets" / "settled-design"
        self.workflow = self.project.root / ".specify" / "workflows" / "issue-spec"

    def start(self):
        proc, report = self.project.drive("rescope", self.project.spec_file(RESCOPE), ISSUE, SPEC_DIR)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((report["status"], report["step"]), ("paused", "grill"))

    def test_a_project_without_them_gets_both(self):
        self.start()
        self.assertTrue(same_files(SPECKIT / "presets" / "settled-design", self.preset))
        self.assertTrue(same_files(SPECKIT / "workflows" / "issue-spec", self.workflow))

    def test_an_installed_copy_that_differs_from_the_plugins_is_replaced(self):
        self.start()
        (self.preset / "templates" / "plan-template.md").write_text("stale\n")
        (self.workflow / "critique_report.py").write_text("stale\n")
        self.start()
        self.assertTrue(same_files(SPECKIT / "presets" / "settled-design", self.preset))
        self.assertTrue(same_files(SPECKIT / "workflows" / "issue-spec", self.workflow))

    def test_only_the_rescope_step_that_writes_feature_json_names_it(self):
        """No step reads its folder from feature.json; a rescope writes it for Spec Kit's own commands."""
        self.assertEqual([s["id"] for s in workflow_steps() if "feature.json" in s.get("run", "")], ["select-spec"])

    def test_one_step_writes_every_no_spec_spec_md(self):
        self.assertEqual(len([s for s in workflow_steps() if '/scripts/no_spec.py" write' in s.get("run", "")]), 1)

    def test_the_workflow_runs_the_plugins_scripts_under_the_plan_root_the_driver_sets(self):
        """The steps run in the project, which has no copy of the plugin's scripts; the driver says where they are."""
        self.assertEqual([s["id"] for s in workflow_steps() if "REVIEWER_ROOT" in s.get("run", "")], [])
        [step] = [s for s in workflow_steps() if s["id"] == "settled-design"]
        self.assertIn('python3 "$PLANNER_ROOT/scripts/settled_design.py" "$SPECIFY_FEATURE_DIRECTORY"', step["run"])
        with mock.patch.object(drive_workflow.subprocess, "run") as run, mock.patch.dict(os.environ, clear=True):
            drive_workflow._specify(["resume", "r1"], {})
        env = run.call_args.kwargs["env"]
        self.assertNotIn("REVIEWER_ROOT", env)
        self.assertTrue((Path(env["PLANNER_ROOT"]) / "scripts" / "settled_design.py").is_file())


class AfterGrill(unittest.TestCase):
    def test_the_steps_after_grill_grade_the_runs_folder_whatever_feature_json_names(self):
        """The folder input is the one source of the folder: feature.json is written for Spec Kit's own commands."""
        self.project = Project("# Demo\n\n[NEEDS CLARIFICATION: which store?]\n")
        self.addCleanup(self.project.close)
        self.project.add_folder("specs/8-other", TRACED)
        _, started = self.project.drive("rescope", self.project.spec_file(RESCOPE), ISSUE, SPEC_DIR)
        (self.project.root / ".specify" / "feature.json").write_text(json.dumps({"feature_directory": "specs/8-other"}))
        proc, report = self.project.drive("resume", started["run_id"], "grill_verdict=approve")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((report["status"], report["step"]), ("failed", "no-open-markers"), report)
        self.assertIn(SPEC_DIR, report["stderr"])

    def test_a_resume_after_grill_cleared_the_markers_runs_on(self):
        """The skill's way back from open markers: grill again in the session, then a plain resume."""
        report = self.approved("# Demo\n\n[NEEDS CLARIFICATION: which store?]\n")
        self.assertTrue(report["open_markers"], report)
        (self.project.root / SPEC_DIR / "spec.md").write_text(UNANSWERED)
        proc, report = self.project.drive("resume", report["run_id"])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((report["status"], report["step"]), ("failed", "settled-design"), report)

    def approved(self, spec_text):
        self.project = Project(spec_text)
        self.addCleanup(self.project.close)
        proc, started = self.project.drive("rescope", self.project.spec_file(RESCOPE), ISSUE, SPEC_DIR)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        proc, report = self.project.drive("resume", started["run_id"], "grill_verdict=approve")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return report

    def test_resuming_past_grill_with_markers_left_says_so(self):
        report = self.approved("# Demo\n\n[NEEDS CLARIFICATION: which store?]\n")
        self.assertEqual((report["status"], report["step"]), ("failed", "no-open-markers"))
        self.assertTrue(report["open_markers"])

    def test_a_rescoped_spec_without_premise_answers_runs_on_to_the_settled_design_check(self):
        report = self.approved(UNANSWERED)
        self.assertEqual((report["status"], report["step"]), ("failed", "settled-design"), report)
        self.assertIn("speckit-plan", self.project.prompts.read_text())

    def test_a_rescoped_spec_with_no_labelled_root_cause_stops_the_run(self):
        report = self.approved(UNTRACED)
        self.assertEqual((report["status"], report["step"]), ("failed", "root-cause-of-rescope"))
        self.assertIn("## Root cause", report["stderr"])


class Premise(unittest.TestCase):
    """A new spec: the run pauses at `premise` first, and the user's pick decides whether a spec is written."""
    REASON = "a typo, fixed by the request"
    ORIGIN = "https://github.test/acme/demo.git"

    def setUp(self):
        self.project = Project(spec_text=None)
        self.addCleanup(self.project.close)
        # Like the checkouts planner runs in, it has an origin: a step that named the issue's repo by it would
        # reach gh, and the call would be kept, rather than fail on reading the remote.
        subprocess.run(["git", "-C", str(self.project.root), "remote", "add", "origin", self.ORIGIN], check=True)
        self.project.with_specify()
        proc, self.started = self.project.drive("start", self.project.spec_file(ISSUE_TEXT), ISSUE, NEW)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.report_path = f".specify/workflows/runs/{self.started['run_id']}/premise-report.md"

    def resume(self, verdict, report_text=None):
        if report_text is not None:
            (self.project.root / self.report_path).write_text(report_text)
        proc, report = self.project.drive("resume", self.started["run_id"], verdict)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return report

    def stop(self, pick):
        return self.resume(f"premise_verdict={pick}", premise_report_text(
            pick, rests_on="needs-spec", reason=self.REASON, wrong="no"))

    def test_a_new_spec_pauses_at_premise_before_anything_is_written(self):
        self.assertEqual((self.started["status"], self.started["step"]), ("paused", "premise"))
        self.assertEqual(self.project.prompts.read_text(), "")

    def test_a_new_spec_without_an_issue_starts_no_run(self):
        proc, _ = self.project.drive("start", self.project.spec_file("# Demo\n"))
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("issue", proc.stderr)
        self.assertEqual(len(self.project.runs()), 1)

    def test_not_worth_doing_names_the_close_for_the_admin_calls_github_for_nothing_and_writes_no_spec(self):
        report = self.stop(NOT_WORTH_DOING)
        self.assertEqual(report["status"], "completed", report)
        self.assertEqual(self.project.gh_calls(), [])
        self.assertEqual(report.get("close"), f"Close #{ISSUE} as not planned: {self.REASON}", report)
        self.assertEqual(self.project.prompts.read_text(), "")
        self.assertFalse((self.project.root / "specs").exists())

    def test_no_spec_needed_writes_the_folder_with_only_a_no_spec_spec_md_and_calls_github_for_nothing(self):
        report = self.stop(NO_SPEC)
        self.assertEqual(report["status"], "completed", report)
        self.assertEqual(self.project.gh_calls(), [])
        self.assertEqual(self.project.prompts.read_text(), "")
        self.assertEqual(self.project.folders(), ["7-new"])
        self.assertEqual([p.name for p in (self.project.root / NEW).iterdir()], ["spec.md"])
        text = (self.project.root / NEW / "spec.md").read_text()
        self.assertTrue(no_spec.is_no_spec(text), text)
        for line in ("Rests on: needs-spec", f"Reason: {self.REASON}"):
            self.assertIn(line, text.splitlines())

    def test_no_spec_needed_writes_its_spec_facts_and_a_rescope_of_the_folder_still_starts_at_the_premise(self):
        report = self.stop(NO_SPEC)
        self.assertEqual(report["status"], "completed", report)
        lines = (self.project.root / NEW / "spec.md").read_text().splitlines()
        self.assertEqual(lines[0], "---", lines)
        self.assertEqual(yaml.safe_load("\n".join(lines[1:lines.index("---", 1)])),
                         {"codeworks": {"v": 1, "kind": "no_spec", "root_cause": {"observed": "none"}}})
        proc, rescoped = self.project.drive("rescope", self.project.spec_file(RESCOPE), ISSUE, NEW)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((rescoped["status"], rescoped["step"]), ("paused", "premise"), rescoped)

    def test_an_unwritable_no_spec_folder_stops_at_its_step_with_a_next_step_and_resumes_once_cleared(self):
        blocker = self.project.root / "specs"
        blocker.write_text("in the way\n")
        report = self.stop(NO_SPEC)
        self.assertEqual((report["status"], report["step"]), ("failed", "write-no-spec"), report)
        self.assertIn("Next step:", report["stderr"])
        for unsaid in ("resume", "DRIVE"):
            self.assertNotIn(unsaid, report["stderr"])
        blocker.unlink()
        proc, report = self.project.drive("resume", self.started["run_id"])
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual(report["status"], "completed", report)
        self.assertTrue(no_spec.is_no_spec((self.project.root / NEW / "spec.md").read_text()))

    def test_an_issue_judged_to_need_no_spec_is_not_scoped_again(self):
        self.stop(NO_SPEC)
        proc, report = self.project.drive("start", self.project.spec_file(ISSUE_TEXT), ISSUE, "specs/7-other")
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.assertEqual((report["status"], report["step"]), ("failed", "check-folder"), report)
        self.assertIn(f"`rescope {NEW} #{ISSUE}`", report["stderr"])
        self.assertEqual(self.project.folders(), ["7-new"])

    def test_writing_the_spec_hands_specify_the_report_and_pauses_at_grill(self):
        report = self.resume(f"premise_verdict={WRITE}", premise_report_text())
        self.assertEqual((report["status"], report["step"]), ("paused", "grill"), report)
        self.assertEqual(self.project.prompts.read_text().rstrip().splitlines()[-1],
                         f"Premise report: {self.report_path}")
        self.assertEqual(self.project.gh_calls(), [])

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
                self.assertEqual(self.project.prompts.read_text(), "")

    def test_a_new_spec_with_no_labelled_root_cause_stops_the_run(self):
        self.project.env["CLAUDE_SPEC"] = UNTRACED
        report = self.resume(f"premise_verdict={WRITE}", premise_report_text())
        self.assertEqual((report["status"], report["step"]), ("failed", "root-cause"), report)
        self.assertIn("## Root cause", report["stderr"])

    def test_a_defect_the_spec_calls_no_defect_stops_the_run(self):
        self.project.env["CLAUDE_SPEC"] = SETTLED
        report = self.resume(f"premise_verdict={WRITE}", premise_report_text(wrong="yes"))
        self.assertEqual((report["status"], report["step"]), ("failed", "root-cause"), report)
        self.assertIn("Reports wrong behaviour: yes", report["stderr"])

    def test_a_new_spec_without_the_premise_answers_stops_the_run(self):
        self.project.env["CLAUDE_SPEC"] = UNANSWERED
        report = self.resume(f"premise_verdict={WRITE}", premise_report_text())
        self.assertEqual((report["status"], report["step"]), ("failed", "premise-answers"), report)
        self.assertIn("## Why this is worth doing", report["stderr"])

    def test_premise_answers_that_grill_removed_stop_the_run(self):
        self.resume(f"premise_verdict={WRITE}", premise_report_text())
        (self.project.root / NEW / "spec.md").write_text(UNANSWERED)
        report = self.resume("grill_verdict=approve")
        self.assertEqual((report["status"], report["step"]), ("failed", "premise-answers-after-grill"), report)
        self.assertIn("## Why this is worth doing", report["stderr"])

    def test_a_root_cause_that_grill_left_unlabelled_stops_the_run(self):
        self.resume(f"premise_verdict={WRITE}", premise_report_text(wrong="yes"))
        for text, said in ((UNTRACED, "## Root cause"), (SETTLED, "Reports wrong behaviour: yes")):
            with self.subTest(said):
                (self.project.root / NEW / "spec.md").write_text(text)
                report = self.resume("grill_verdict=approve")
                self.assertEqual((report["status"], report["step"]), ("failed", "root-cause-after-grill"), report)
                self.assertIn(said, report["stderr"])


class NoSpecRescope(unittest.TestCase):
    """A rescope of a no-spec folder runs the new-scope workflow from the premise into that same folder."""
    REASON = "a typo, fixed by the request"

    def setUp(self):
        self.project = Project(no_spec.text(premise_report_text(NO_SPEC, rests_on="needs-spec", reason=self.REASON,
                                                                wrong="no")))
        self.addCleanup(self.project.close)
        self.project.with_specify(writes_to=SPEC_DIR)
        proc, self.started = self.project.drive("rescope", self.project.spec_file(RESCOPE), ISSUE, SPEC_DIR)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.report_path = self.project.root / f".specify/workflows/runs/{self.started['run_id']}/premise-report.md"

    def resume(self, verdict, report_text=None):
        if report_text is not None:
            self.report_path.write_text(report_text)
        proc, report = self.project.drive("resume", self.started["run_id"], verdict)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return report

    def spec(self):
        return (self.project.root / SPEC_DIR / "spec.md").read_text()

    def test_it_pauses_at_the_premise_with_the_folder_untouched(self):
        self.assertEqual((self.started["status"], self.started["step"]), ("paused", "premise"), self.started)
        self.assertEqual(self.project.prompts.read_text(), "")
        self.assertTrue(no_spec.is_no_spec(self.spec()))

    def test_writing_the_spec_has_specify_write_over_the_no_spec_spec_md_in_that_folder(self):
        report = self.resume(f"premise_verdict={WRITE}", premise_report_text())
        self.assertEqual((report["status"], report["step"]), ("paused", "grill"), report)
        self.assertEqual([env for env, _ in self.project.specify_given()], [SPEC_DIR])
        self.assertEqual(self.spec(), TRACED)
        self.assertEqual(self.project.folders(), ["7-demo"])

    def test_after_grill_it_is_graded_as_a_new_spec_against_its_premise_report(self):
        """It has a premise report, unlike a rescope of a spec, so its premise answers are graded."""
        self.resume(f"premise_verdict={WRITE}", premise_report_text())
        (self.project.root / SPEC_DIR / "spec.md").write_text(UNANSWERED)
        report = self.resume("grill_verdict=approve")
        self.assertEqual((report["status"], report["step"]), ("failed", "premise-answers-after-grill"), report)

    def test_no_spec_needed_again_has_the_writer_write_it_again_from_the_new_report(self):
        report = self.resume(f"premise_verdict={NO_SPEC}", premise_report_text(
            NO_SPEC, rests_on="change-alters", reason="the request fixes it", wrong="no"))
        self.assertEqual(report["status"], "completed", report)
        self.assertTrue(no_spec.is_no_spec(self.spec()))
        self.assertIn("Reason: the request fixes it", self.spec().splitlines())
        self.assertEqual([p.name for p in (self.project.root / SPEC_DIR).iterdir()], ["spec.md"])
        self.assertEqual((self.project.prompts.read_text(), self.project.gh_calls()), ("", []))


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
                 "output": {"stderr": "Open clarification markers remain in specs/7-demo/spec.md\n"}}
        out = drive_workflow.report(self.failed("no-open-markers", {"no-open-markers": stale}))
        self.assertEqual((out["error"], out["stderr"], out["open_markers"]),
                         ("boom: expression failed", "", False))

    def test_a_run_paused_at_critique_review_names_the_file_the_gate_shows(self):
        state = {
            "run_id": "r1", "status": "paused", "current_step_id": "review-critique", "error": None,
            "step_results": {"review-critique": {
                "status": "paused", "output": {"show_file": "specs/7-demo/critiques/critique-2.md"}}},
        }
        self.assertEqual(drive_workflow.report(state)["critique"],
                         "specs/7-demo/critiques/critique-2.md")


if __name__ == "__main__":
    unittest.main()
