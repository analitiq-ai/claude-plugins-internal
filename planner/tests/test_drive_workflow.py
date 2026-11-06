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


def drive(root, env, *args, driver=DRIVER):
    proc = subprocess.run([sys.executable, str(driver), *args], cwd=root, env=env, capture_output=True, text=True,
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
        # Preflight reads GitHub, so it is kept and passes unless PREFLIGHT_STOP names the stop to print. Every
        # other script a rescope runs reads only the checkout and the stand-ins, so the real node runs it, but an
        # adr_check.ts subcommand the crash file names, which exits as a crashed step would.
        self.driver = DRIVER
        real_node = shutil.which("node")
        self.node_crash = Path(self._tmp.name) / "node-crash"
        self.stand_in("node", f"#!{sys.executable}\nimport json, os, sys\n"
                              f"crash = {str(self.node_crash)!r}\n"
                              "if (sys.argv[1].endswith('/scripts/adr_check.ts') and os.path.exists(crash)\n"
                              "        and open(crash).read() == sys.argv[2]):\n"
                              "    sys.exit(f'crashed in {sys.argv[2]}')\n"
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
        return drive(self.root, self.env, *args, driver=self.driver)

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


# The plan check's fixture (specs/177-plan-adr-check). Stands in for every agent step of a rescope: the plan step
# writes a plan settled_design.py passes, critique a report, the touches step `touches.json`, the tasks command
# `tasks.md`, the judge a verdict from the asked record. Each but critique reads what to do from the control folder
# the test writes; each logs its prompt and the ADR_RULING it was given.
CHECK_CLAUDE = '''#!{python}
import glob, json, os, re, sys
prompt = sys.argv[2]
control = {control!r}


def said(name, default=None):
    path = os.path.join(control, name)
    return open(path).read() if os.path.exists(path) else default


def write(path, text):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w") as out:
        out.write(text)


with open({prompts!r}, "a") as log:
    log.write(json.dumps({{"prompt": prompt, "ruling": os.environ.get("ADR_RULING")}}) + "\\n")
spec = os.environ["SPECIFY_FEATURE_DIRECTORY"]
named = re.search(r"for spec folder (\\S+), run folder (\\S+)\\.", prompt)
run = named[2] if named else None
if "speckit-plan" in prompt:
    write(os.path.join(spec, "plan.md"), said("plan.md"))
    write(os.path.join(spec, "research.md"), said("research.md"))
elif "speckit-critique" in prompt:
    write(os.path.join(spec, "critiques", f"critique-{{len(glob.glob(os.path.join(spec, 'critiques', '*')))}}.md"), "# Critique\\n")
elif "adr-touches.md" in prompt:
    write(os.path.join(run, "touches.json"), said("touches.json"))
    sys.exit(int(said("touches-exit", "0")))
elif "speckit-tasks" in prompt:
    if said("tasks-crash"):
        sys.exit(int(said("tasks-crash")))
    if not said("tasks-none"):
        write(os.path.join(spec, "tasks.md"), said("tasks.md"))
    sys.exit(int(said("tasks-exit", "0")))
elif "adr-judge.md" in prompt:
    asked = json.load(open(os.path.join(run, "adr-asked.json")))
    departs = json.loads(said("departs", "{{}}"))
    verdicts = [{{"folder": folder["entry"], "record": record["recordId"],
                  "judgment": "DEPARTS" if record["recordId"] in departs else "WITHIN",
                  "paths": departs.get(record["recordId"], []), "why": "the stand-in judge's reason"}}
                for folder in asked["folders"] for record in folder.get("governing", [])]
    write(os.path.join(run, "adr-verdict.json"), json.dumps({{"v": 1, "verdicts": verdicts}}))
    if said("judge-edits-plan"):
        with open(os.path.join(spec, "plan.md"), "a") as plan:
            plan.write("\\nEdited by the judge.\\n")
    sys.exit(int(said("judge-exit", "0")))
'''

# Stands in for adrkit 0.20.0: `check` names each record of its folder that governs a path it was given.
CHECK_ADR = '''#!{python}
import json, sys
args = sys.argv[1:]
if args == ["--version"]:
    print("0.20.0")
    sys.exit(0)
folder = args[args.index("--dir") + 1]
paths = args[args.index("--") + 1:]
records = json.load(open({answers!r})).get(folder, [])
governing = [{{"recordId": r["recordId"], "title": r["title"]}} for r in records if set(r["governs"]) & set(paths)]
print(json.dumps({{"ok": True, "governing": governing, "findings": []}}))
'''

CHECK_SETTINGS = """[shared]
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
CHECK_PLAN = "# Plan\n\nChange core/src/x.ts.\n\n## Mechanisms\n\n- Retry budget: R1\n"
CHECK_RESEARCH = ("# Research\n\n## R1: Retry budget\n\n- **Decision**: a counter.\n- **Rationale**: it is enough.\n"
                  "- **Existing tools**: None fit. Looked at: the standard library.\n")
CHECK_TASKS = ("# Tasks\n\n## Phase 1: User Story 1 - Retry (Priority: P1)\n\n"
               "- [ ] T001 [US1] Change `core/src/x.ts`\n")
RECORD_0004 = {"recordId": "0004", "title": "Retries are bounded", "governs": ["core/src/x.ts"]}


class CheckProject(Project):
    """A Project whose rescope reaches planner's plan check: `codeworks.toml` committed with `[planner] app_id` and
    `adr_folders`, a stand-in `adr` answering for `docs/adr`, and a stand-in agent for every agent step."""

    def __init__(self):
        super().__init__(TRACED)
        self.control = Path(self._tmp.name) / "control"
        self.control.mkdir()
        self.answers = Path(self._tmp.name) / "adr-answers.json"
        self.adr_answers({"docs/adr": [RECORD_0004]})
        self.stand_in("claude", CHECK_CLAUDE.format(python=sys.executable, control=str(self.control),
                                                    prompts=str(self.prompts)))
        self.stand_in("adr", CHECK_ADR.format(python=sys.executable, answers=str(self.answers)))
        self.set("plan.md", CHECK_PLAN)
        self.set("research.md", CHECK_RESEARCH)
        self.set("touches.json", json.dumps({"v": 1, "paths": ["core/src/x.ts"]}))
        self.set("tasks.md", CHECK_TASKS)
        (self.root / "codeworks.toml").write_text(CHECK_SETTINGS)
        (self.root / "docs" / "adr").mkdir(parents=True)
        (self.root / "docs" / "adr" / "0004-retries.md").write_text("# 0004 Retries are bounded\n")
        git = ["git", "-C", str(self.root), "-c", "user.name=Dummy", "-c", "user.email=dummy@example.invalid"]
        subprocess.run([*git, "add", "codeworks.toml", "docs"], check=True)
        subprocess.run([*git, "commit", "-q", "-m", "seed"], check=True)
        subprocess.run([*git, "remote", "add", "origin", "https://github.com/acme/demo.git"], check=True)
        self.env["HOME"] = str(Path(self._tmp.name) / "home")

    def with_rounds(self, rounds):
        """Drive the run from a copy of the plugin whose check loop stops after `rounds`: specify keeps the workflow
        a run started with, and refuses a resume once its copy is edited. The copy's skills folder holds its driver
        alone, which installs the copy's workflow; every other entry links to the plugin's own."""
        plugin = Path(self._tmp.name) / "plugin"
        plugin.mkdir()
        for entry in drive_workflow.PLUGIN.iterdir():
            if entry.name not in ("speckit", "skills"):
                (plugin / entry.name).symlink_to(entry)
        shutil.copytree(drive_workflow.PLUGIN / "speckit", plugin / "speckit")
        workflow = plugin / "speckit" / "workflows" / "issue-spec" / "workflow.yml"
        assert workflow.read_text().count("max_iterations: 100") == 1
        workflow.write_text(workflow.read_text().replace("max_iterations: 100", f"max_iterations: {rounds}"))
        self.driver = plugin / DRIVER.resolve().relative_to(drive_workflow.PLUGIN)
        self.driver.parent.mkdir(parents=True)
        shutil.copy(DRIVER, self.driver)

    def adr_answers(self, answers):
        self.answers.write_text(json.dumps(answers))

    def set(self, name, text):
        """What a stand-in agent step does, by the control file it reads; None removes it."""
        if text is None:
            (self.control / name).unlink(missing_ok=True)
        else:
            (self.control / name).write_text(text)

    def calls(self, marker):
        """Each stand-in agent call whose prompt holds `marker`: (prompt, ADR_RULING)."""
        return [(c["prompt"], c["ruling"]) for c in map(json.loads, self.prompts.read_text().splitlines())
                if marker in c["prompt"]]

    def to_the_check(self):
        """A rescope driven through grill and critique; the report of the resume that enters the check loop."""
        proc, started = self.drive("rescope", self.spec_file(RESCOPE), ISSUE, SPEC_DIR)
        assert proc.returncode == 0, proc.stderr
        proc, critique = self.drive("resume", started["run_id"], "grill_verdict=approve")
        assert proc.returncode == 0, proc.stderr
        assert (critique["status"], critique["step"]) == ("paused", "review-critique"), critique
        proc, report = self.drive("resume", started["run_id"], "critique_verdict=approve")
        assert proc.returncode == 0, proc.stderr
        return report

    def resume(self, run_id, *given):
        proc, report = self.drive("resume", run_id, *given)
        assert proc.returncode == 0, proc.stderr
        return report

    def run_file(self, run_id, name):
        return self.root / ".specify" / "workflows" / "runs" / run_id / name

    def state(self, run_id):
        return json.loads(self.run_file(run_id, "state.json").read_text())


RULED = {"folder": "docs/adr", "record": "0004", "path": "core/src/x.ts", "reason": "the user accepts it"}
DEPARTURE = "FAIL: docs/adr: 0004 on core/src/x.ts (story US1): the stand-in judge's reason."


class CheckLoop(unittest.TestCase):
    """planner's plan check, as the driver reports it (specs/177-plan-adr-check, US3)."""

    def setUp(self):
        self.project = CheckProject()
        self.addCleanup(self.project.close)

    def departing(self):
        self.project.set("departs", json.dumps({"0004": ["core/src/x.ts"]}))
        report = self.project.to_the_check()
        self.assertEqual((report["status"], report["step"], report.get("adr")), ("failed", "adr-report", True), report)
        return report

    def ruling_file(self, rulings):
        path = self.project.root.parent / "ruling.json"
        path.write_text(json.dumps(rulings))
        return f"adr_ruling=@{path}"

    def assertStopped(self, report, *lines):
        self.assertEqual((report["status"], report.get("adr")), ("failed", True), report)
        self.assertRegex(report["step"], r"^(adr-check:)?adr-report(:\d+)?$")
        for line in lines:
            self.assertIn(line, report["stderr"])

    def test_a_rescope_runs_the_check_loop_writing_tasks_md_again_and_completes_within_its_records(self):
        (self.project.root / SPEC_DIR / "tasks.md").write_text("# Tasks of the spec before the rescope\n")
        report = self.project.to_the_check()
        self.assertEqual(report["status"], "completed", report)
        self.assertNotIn("adr", report)
        self.assertEqual((self.project.root / SPEC_DIR / "tasks.md").read_text(), CHECK_TASKS)
        self.assertEqual([len(self.project.calls(m)) for m in ("adr-touches.md", "speckit-tasks", "adr-judge.md")], [1, 1, 1])

    def test_a_departing_plan_passes_critique_and_stops_at_adr_report_with_its_line(self):
        report = self.departing()
        self.assertEqual(report["stderr"].splitlines()[0].split(" Next step: ")[0], DEPARTURE)
        self.assertNotIn("ruling_unapplied", report)

    def test_a_stop_in_a_later_round_reports_adr_under_its_qualified_id(self):
        report = self.project.resume(self.departing()["run_id"])
        self.assertEqual(report["step"], "adr-check:adr-report:1")
        self.assertStopped(report, DEPARTURE)

    def test_a_resume_with_nothing_changed_writes_tasks_md_once_and_one_after_a_plan_change_writes_both_again(self):
        run_id = self.departing()["run_id"]
        self.project.resume(run_id)
        self.assertEqual([len(self.project.calls(m)) for m in ("adr-touches.md", "speckit-tasks")], [2, 1])
        plan = self.project.root / SPEC_DIR / "plan.md"
        plan.write_text(plan.read_text() + "\nChanged before the resume.\n")
        self.project.resume(run_id)
        self.assertEqual([len(self.project.calls(m)) for m in ("adr-touches.md", "speckit-tasks")], [3, 2])

    def test_a_ruling_reaches_every_round_of_its_resume_and_no_later_resume(self):
        self.project.adr_answers({"docs/adr": [RECORD_0004, {"recordId": "0005", "title": "Five", "governs": ["core/src/x.ts"]}]})
        self.project.set("departs", json.dumps({"0004": ["core/src/x.ts"], "0005": ["core/src/x.ts"]}))
        report = self.project.to_the_check()
        report = self.project.resume(report["run_id"], self.ruling_file([RULED]))
        self.assertStopped(report, "0005 on core/src/x.ts")
        self.assertNotIn("0004 on core/src/x.ts", report["stderr"])
        self.assertNotIn("ruling_unapplied", report)
        rulings = json.loads((self.project.root / SPEC_DIR / "adr-rulings.json").read_text())["rulings"]
        self.assertEqual(rulings, [RULED])
        self.assertNotIn("adr_ruling", self.project.inputs(report["run_id"]))
        judged = [ruling for _, ruling in self.project.calls("adr-judge.md")]
        # The round that appended it asks for another, whose judge the ruling reaches too.
        self.assertEqual(judged, [None, json.dumps([RULED]), json.dumps([RULED])])
        self.project.resume(report["run_id"])
        self.assertIsNone(self.project.calls("adr-judge.md")[-1][1])

    def test_a_ruling_on_the_departure_completes_the_run(self):
        report = self.project.resume(self.departing()["run_id"], self.ruling_file([RULED]))
        self.assertEqual(report["status"], "completed", report)
        self.assertNotIn("ruling_unapplied", report)

    def test_a_ruling_whose_rounds_stop_before_decide_is_named_unapplied(self):
        run_id = self.departing()["run_id"]
        self.project.set("touches-exit", "1")
        report = self.project.resume(run_id, self.ruling_file([RULED]))
        self.assertStopped(report, "COULD_NOT_RUN: touches.json: the touches step did not answer")
        self.assertEqual(report["ruling_unapplied"],
                         ["ruling not applied: docs/adr 0004 core/src/x.ts. Next step: resume with it again."])

    def test_a_refused_ruling_is_not_named_unapplied(self):
        report = self.project.resume(self.departing()["run_id"], self.ruling_file([{**RULED, "record": "0009"}]))
        self.assertStopped(report, "FAIL: adr_ruling: ")
        self.assertNotIn("ruling_unapplied", report)

    def test_a_ruling_the_schema_refuses_is_not_named_unapplied(self):
        unreasoned = {key: value for key, value in RULED.items() if key != "reason"}
        report = self.project.resume(self.departing()["run_id"], self.ruling_file([unreasoned]))
        self.assertStopped(report, "FAIL: adr_ruling: not rulings: ")
        self.assertNotIn("ruling_unapplied", report)

    def test_an_adr_ruling_without_a_file_exits_before_resuming(self):
        run_id = self.departing()["run_id"]
        before = self.project.state(run_id)
        not_rulings = self.project.root.parent / "not-rulings.json"
        not_rulings.write_text(json.dumps([{**RULED, "path": ["core/src/x.ts"]}]))
        for given in (f"adr_ruling={json.dumps([RULED])}", f"adr_ruling=@{self.project.root.parent / 'none.json'}",
                      f"adr_ruling=@{not_rulings}"):
            with self.subTest(given=given):
                proc, _ = self.project.drive("resume", run_id, given)
                self.assertNotEqual(proc.returncode, 0)
                self.assertIn("adr_ruling", proc.stderr)
                self.assertEqual(self.project.state(run_id), before)

    def test_a_touches_step_that_answers_then_fails_stops_with_touches_missing_and_its_error(self):
        self.project.set("touches-exit", "1")
        report = self.project.to_the_check()
        self.assertStopped(report, "COULD_NOT_RUN: touches.json: the touches step did not answer")
        self.assertIn("exited with code 1", report["step_errors"]["adr-touches"])

    def test_a_judge_that_answers_then_fails_stops_with_verdict_unread_and_its_error_and_the_resume_runs_a_new_round(self):
        self.project.set("judge-exit", "3")
        report = self.project.to_the_check()
        self.assertStopped(report, "COULD_NOT_RUN: adr-verdict.json: the judge did not answer")
        self.assertIn("exited with code 3", report["step_errors"]["adr-judge"])
        self.project.set("judge-exit", None)
        self.assertEqual(self.project.resume(report["run_id"])["status"], "completed")
        self.assertEqual((len(self.project.calls("adr-touches.md")), len(self.project.calls("adr-judge.md"))), (2, 2))

    def test_a_later_round_in_which_the_judge_did_not_run_shows_no_earlier_judge_error(self):
        self.project.set("judge-exit", "3")
        first = self.project.to_the_check()
        self.assertIn("adr-judge", first["step_errors"])
        run_id = first["run_id"]
        self.project.adr_answers({"docs/adr": []})
        self.project.set("tasks.md", CHECK_TASKS.replace("[US1]", "[US2]"))
        (self.project.root / SPEC_DIR / "plan.md").write_text(CHECK_PLAN + "\nChanged.\n")
        report = self.project.resume(run_id)
        self.assertStopped(report, "FAIL: tasks.md: ")
        self.assertNotIn("adr-judge", report.get("step_errors", {}))

    def test_a_tasks_command_that_crashes_stops_with_tasks_unfinished_and_leaves_the_next_round_due(self):
        self.project.set("tasks-crash", "4")
        report = self.project.to_the_check()
        self.assertStopped(report, "COULD_NOT_RUN: tasks.md: the tasks command did not answer")
        self.assertIn("exited with code 4", report["step_errors"]["adr-tasks"])
        self.project.set("tasks-crash", None)
        self.assertEqual(self.project.resume(report["run_id"])["status"], "completed")
        self.assertEqual(len(self.project.calls("speckit-tasks")), 2)

    def test_a_tasks_command_that_answers_without_writing_tasks_md_stops_naming_it_missing_and_the_resume_runs_a_new_round(self):
        self.project.set("tasks-none", "1")
        report = self.project.to_the_check()
        self.assertStopped(report, "FAIL: tasks.md: tasks.md is missing")
        self.project.set("tasks-none", None)
        self.assertEqual(self.project.resume(report["run_id"])["status"], "completed")
        self.assertEqual(len(self.project.calls("adr-touches.md")), 2)

    def test_a_crashed_check_step_stops_with_step_unfinished_and_its_error_and_the_resume_runs_a_new_round(self):
        for step in ("tasks-due", "tasks-written", "stories", "ask", "decide"):
            with self.subTest(step=step):
                project = CheckProject()
                self.addCleanup(project.close)
                project.node_crash.write_text(step)
                report = project.to_the_check()
                self.assertStopped(report, f"COULD_NOT_RUN: adr-check: step adr-{step} did not finish this round")
                self.assertIn(f"crashed in {step}", report["step_errors"][f"adr-{step}"])
                project.node_crash.unlink()
                self.assertEqual(project.resume(report["run_id"])["status"], "completed")
                self.assertEqual(len(project.calls("adr-touches.md")), 2)

    def test_a_stories_and_an_ask_stop_each_stop_the_run_at_adr_report_with_their_lines(self):
        for tasks, line in ((CHECK_TASKS.replace("[US1]", "[US2]"), "FAIL: tasks.md: "),
                            (CHECK_TASKS.replace("`core/src/x.ts`", "it"), "COULD_NOT_RUN: tasks.md: no task line names a path")):
            with self.subTest(line=line):
                project = CheckProject()
                self.addCleanup(project.close)
                project.set("tasks.md", tasks)
                self.assertStopped(project.to_the_check(), line)

    def test_a_judge_that_edits_the_plan_gets_new_rounds_until_the_run_fails_at_adr_rounds(self):
        self.project.with_rounds(3)
        proc, started = self.project.drive("rescope", self.project.spec_file(RESCOPE), ISSUE, SPEC_DIR)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.project.resume(started["run_id"], "grill_verdict=approve")
        self.project.set("judge-edits-plan", "1")
        report = self.project.resume(started["run_id"], "critique_verdict=approve")
        self.assertEqual((report["status"], report["step"], report.get("adr")), ("failed", "adr-rounds", True), report)
        self.assertIn("COULD_NOT_RUN: adr-check: the check ran 100 rounds in one run.", report["stderr"])
        self.assertEqual(len(self.project.calls("adr-judge.md")), 3)

    def test_a_departure_that_stops_every_round_fails_the_run_at_adr_rounds(self):
        self.project.with_rounds(2)
        proc, started = self.project.drive("rescope", self.project.spec_file(RESCOPE), ISSUE, SPEC_DIR)
        self.assertEqual(proc.returncode, 0, proc.stderr)
        self.project.resume(started["run_id"], "grill_verdict=approve")
        self.project.set("departs", json.dumps({"0004": ["core/src/x.ts"]}))
        self.assertStopped(self.project.resume(started["run_id"], "critique_verdict=approve"), DEPARTURE)
        self.assertStopped(self.project.resume(started["run_id"]), DEPARTURE)
        report = self.project.resume(started["run_id"])
        self.assertEqual((report["status"], report["step"], report.get("adr")), ("failed", "adr-rounds", True), report)


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


class StopLine(unittest.TestCase):
    """stop_line against lines as adrStop (planner/plugin/lib/adr-check.ts) writes them."""

    LINES = {
        "ruling-refused": "FAIL: adr_ruling: 0004 does not govern core/src/x.ts. Next step: resume with a corrected "
                          "adr_ruling, or without one.",
        "step-unfinished": "COULD_NOT_RUN: adr-check: step adr-touches, adr-judge did not finish this round (no done "
                           "record). Next step: fix what the step's error names, then resume.",
        "departure-inside": "FAIL: docs/adr: 0004 on core/src/x.ts: departs. Next step: change plan.md (the next round "
                            "writes tasks.md again from it); draft a superseding record into the spec PR (planner "
                            "ADR-0009 d3); or resume with adr_ruling naming docs/adr, 0004, core/src/x.ts and your reason.",
        "rulings-refused": "FAIL: adr-rulings.json: x. Next step: correct s/adr-rulings.json, then resume.",
    }

    def test_captures_a_fill_that_ends_the_said_part_whole(self):
        found = drive_workflow.RULING_REFUSED.search(self.LINES["ruling-refused"])
        self.assertEqual(found["what"], "0004 does not govern core/src/x.ts")

    def test_captures_the_steps_a_line_names(self):
        found = drive_workflow.STEP_UNFINISHED.search(self.LINES["step-unfinished"])
        self.assertEqual(found["steps"], "adr-touches, adr-judge")

    def test_captures_an_empty_fill(self):
        found = drive_workflow.stop_line("departure-inside").search(self.LINES["departure-inside"])
        self.assertEqual((found["entry"], found["stories"], found["why"]), ("docs/adr", "", "departs"))

    def test_each_rows_pattern_matches_its_own_line_and_none_of_the_other_rows_lines(self):
        for kind in self.LINES:
            for of, line in self.LINES.items():
                with self.subTest(pattern=kind, line=of):
                    self.assertEqual(drive_workflow.stop_line(kind).search(line) is not None, kind == of)

if __name__ == "__main__":
    unittest.main()
