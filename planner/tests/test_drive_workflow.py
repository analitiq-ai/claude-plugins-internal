"""drive_workflow.py against the real specify CLI, in a throwaway project.

No test runs the real agent or reaches GitHub: `plan` on a rescope gets a stand-in `claude` that writes no plan,
`specify` on a new spec gets one that writes the spec the test names where the test names, `gh` is a stand-in
that keeps each call, and `node` is a stand-in for the preflight step that keeps each call and passes the issue
unless the test makes it stop the run; any other script it hands to the real node. AdrCheck replaces the `claude`
and `node` stand-ins with its own: its `claude` also plays the critique and the ADR check's touches step, tasks
command and judge, and its `node` keeps each adr_check.ts call and sends its GitHub calls to a stand-in GitHub that
keeps each one.
"""
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

from paths import PLUGIN, REPO
from test_premise_report import report as premise_report_text
from test_premise_report import spec_section
from test_rootcause import SPEC as SPEC_WITH
from test_settled_design import PLAN as SETTLED_PLAN
from test_settled_design import RESEARCH as SETTLED_RESEARCH

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
    """Every step of the plugin's workflow, the ones nested in an `if` or a loop included."""
    if steps is None:
        steps = yaml.safe_load((SPECKIT / "workflows" / "issue-spec" / "workflow.yml").read_text())["steps"]
    for step in steps:
        yield step
        yield from workflow_steps(step.get("then", []) + step.get("else", []) + step.get("steps", []))


def same_files(source: Path, installed: Path) -> bool:
    return all((installed / f.relative_to(source)).is_file()
               and (installed / f.relative_to(source)).read_bytes() == f.read_bytes()
               for f in source.rglob("*") if f.is_file())


class HeldKeys(unittest.TestCase):
    def held(self, data: bytes):
        with tempfile.TemporaryDirectory() as spec_dir:
            (Path(spec_dir) / "adr-rulings.json").write_bytes(data)
            return drive_workflow._held_keys(spec_dir)

    def test_reads_the_key_of_each_ruling(self):
        rulings = [{"folder": "docs/adr", "record": "0004", "path": path, "reason": "r"} for path in ("a.ts", "b.ts")]
        self.assertEqual(self.held(json.dumps({"v": 1, "rulings": rulings}).encode()),
                         {"docs/adr 0004 a.ts", "docs/adr 0004 b.ts"})

    def test_a_file_that_is_not_json_holds_no_key(self):
        self.assertEqual(self.held(b"not json"), set())

    def test_a_ruling_with_a_byte_that_is_not_utf_8_still_holds_its_key(self):
        ruling = json.dumps({**RULING, "reason": "@"}).encode().replace(b"@", b"\xff")
        self.assertEqual(self.held(b'{"v": 1, "rulings": [' + ruling + b']}'),
                         {f"{RULING['folder']} {RULING['record']} {RULING['path']}"})

    def test_a_utf_16_file_holds_no_key_though_its_rulings_are_valid(self):
        self.assertEqual(self.held(json.dumps({"v": 1, "rulings": [RULING]}).encode("utf-16")), set())

    def test_a_file_holding_nan_holds_no_key_though_its_rulings_are_valid(self):
        self.assertEqual(self.held(json.dumps({"v": 1, "rulings": [RULING], "n": None}).replace("null", "NaN").encode()), set())


class GivenKeys(unittest.TestCase):
    def test_a_ruling_holding_infinity_is_not_json_and_is_named_by_its_text(self):
        text = json.dumps([{**RULING, "reason": None}]).replace("null", "-Infinity")
        self.assertEqual(drive_workflow._given_keys(text), [text])


class NonUtf8Bytes(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.dir = Path(tmp.name)

    def test_a_run_folder_record_reads_a_byte_that_is_not_utf_8_as_u_fffd(self):
        (self.dir / "r1").mkdir()
        (self.dir / "r1" / "adr-asked.json").write_bytes(b'{"folders": [], "x": "\xff"}')
        with mock.patch.object(drive_workflow, "RUNS", self.dir):
            self.assertEqual(drive_workflow._record("r1", "adr-asked.json"), {"folders": [], "x": "\ufffd"})

    def test_a_ruling_file_that_is_not_utf_8_exits_naming_it(self):
        ruling = self.dir / "ruling.json"
        ruling.write_bytes(b'[{"x": "\xff"}]')
        with self.assertRaises(SystemExit) as raised:
            drive_workflow._ruling(f"@{ruling}")
        self.assertTrue(str(raised.exception.code).startswith(f"{drive_workflow.ADR_RULING}@{ruling}: cannot read the file: "),
                        raised.exception.code)


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


# The stand-in `adr` answers the adrkit version core pins.
ADR_VERSION = re.search(r'export const ADR_VERSION = "([^"]+)"', (REPO / "core" / "src" / "adr.ts").read_text())[1]
GITHUB_AT = REPO / "planner" / "tests" / "support" / "github-at.ts"
GOVERNED = "core/src/x.ts"
UNGOVERNED = "lib/y.ts"
# A plan that passes settled_design.py and names the one file it changes.
ADR_PLAN = SETTLED_PLAN + f"\n## Project Structure\n\n- `{GOVERNED}`: the check.\n"
ADR_SETTINGS = """[shared]
board = "https://github.com/orgs/acme/projects/1"
validators = []
adr_folders = ["docs/adr"]
session_app_login = "codeworks-session[bot]"
orchestrator_app_login = "codeworks-orchestrator[bot]"
reviewer_app_login = "codeworks-reviewer[bot]"
planner_app_login = "codeworks-planner[bot]"

[planner]
app_id = 424242
"""
NO_FOLDERS = ADR_SETTINGS.replace('adr_folders = ["docs/adr"]', "adr_folders = []")
RULING = {"folder": "docs/adr", "record": "0004", "path": GOVERNED, "reason": "the user keeps discovery for x.ts"}

# The stop table's lines (contracts/workflow-steps.md), as much of each as these cases tell apart.
DEPARTURE = f"FAIL: docs/adr: 0004 on {GOVERNED}"
RULE_ON = f"resume with adr_ruling naming docs/adr, 0004, {GOVERNED} and your reason."
CHECK_AGAIN = ". Next step: resume to run the check again."
TOUCHES_MISSING = "COULD_NOT_RUN: touches.json: "
VERDICT_UNREAD = "COULD_NOT_RUN: adr-verdict.json: "
TASKS_UNFINISHED = "COULD_NOT_RUN: tasks.md: the tasks command did not answer"
TASKS_REFUSED = "FAIL: tasks.md:"
TASKS_REFUSED_NEXT = (". Next step: delete tasks.md, then resume: the next round writes it again from the plan; if the "
                      "line comes back, change spec.md or plan.md first.")
TASKS_EMPTY = ("COULD_NOT_RUN: tasks.md: no task line names a path. Next step: delete tasks.md, then resume: the next "
               "round writes it again from the plan.")
GUARD_RULINGS = (f"COULD_NOT_RUN: adr-rulings.json: entry docs/adr 0004 {GOVERNED} was not written by the check. "
                 "Next step: remove the entry; only a resume with adr_ruling adds one.")
RULING_REFUSED = "FAIL: adr_ruling: "
RULING_REFUSED_NEXT = ". Next step: resume with a corrected adr_ruling, or without one."
ROUNDS = (f"COULD_NOT_RUN: adr-check: the check ran 100 rounds in one run. Next step: discard the run's changes to "
          f"{SPEC_DIR}, then start again")
ROUNDS_RESCOPE = (f"restore {SPEC_DIR} to the branch's last commit and run /planner:issue-spec rescope {SPEC_DIR} "
                  f"#{ISSUE}")
UNAPPLIED_ON_STOP = f"ruling not applied: docs/adr 0004 {GOVERNED}. Next step: resume with it again."
UNAPPLIED_ON_COMPLETED = f"ruling not applied: docs/adr 0004 {GOVERNED}: the run completed with no departure on it."


def step_unfinished(step):
    return (f"COULD_NOT_RUN: adr-check: step {step} did not finish this round (no done record). Next step: fix what "
            "the step's error names, then resume.")


# A round's adr_check.ts calls when tasks.md is not due and ask leaves decide to run.
ROUND = ["clear", "tasks-due", "stories", "ask", "decide", "report"]
# Long enough for a model stand-in to write its file, short beside the stand-in that hangs.
MODEL_STEP_TIMEOUT = 5

# Stands in for the agent of every model step but specify, told apart by their prompts. The plan step writes
# $CLAUDE_PLAN and $CLAUDE_RESEARCH; the critique writes the one report the gate shows; the touches step writes
# touches.json from plan.md's backticked paths; the tasks command writes tasks.md with one US1 task per plan path (CLAUDE_TASKS_BROKEN:
# tagged US2, a story plan landing refuses; CLAUDE_TASKS_NO_PATHS: tasks naming no path); the judge writes a verdict
# with every governing record WITHIN but the `<entry> <id>` CLAUDE_DEPARTS names, and with CLAUDE_JUDGE_EDITS_PLAN
# adds a line to plan.md once. Once its file is written, CLAUDE_<STEP>_FAILS makes the touches step, the tasks
# command or the judge exit 1 with a line of its own, and CLAUDE_<STEP>_HANGS makes it outlast MODEL_STEP_TIMEOUT.
ADR_CLAUDE = '''#!@PYTHON@
import json, os, re, sys, time
prompt = sys.argv[2]
with open(@PROMPTS@, "a") as log:
    log.write(prompt + "\\n")
spec = os.environ["SPECIFY_FEATURE_DIRECTORY"]
named = re.search(r"run folder (\\S+)\\.$", prompt)
JUDGED = "\\nThe judge read this plan.\\n"


def plan_paths():
    with open(os.path.join(spec, "plan.md")) as plan:
        return list(dict.fromkeys(re.findall(r"`([A-Za-z0-9._-]+(?:/[A-Za-z0-9._-]+)+)`", plan.read())))


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as out:
        out.write(text)


def end(step):
    if os.environ.get(f"CLAUDE_{step}_FAILS"):
        sys.exit(f"the {step.lower()} step failed")
    if os.environ.get(f"CLAUDE_{step}_HANGS"):
        time.sleep(60)


if "adr-touches.md" in prompt:
    write(os.path.join(named[1], "touches.json"), json.dumps({"v": 1, "paths": plan_paths()}))
    end("TOUCHES")
elif "adr-judge.md" in prompt:
    with open(os.path.join(named[1], "adr-asked.json")) as record:
        asked = json.load(record)
    paths = list(dict.fromkeys(entry["path"] for entry in asked["paths"]))
    verdicts = []
    for folder in asked["folders"]:
        for governing in folder.get("governing", []):
            if os.environ.get("CLAUDE_DEPARTS") == f"{folder['entry']} {governing['recordId']}":
                judged = {"judgment": "DEPARTS", "paths": paths, "why": "it reads the folders from discovery"}
            else:
                judged = {"judgment": "WITHIN", "paths": [], "why": "it keeps to the record"}
            verdicts.append({"folder": folder["entry"], "record": governing["recordId"], **judged})
    write(os.path.join(named[1], "adr-verdict.json"), json.dumps({"v": 1, "verdicts": verdicts}))
    plan = os.path.join(spec, "plan.md")
    with open(plan) as f:
        text = f.read()
    if os.environ.get("CLAUDE_JUDGE_EDITS_PLAN") and JUDGED not in text:
        write(plan, text + JUDGED)
    end("JUDGE")
elif "speckit-tasks" in prompt:
    tag = "[US2]" if os.environ.get("CLAUDE_TASKS_BROKEN") else "[US1]"
    tasks = [f"- [ ] T{n:03} {tag} Change " + ("the check" if os.environ.get("CLAUDE_TASKS_NO_PATHS") else f"`{path}`")
             for n, path in enumerate(plan_paths(), 2)]
    write(os.path.join(spec, "tasks.md"),
          "# Tasks: demo\\n\\n## Phase 1: Setup\\n\\n- [ ] T001 Create the folders\\n\\n"
          "## Phase 2: User Story 1 - Check the plan (Priority: P1)\\n\\n" + "\\n".join(tasks) + "\\n")
    end("TASKS")
elif "speckit-critique-run" in prompt:
    write(os.path.join(spec, "critiques", "critique-1.md"), "# Critique\\n\\nNo finding.\\n")
elif "speckit-plan" in prompt:
    for name, variable in (("plan.md", "CLAUDE_PLAN"), ("research.md", "CLAUDE_RESEARCH")):
        write(os.path.join(spec, name), os.environ[variable])
'''

# Stands in for adrkit: docs/adr's 0004 governs core/src/x.ts.
ADR_STAND_IN = '''#!@PYTHON@
import json, sys
args = sys.argv[1:]
if args[0] == "--version":
    print(@VERSION@)
    sys.exit(0)
governing = [{"recordId": "0004", "title": "Read the ADR folders from settings"}] if @GOVERNED@ in args else []
print(json.dumps({"ok": True, "governing": governing, "findings": []}))
'''

# Project's node, keeping each adr_check.ts call with the ADR_RULING it was given and sending its GitHub calls to the
# stand-in GitHub; a subcommand ADR_CRASHES names is kept, then exits 1 with a line of its own in place of adr_check.ts,
# which never runs.
ADR_NODE = '''#!@PYTHON@
import json, os, sys
if sys.argv[1].endswith("/scripts/adr_check.ts"):
    with open(@NODE_LOG@, "a") as log:
        log.write(json.dumps({"args": sys.argv[2:], "adr_ruling": os.environ.get("ADR_RULING")}) + "\\n")
    if sys.argv[2] in os.environ.get("ADR_CRASHES", "").split():
        sys.exit(f"{sys.argv[2]} crashed")
    os.execv(@REAL_NODE@, [@REAL_NODE@, "--import", @GITHUB_AT@, *sys.argv[1:]])
if not sys.argv[1].endswith("/scripts/preflight.ts"):
    os.execv(@REAL_NODE@, [@REAL_NODE@, *sys.argv[1:]])
'''


def filled(script, **values):
    for name, value in {"PYTHON": sys.executable, **values}.items():
        script = script.replace(f"@{name}@", value if name == "PYTHON" else repr(value))
    return script


class GitHub:
    """Stands in for GitHub's API at a local address: keeps every call and answers it 404, so a step that reads
    GitHub stops rather than reaching the real one."""

    def __init__(self):
        calls = self.calls = []

        class Handler(BaseHTTPRequestHandler):
            def answer(self):
                calls.append(f"{self.command} {self.path}")
                body = b'{"message": "Not Found"}'
                self.send_response(404)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            do_GET = do_POST = do_PATCH = do_PUT = do_DELETE = answer

            def log_message(self, *args):
                """The test reads the calls kept, not the server's log."""

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class AdrCheck(unittest.TestCase):
    """The ADR check loop after the critique gate, in a checkout whose committed codeworks.toml lists docs/adr and
    sets planner's App; quickstart.md's test_drive_workflow.py cases."""

    def setUp(self):
        self.project = Project(UNANSWERED)
        self.addCleanup(self.project.close)
        self.github = GitHub()
        self.addCleanup(self.github.close)
        root = self.project.root
        (root / "docs" / "adr").mkdir(parents=True)
        self.commit_settings(ADR_SETTINGS)
        self.adr_log = root.parent / "adr-check.log"
        self.project.stand_in("claude", filled(ADR_CLAUDE, PROMPTS=str(self.project.prompts)))
        self.project.stand_in("adr", filled(ADR_STAND_IN, VERSION=ADR_VERSION, GOVERNED=GOVERNED))
        self.project.stand_in("node", filled(ADR_NODE, NODE_LOG=str(self.adr_log), REAL_NODE=shutil.which("node"),
                                             GITHUB_AT=str(GITHUB_AT)))
        self.project.env.update(CLAUDE_PLAN=ADR_PLAN, CLAUDE_RESEARCH=SETTLED_RESEARCH,
                                PLANNER_TEST_GITHUB_API=self.github.url)
        self.project.env.pop("ADR_RULING", None)

    def commit_settings(self, text):
        root = self.project.root
        (root / "codeworks.toml").write_text(text)
        git = ["git", "-C", str(root), "-c", "user.name=Dummy", "-c", "user.email=dummy@example.invalid"]
        subprocess.run([*git, "add", "codeworks.toml"], check=True)
        subprocess.run([*git, "commit", "-q", "-m", "settings"], check=True)

    def reach_the_check(self, changes=None):
        """A rescope approved at grill and at the critique gate, which runs on into the check loop; `changes` maps a
        step id to the settings the run's copy of the workflow gives that step."""
        proc, started = self.project.drive("rescope", self.project.spec_file(RESCOPE), ISSUE, SPEC_DIR)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        for step_id, settings in (changes or {}).items():
            self.change_step(started["run_id"], step_id, settings)
        critique = self.resume(started["run_id"], "grill_verdict=approve")
        self.assertEqual((critique["status"], critique["step"]), ("paused", "review-critique"), critique)
        return self.resume(started["run_id"], "critique_verdict=approve")

    def change_step(self, run_id, step_id, settings):
        """A resume runs the run's own copy of the workflow and refuses one whose steps differ from the root sequence
        of the run's execution tree, so the step changes in both."""
        run = self.run_folder(run_id)

        def changed(steps):
            found = [step for step in workflow_steps(steps) if step.get("id") == step_id]
            self.assertEqual(len(found), 1, f"the run's workflow has {len(found)} steps {step_id}, not one")
            found[0].update(settings)
            return steps

        workflow = yaml.safe_load((run / "workflow.yml").read_text())
        changed(workflow["steps"])
        (run / "workflow.yml").write_text(yaml.safe_dump(workflow, sort_keys=False))
        state = json.loads((run / "state.json").read_text())
        sequence = state["execution"]["sequence"]
        sequence["source"] = yaml.safe_dump(changed(yaml.safe_load(sequence["source"])), sort_keys=False)
        (run / "state.json").write_text(json.dumps(state))

    def resume(self, run_id, *args):
        proc, report = self.project.drive("resume", run_id, *args)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        return report

    def assert_stopped(self, report, step, starts, ends=""):
        """The run failed at `step` with `adr: true`, a line of its stderr starting with `starts` and ending `ends`."""
        self.assertEqual((report["status"], report["step"], report.get("adr")), ("failed", step, True), report)
        self.assertTrue(any(line.startswith(starts) and line.endswith(ends) for line in report["stderr"].splitlines()),
                        report["stderr"])

    def assert_step_error_shown(self, report, step):
        """The report carries the error state.json records for `step`, the step a stop names, under that step."""
        error = self.step_results(report["run_id"])[step]["error"]
        self.assertTrue(error, f"state.json records no error for {step}")
        self.assertIn(f"{step}: {error.strip()}", report["stderr"].splitlines())

    def departed(self):
        self.project.env["CLAUDE_DEPARTS"] = "docs/adr 0004"
        report = self.reach_the_check()
        self.assert_stopped(report, "adr-report", DEPARTURE, RULE_ON)
        return report

    def run_folder(self, run_id):
        return self.project.root / ".specify" / "workflows" / "runs" / run_id

    def left(self, report, name):
        """A file the round wrote in the run folder."""
        return json.loads((self.run_folder(report["run_id"]) / name).read_text())

    def step_results(self, run_id):
        return json.loads((self.run_folder(run_id) / "state.json").read_text())["step_results"]

    def adr_check_calls(self):
        """Each adr_check.ts call since the last one taken: (its arguments, its ADR_RULING)."""
        if not self.adr_log.exists():
            return []
        calls = [json.loads(line) for line in self.adr_log.read_text().splitlines()]
        self.adr_log.unlink()
        return [(call["args"], call["adr_ruling"]) for call in calls]

    def subcommands(self):
        return [args[0] for args, _ in self.adr_check_calls()]

    def prompts(self):
        return self.project.prompts.read_text()

    def tasks_commands(self):
        return self.prompts().count("speckit-tasks")

    def ruling_file(self, rulings):
        path = self.project.root.parent / "ruling.json"
        path.write_text(json.dumps(rulings))
        return path

    def rule(self, run_id, rulings=(RULING,)):
        """Resumes with `adr_ruling=@<file>`; the ADR_RULING each call was given is the file's text."""
        return self.resume(run_id, f"adr_ruling=@{self.ruling_file(list(rulings))}")

    def in_spec_folder(self, name):
        return self.project.root / SPEC_DIR / name

    def plan_names(self, path):
        plan = self.in_spec_folder("plan.md")
        plan.write_text(plan.read_text().replace(f"`{GOVERNED}`", f"`{path}`"))

    def break_tasks(self):
        tasks = self.in_spec_folder("tasks.md")
        tasks.write_text(tasks.read_text().replace("[US1]", "[US2]"))

    def hand_written_ruling(self):
        self.in_spec_folder("adr-rulings.json").write_text(json.dumps({"v": 1, "rulings": [RULING]}))

    # quickstart test_drive_workflow.py: "a run whose plan departs passes critique and stops at `adr-report`"; "a
    # stories, an ask and a decide stop each stop the run at `adr-report` and report `adr: true` with their lines"
    # — decide
    def test_a_run_whose_plan_departs_passes_critique_and_stops_at_adr_report(self):
        report = self.departed()
        results = self.step_results(report["run_id"])
        self.assertEqual({step: results[step]["status"] for step in ("critique", "review-critique", "adr-decide")},
                         dict.fromkeys(("critique", "review-critique", "adr-decide"), "completed"))
        self.assertNotIn("adr-rounds", results)
        self.assertNotIn("tasks", results)
        # A rescope's sub-issues are its existing stories, so its round reads none.
        self.assertEqual(self.github.calls, [])

    # quickstart test_drive_workflow.py: "a rescope runs the check loop, its first round writing `tasks.md` again"
    def test_a_rescope_runs_the_check_loop_and_its_first_round_writes_tasks_md_again(self):
        tasks = self.in_spec_folder("tasks.md")
        tasks.write_text("# Tasks: an earlier run's\n")
        report = self.reach_the_check()
        self.assertEqual(report["status"], "completed", report)
        self.assertEqual(self.tasks_commands(), 1)
        self.assertIn(f"`{GOVERNED}`", tasks.read_text())
        self.assertEqual(self.left(report, "touches.json"), {"v": 1, "paths": [GOVERNED]})
        self.assertEqual(self.subcommands(), ["clear", "tasks-due", "tasks-written", *ROUND[2:]])
        self.assertEqual(self.github.calls, [])

    # quickstart test_drive_workflow.py: "`resume <run> adr_ruling=@<file>` exports the file's content as
    # `ADR_RULING` to that call only, `inputs.json` gains no `adr_ruling`; every round of that call carries it, a
    # later round of it finding the ruling in the file and passing it without refusal"
    def test_a_resume_with_adr_ruling_carries_it_to_every_round_and_a_later_round_passes_it_without_refusal(self):
        report = self.departed()
        self.adr_check_calls()
        ruled = self.rule(report["run_id"])
        self.assertEqual(ruled["status"], "completed", ruled)
        calls = self.adr_check_calls()
        # The round that applies the ruling changes the rulings file it read, so report asks for one more.
        self.assertEqual([args[0] for args, _ in calls], ["report", *ROUND, *ROUND])
        self.assertEqual({given for _, given in calls}, {json.dumps([RULING])})
        self.assertEqual(json.loads(self.in_spec_folder("adr-rulings.json").read_text()), {"v": 1, "rulings": [RULING]})
        # Spec Kit qualifies only a loop's own steps; decide, inside an `if`, keeps its bare id, holding the last round's.
        decided = self.step_results(report["run_id"])["adr-decide"]
        self.assertEqual(decided["status"], "completed", decided)
        self.assertTrue(decided["output"]["stderr"].startswith("PASS: docs/adr: governing: 0004 "), decided)
        self.assertNotIn("adr_ruling", self.project.inputs(report["run_id"]))
        self.assertFalse(ruled.get("ruling_unapplied"), ruled)

    # quickstart test_drive_workflow.py: "... and the next resume carries none"; T032: "a ruling no round of the
    # resume applied or refused is named in `ruling_unapplied`"
    def test_adr_ruling_reaches_no_later_resume_and_one_no_round_applied_is_named_unapplied(self):
        """The resume that carries the ruling ends on the touches-missing stop ask records, so no decide reads it."""
        report = self.departed()
        self.project.env["CLAUDE_TOUCHES_FAILS"] = "1"
        self.adr_check_calls()
        carried = self.rule(report["run_id"])
        self.assert_stopped(carried, "adr-check:adr-report:1", TOUCHES_MISSING, CHECK_AGAIN)
        self.assertEqual([(args[0], given) for args, given in self.adr_check_calls()],
                         [(sub, json.dumps([RULING])) for sub in ("report", *ROUND[:4], "report")])
        self.assertEqual(carried.get("ruling_unapplied"), [UNAPPLIED_ON_STOP], carried)
        del self.project.env["CLAUDE_TOUCHES_FAILS"]
        resumed = self.resume(report["run_id"])
        self.assert_stopped(resumed, "adr-check:adr-report:2", DEPARTURE, RULE_ON)
        self.assertEqual({given for _, given in self.adr_check_calls()}, {None})
        self.assertFalse(self.in_spec_folder("adr-rulings.json").exists())
        self.assertFalse(resumed.get("ruling_unapplied"), resumed)

    # quickstart test_drive_workflow.py: "a resume with a ruling whose round stops at stories ... reports
    # `ruling_unapplied` naming it"
    def test_a_ruling_whose_round_stops_at_stories_is_named_unapplied(self):
        report = self.departed()
        self.in_spec_folder("tasks.md").unlink()
        self.project.env["CLAUDE_TASKS_BROKEN"] = "1"
        self.adr_check_calls()
        ruled = self.rule(report["run_id"])
        self.assert_stopped(ruled, "adr-check:adr-report:1", TASKS_REFUSED, TASKS_REFUSED_NEXT)
        self.assertNotIn("decide", self.subcommands())
        self.assertEqual(ruled.get("ruling_unapplied"), [UNAPPLIED_ON_STOP], ruled)

    # quickstart test_drive_workflow.py: "a resume with a ruling ... after which only a crashed report re-runs,
    # reports `ruling_unapplied` naming it"
    def test_a_ruling_after_which_only_a_crashed_report_runs_again_is_named_unapplied(self):
        self.project.env.update(CLAUDE_DEPARTS="docs/adr 0004", ADR_CRASHES="report")
        report = self.reach_the_check()
        self.assertEqual((report["status"], report["step"], report.get("adr")), ("failed", "adr-report", True), report)
        self.assertIn("report crashed", report["stderr"])
        del self.project.env["ADR_CRASHES"]
        self.adr_check_calls()
        ruled = self.rule(report["run_id"])
        self.assert_stopped(ruled, "adr-report", DEPARTURE, RULE_ON)
        self.assertEqual(self.subcommands(), ["report"])
        self.assertEqual(ruled.get("ruling_unapplied"), [UNAPPLIED_ON_STOP], ruled)

    # contracts/workflow-steps.md (drive_workflow.py): "on `completed`, `ruling not applied: <folder> <record> <path>:
    # the run completed with no departure on it.`" — an empty adr_folders passes, its decide reading no ruling
    def test_a_ruling_on_a_run_that_completes_with_no_departure_on_it_is_named_unapplied(self):
        report = self.departed()
        self.commit_settings(NO_FOLDERS)
        ruled = self.rule(report["run_id"])
        self.assertEqual(ruled["status"], "completed", ruled)
        self.assertEqual(ruled.get("ruling_unapplied"), [UNAPPLIED_ON_COMPLETED], ruled)
        self.assertFalse(self.in_spec_folder("adr-rulings.json").exists())

    # contracts/workflow-steps.md (drive_workflow.py): "unless the call's stderr holds a `ruling-refused` line"
    def test_a_ruling_decide_refused_is_not_named_unapplied(self):
        report = self.departed()
        ruled = self.rule(report["run_id"], [{**RULING, "record": "0005"}])
        self.assert_stopped(ruled, "adr-check:adr-report:1", RULING_REFUSED, RULING_REFUSED_NEXT)
        self.assertFalse(ruled.get("ruling_unapplied"), ruled)

    # quickstart test_drive_workflow.py: "`adr_ruling=<json>` with no `@` exits non-zero"
    def test_adr_ruling_not_naming_a_file_or_naming_one_it_cannot_read_exits_non_zero_before_resuming(self):
        report = self.departed()
        state = (self.run_folder(report["run_id"]) / "state.json").read_text()
        self.adr_check_calls()
        for value in (json.dumps([RULING]), f"@{self.project.root.parent / 'no-such-ruling.json'}"):
            with self.subTest(value=value):
                proc, _ = self.project.drive("resume", report["run_id"], f"adr_ruling={value}")
                self.assertNotEqual(proc.returncode, 0, proc.stdout)
                self.assertEqual((self.run_folder(report["run_id"]) / "state.json").read_text(), state)
                self.assertEqual(self.adr_check_calls(), [])

    # quickstart test_drive_workflow.py: "each resume after a stop runs a new round, so a plan changed before a resume
    # makes the touches step rewrite `touches.json` and the tasks command rewrite `tasks.md` from it"
    def test_a_plan_changed_before_a_resume_gets_touches_json_and_tasks_md_written_again_from_it(self):
        report = self.departed()
        self.plan_names(UNGOVERNED)
        resumed = self.resume(report["run_id"])
        self.assertEqual(resumed["status"], "completed", resumed)
        self.assertEqual(self.left(resumed, "touches.json"), {"v": 1, "paths": [UNGOVERNED]})
        tasks = self.in_spec_folder("tasks.md").read_text()
        self.assertIn(f"`{UNGOVERNED}`", tasks)
        self.assertNotIn(GOVERNED, tasks)
        self.assertEqual(self.tasks_commands(), 2)

    # quickstart test_drive_workflow.py: "a resume with nothing changed writes `tasks.md` no second time"
    def test_a_resume_with_nothing_changed_runs_no_tasks_command(self):
        report = self.departed()
        self.assertEqual(self.tasks_commands(), 1)
        seen = len(self.prompts())
        resumed = self.resume(report["run_id"])
        self.assert_stopped(resumed, "adr-check:adr-report:1", DEPARTURE, RULE_ON)
        self.assertIn("adr-touches.md", self.prompts()[seen:])
        self.assertNotIn("speckit-tasks", self.prompts()[seen:])

    # quickstart test_drive_workflow.py: "a touches step that writes a valid `touches.json` and then fails or times
    # out stops the run at `adr-report` with `adr: true`, the `touches-missing` line and the touches step's error
    # from `state.json`" — fails
    def test_a_touches_step_that_fails_reports_adr_with_the_touches_stop(self):
        self.project.env["CLAUDE_TOUCHES_FAILS"] = "1"
        report = self.reach_the_check()
        self.assert_stopped(report, "adr-report", TOUCHES_MISSING, CHECK_AGAIN)
        self.assert_step_error_shown(report, "adr-touches")
        self.assertEqual(self.left(report, "touches.json"), {"v": 1, "paths": [GOVERNED]})

    # quickstart test_drive_workflow.py: the touches sentence above — times out
    def test_a_touches_step_that_times_out_reports_adr_with_the_touches_stop(self):
        self.project.env["CLAUDE_TOUCHES_HANGS"] = "1"
        report = self.reach_the_check({"adr-touches": {"timeout": MODEL_STEP_TIMEOUT}})
        self.assert_stopped(report, "adr-report", TOUCHES_MISSING, CHECK_AGAIN)
        self.assert_step_error_shown(report, "adr-touches")
        self.assertEqual(self.left(report, "touches.json"), {"v": 1, "paths": [GOVERNED]})

    # quickstart test_drive_workflow.py: "a crash at any step from touches to decide stops the run at `adr-report`
    # with `adr: true` (`step-unfinished` naming a shell step with its error ...), and the resume runs a new round
    # from clear; when `plan.md`, `tasks.md` or the rulings file changed before that resume, the new round checks them
    # as they stand"
    def test_a_crashed_shell_step_stops_with_step_unfinished_and_the_resume_checks_the_files_as_they_stand(self):
        plan, tasks, rulings = "plan.md", "tasks.md", "adr-rulings.json"
        # The edit a crash is resumed after: tasks.md only once a finished tasks command has written it.
        cases = (("tasks-due", plan), ("tasks-written", rulings), ("stories", tasks), ("ask", rulings),
                 ("decide", tasks))
        edits = {plan: lambda: self.plan_names(UNGOVERNED), tasks: self.break_tasks, rulings: self.hand_written_ruling}
        for subcommand, edited in cases:
            with self.subTest(crash=subcommand, edited=edited):
                self.setUp()
                self.project.env["ADR_CRASHES"] = subcommand
                report = self.reach_the_check()
                self.assert_stopped(report, "adr-report", step_unfinished(f"adr-{subcommand}"))
                self.assert_step_error_shown(report, f"adr-{subcommand}")
                self.assertIn(f"adr-{subcommand}: {subcommand} crashed", report["stderr"].splitlines())
                del self.project.env["ADR_CRASHES"]
                edits[edited]()
                self.adr_check_calls()
                resumed = self.resume(report["run_id"])
                self.assertEqual(self.subcommands()[:2], ["report", "clear"], resumed)
                if edited == plan:
                    self.assertEqual(resumed["status"], "completed", resumed)
                    self.assertEqual(self.left(resumed, "touches.json"), {"v": 1, "paths": [UNGOVERNED]})
                    self.assertIn(f"`{UNGOVERNED}`", self.in_spec_folder("tasks.md").read_text())
                elif edited == tasks:
                    self.assert_stopped(resumed, "adr-check:adr-report:1", TASKS_REFUSED, TASKS_REFUSED_NEXT)
                else:
                    self.assert_stopped(resumed, "adr-check:adr-report:1", GUARD_RULINGS)

    # quickstart test_drive_workflow.py: "a decide that fails every round stops at each resume and fails the run at
    # `adr-rounds` after 100"
    def test_a_decide_that_fails_every_round_stops_at_each_resume_and_fails_the_run_at_adr_rounds(self):
        """The run's copy of the workflow allows the loop 2 rounds, so the resume after the second stop finds it out
        of rounds."""
        self.project.env["ADR_CRASHES"] = "decide"
        report = self.reach_the_check({"adr-check": {"max_iterations": 2}})
        self.assert_stopped(report, "adr-report", step_unfinished("adr-decide"))
        self.assert_stopped(self.resume(report["run_id"]), "adr-check:adr-report:1", step_unfinished("adr-decide"))
        self.assert_out_of_rounds(self.resume(report["run_id"]))

    def assert_out_of_rounds(self, report):
        self.assert_stopped(report, "adr-rounds", ROUNDS)
        [line] = report["stderr"].splitlines()
        self.assertIn(ROUNDS_RESCOPE, line)

    # quickstart test_drive_workflow.py: "a judge that edits `plan.md` gets a new round, not a pass"
    def test_a_judge_that_edits_plan_md_gets_a_new_round_not_a_pass(self):
        self.project.env["CLAUDE_JUDGE_EDITS_PLAN"] = "1"
        report = self.reach_the_check()
        self.assertEqual(report["status"], "completed", report)
        self.assertIn("adr-check:adr-report:1", self.step_results(report["run_id"]))
        self.assertEqual(self.prompts().count("adr-judge.md"), 2)
        # plan.md is a tasks source, so the new round writes tasks.md again.
        self.assertEqual(self.tasks_commands(), 2)

    # quickstart test_drive_workflow.py: "a tasks command that crashes stops the run with `tasks-unfinished` and leaves
    # the next round due"
    def test_a_tasks_command_that_fails_stops_with_tasks_unfinished_and_leaves_the_next_round_due(self):
        self.project.env["CLAUDE_TASKS_FAILS"] = "1"
        report = self.reach_the_check()
        self.assert_stopped(report, "adr-report", TASKS_UNFINISHED, CHECK_AGAIN)
        self.assert_step_error_shown(report, "adr-tasks")
        del self.project.env["CLAUDE_TASKS_FAILS"]
        resumed = self.resume(report["run_id"])
        self.assertEqual(resumed["status"], "completed", resumed)
        self.assertEqual(self.tasks_commands(), 2)

    # quickstart test_drive_workflow.py: "a stop in a round after the first, reported under a qualified id
    # (`adr-check:adr-report:1`), reports `adr: true`"
    def test_a_stop_in_a_later_round_reports_adr_under_its_qualified_id(self):
        report = self.departed()
        self.assert_stopped(self.resume(report["run_id"]), "adr-check:adr-report:1", DEPARTURE, RULE_ON)

    # quickstart test_drive_workflow.py: "a loop that runs 100 rounds fails the run at `adr-rounds` with `adr: true`"
    def test_a_loop_that_stops_at_every_round_fails_the_run_at_adr_rounds(self):
        """The run's copy of the workflow allows the loop 2 rounds, so the resume after the second stop finds it out
        of rounds."""
        self.project.env["CLAUDE_DEPARTS"] = "docs/adr 0004"
        report = self.reach_the_check({"adr-check": {"max_iterations": 2}})
        self.assert_stopped(report, "adr-report", DEPARTURE, RULE_ON)
        self.assert_stopped(self.resume(report["run_id"]), "adr-check:adr-report:1", DEPARTURE, RULE_ON)
        self.assert_out_of_rounds(self.resume(report["run_id"]))

    # quickstart test_drive_workflow.py: "a stories, an ask and a decide stop each stop the run at `adr-report` and
    # report `adr: true` with their lines" — stories
    def test_a_stories_stop_stops_the_run_at_adr_report_with_its_line(self):
        self.project.env["CLAUDE_TASKS_BROKEN"] = "1"
        report = self.reach_the_check()
        self.assert_stopped(report, "adr-report", TASKS_REFUSED, TASKS_REFUSED_NEXT)
        self.assertNotIn("decide", self.subcommands())

    # quickstart test_drive_workflow.py: the stop sentence above — ask
    def test_an_ask_stop_stops_the_run_at_adr_report_with_its_line(self):
        self.project.env["CLAUDE_TASKS_NO_PATHS"] = "1"
        report = self.reach_the_check()
        self.assert_stopped(report, "adr-report", TASKS_EMPTY)
        self.assertNotIn("decide", self.subcommands())

    # quickstart test_drive_workflow.py: "a judge that writes a valid verdict and then fails or times out stops the
    # run at `adr-report` with `adr: true`, the `verdict-unread` line and the judge's error from `state.json`, and the
    # resume runs a new round" — fails
    def test_a_judge_that_fails_reports_adr_with_the_judge_stop(self):
        self.project.env["CLAUDE_JUDGE_FAILS"] = "1"
        report = self.reach_the_check()
        self.assert_stopped(report, "adr-report", VERDICT_UNREAD, CHECK_AGAIN)
        self.assert_step_error_shown(report, "adr-judge")
        self.assert_verdict_left(report)
        del self.project.env["CLAUDE_JUDGE_FAILS"]
        seen = len(self.prompts())
        self.adr_check_calls()
        resumed = self.resume(report["run_id"])
        self.assertEqual(resumed["status"], "completed", resumed)
        self.assertEqual(self.subcommands(), ["report", *ROUND])
        self.assertIn("adr-judge.md", self.prompts()[seen:])

    # quickstart test_drive_workflow.py: the judge sentence above — times out
    def test_a_judge_timeout_reports_adr_with_the_judge_stop(self):
        self.project.env["CLAUDE_JUDGE_HANGS"] = "1"
        report = self.reach_the_check({"adr-judge": {"timeout": MODEL_STEP_TIMEOUT}})
        self.assert_stopped(report, "adr-report", VERDICT_UNREAD, CHECK_AGAIN)
        self.assert_step_error_shown(report, "adr-judge")
        self.assert_verdict_left(report)

    def assert_verdict_left(self, report):
        """The judge wrote a valid verdict before it failed, so the stop is its exit code's, not the file's."""
        verdict = self.left(report, "adr-verdict.json")
        self.assertEqual({v["judgment"] for v in verdict["verdicts"]}, {"WITHIN"}, verdict)

    # quickstart test_drive_workflow.py: "a round whose ask says no judge shows no judge error from an earlier round"
    def test_a_round_whose_ask_says_no_judge_shows_no_judge_error_from_an_earlier_round(self):
        """The judge sits inside an `if`, so Spec Kit keys it by its bare id, which still holds the failed round's
        entry."""
        self.project.env["CLAUDE_JUDGE_FAILS"] = "1"
        report = self.reach_the_check()
        self.assert_stopped(report, "adr-report", VERDICT_UNREAD, CHECK_AGAIN)
        judge_error = self.step_results(report["run_id"])["adr-judge"]["error"]
        del self.project.env["CLAUDE_JUDGE_FAILS"]
        self.project.env["CLAUDE_TOUCHES_FAILS"] = "1"
        seen = len(self.prompts())
        resumed = self.resume(report["run_id"])
        self.assert_stopped(resumed, "adr-check:adr-report:1", TOUCHES_MISSING, CHECK_AGAIN)
        results = self.step_results(report["run_id"])
        self.assertIs(results["adr-check:adr-ask:1"]["output"]["data"]["judge"], False, results["adr-check:adr-ask:1"])
        self.assertNotIn("adr-judge.md", self.prompts()[seen:])
        self.assertEqual(results["adr-judge"]["error"], judge_error)
        self.assert_step_error_shown(resumed, "adr-touches")
        self.assertFalse([line for line in resumed["stderr"].splitlines() if line.startswith("adr-judge:")], resumed)


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

    def report_of(self, step, failed, stderr):
        """report() of a run failed at `step` with that stderr, refusing any command it would run."""
        record = {"status": "failed", "error": failed, "output": {"exit_code": 2, "stdout": "", "stderr": stderr}}
        with mock.patch.object(drive_workflow.subprocess, "run", side_effect=AssertionError("report() ran a command")):
            return drive_workflow.report({**self.failed(step, {step: record}), "error": failed})

    def test_a_check_step_that_can_fail_the_run_reports_adr_with_its_own_stderr(self):
        """Past adr-clear only report and the rounds step have no continue_on_error; in a round after the first,
        specify names a step by a qualified id."""
        said = "COULD_NOT_RUN: git: not a git repository. Next step: run from a git checkout of the repo, then resume.\n"
        for step in ("adr-clear", "adr-report", "adr-rounds", "adr-check:adr-clear:1", "adr-check:adr-report:2"):
            with self.subTest(step=step):
                out = self.report_of(step, "Shell command exited with code 2.", said)
                self.assertEqual((out.get("adr"), out["stderr"]), (True, said))

    def test_a_failed_adr_settled_design_reports_no_adr_and_its_own_stderr(self):
        own = "the step's own stderr"
        for step in ("adr-settled-design", "adr-check:adr-settled-design:1"):
            with self.subTest(step=step):
                out = self.report_of(step, "Shell command exited with code 1.", own)
                self.assertEqual((out.get("adr", False), out["stderr"]), (False, own))

    def test_a_check_step_that_continues_on_error_reports_no_adr_and_its_own_stderr(self):
        own = "the step's own stderr"
        for step in ("adr-touches", "adr-tasks-due", "adr-tasks", "adr-tasks-written", "adr-stories", "adr-ask",
                     "adr-judge", "adr-decide", "adr-check:adr-ask:1"):
            with self.subTest(step=step):
                out = self.report_of(step, "Prompt timed out after 1800 seconds.", own)
                self.assertEqual((out.get("adr", False), out["stderr"]), (False, own))

    def test_a_step_outside_the_adr_check_reports_no_adr(self):
        for step in ("settled-design", "other-loop:settled-design:1"):
            with self.subTest(step=step):
                self.assertFalse(drive_workflow.report(self.failed(step, {})).get("adr", False))


class ResumeHandsSpecify(unittest.TestCase):
    """What resume() hands `specify`: a ruling only as ADR_RULING of the resume that carries it, never as an argument,
    and never one the driver's own environment carries."""

    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        runs = Path(tmp.name) / "runs"
        (runs / "r1").mkdir(parents=True)
        (runs / "r1" / "state.json").write_text(json.dumps({"run_id": "r1", "status": "completed"}))
        (runs / "r1" / "inputs.json").write_text(
            json.dumps({"inputs": {"issue": ISSUE, "spec_dir": SPEC_DIR, "kind": "rescope"}}))
        self.ruling = Path(tmp.name) / "ruling.json"
        self.ruling.write_text(json.dumps([RULING]))
        for patch in (mock.patch.object(drive_workflow, "RUNS", runs),
                      mock.patch.dict(os.environ, {"ADR_RULING": json.dumps([{**RULING, "reason": "a stale ruling"}])})):
            patch.start()
            self.addCleanup(patch.stop)

    def handed(self, verdict):
        """The argv and environment of the one `specify` call resume() made."""
        done = subprocess.CompletedProcess([], 0, "", "")
        with mock.patch.object(drive_workflow.subprocess, "run", return_value=done) as run:
            drive_workflow.resume("r1", verdict)
        [call] = run.call_args_list
        return call.args[0], call.kwargs["env"]

    def test_a_ruling_at_a_file_reaches_specify_as_adr_ruling_and_on_no_command_line(self):
        argv, env = self.handed(f"adr_ruling=@{self.ruling}")
        self.assertEqual(argv, ["specify", "workflow", "resume", "r1", "--json"])
        self.assertEqual(env.get("ADR_RULING"), self.ruling.read_text())

    def test_a_resume_with_no_ruling_hands_specify_none_from_the_drivers_environment(self):
        for verdict in (None, "critique_verdict=approve"):
            with self.subTest(verdict=verdict):
                _, env = self.handed(verdict)
                # Never the whole environment in a failure message: it carries the session's secrets.
                self.assertIsNone(env.get("ADR_RULING"))


if __name__ == "__main__":
    unittest.main()
