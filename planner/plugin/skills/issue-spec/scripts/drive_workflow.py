#!/usr/bin/env python3
"""Start or resume the issue-spec workflow from the checkout, then print where the run stands as JSON.

    drive_workflow.py start <spec file> <issue> <spec dir>      a new scope
    drive_workflow.py rescope <spec file> <issue> <spec dir>    a rescope
    drive_workflow.py resume <run id> [<input>=<value>]
    drive_workflow.py resume <run id> adr_ruling=@<file>    the file's rulings, to this resume's ADR check only

Inputs reach specify as argv, never through a shell: issue text routinely carries backticks. An ADR ruling is no
input and reaches no command line: it goes to that one resume's environment.
The report is read from the run's state.json because the specify CLI prints only a generic error for a
failed step; the step's own stderr is recorded nowhere else. A failed step of ADR_STEPS also reports `adr: true`. The
touches and judge steps are not among them: they continue on error, and ask or decide is given their exit code.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

RUNS = Path(".specify/workflows/runs")
PLUGIN = Path(__file__).resolve().parents[3]
# Spec Kit applies only presets and workflows installed in the project, so each start installs the plugin's.
PRESET = (PLUGIN / "speckit" / "presets" / "settled-design", Path(".specify/presets/settled-design"))
WORKFLOW = (PLUGIN / "speckit" / "workflows" / "issue-spec", Path(".specify/workflows/issue-spec"))
ENV = {"PLANNER_ROOT": str(PLUGIN)}
# The headless agent steps get only what they need to write the spec folder.
AGENT_ARGS = ('--setting-sources project --allowedTools "Read Grep Glob Write Edit Bash(bash .specify/*) '
              'Bash(.specify/*) Bash(ls:*) Bash(cat:*) Bash(mkdir:*) Bash(date:*)"')
OPEN_MARKERS = "Open clarification markers remain"
KIND = {"start": "new", "rescope": "rescope"}
ADR_STEPS = {"adr-plan-clear", "adr-plan-ask", "adr-plan-decide", "adr-plan-report", "adr-plan-rounds"}
ADR_RULING = "adr_ruling="
RULING_ENV = "ADR_RULING"


def _own_id(step):
    """In a loop iteration after the first, specify names a step `<loop>:<step>:<n>`."""
    parts = step.split(":")
    return parts[1] if len(parts) == 3 else step


def report(state):
    step = state["current_step_id"]
    out = {"run_id": state["run_id"], "status": state["status"], "step": step}
    # The engine records nothing for a step that raises, and a resumed step keeps its previous
    # attempt's record until it returns, so a record counts only if it matches the run's own outcome.
    record = state["step_results"].get(step)
    if state["status"] == "failed":
        current = record is not None and record["status"] == "failed" and record["error"] == state["error"]
        out["error"] = state["error"]
        out["stderr"] = record["output"].get("stderr", "") if current else ""
        out["open_markers"] = step == "no-open-markers" and OPEN_MARKERS in out["stderr"]
        out["adr"] = _own_id(step) in ADR_STEPS
    if state["status"] == "paused" and record is not None and record["output"].get("show_file"):
        out["critique"] = record["output"]["show_file"]
    # The close is the admin's to make (planner ADR-0006 d1), and the session reads nothing of the run but this
    # report, so the line the run names it with travels here.
    named = state["step_results"].get("name-close")
    if state["status"] == "completed" and named is not None:
        out["close"] = named["output"]["stdout"].strip()
    return out


def _specify(args, env):
    # A ruling reaches only the resume that carries it, never through the driver's own environment.
    inherited = {name: value for name, value in os.environ.items() if name != RULING_ENV}
    proc = subprocess.run(["specify", "workflow", *args, "--json"], capture_output=True, text=True,
                          env={**inherited, "SPECKIT_INTEGRATION_CLAUDE_EXTRA_ARGS": AGENT_ARGS, **ENV, **env})
    return proc


def _installed(source, target):
    return all((target / f.relative_to(source)).is_file()
               and (target / f.relative_to(source)).read_bytes() == f.read_bytes()
               for f in source.rglob("*") if f.is_file())


def _install(*command):
    proc = subprocess.run(["specify", *command], capture_output=True, text=True)
    if proc.returncode != 0:
        sys.exit(f"`specify {' '.join(command)}` failed:\n{proc.stdout}{proc.stderr}")


def install():
    source, target = PRESET
    if not _installed(source, target):
        if target.exists():
            _install("preset", "remove", "settled-design")
        _install("preset", "add", "--dev", str(source))
    source, target = WORKFLOW
    if not _installed(source, target):
        _install("workflow", "add", "--dev", str(source))


def _state(run_id):
    return json.loads((RUNS / run_id / "state.json").read_text())


def _step_env(inputs):
    """The inputs a shell step reads from its environment. A resume runs every step from the one the run halted at,
    the check loop's next iterations among them, so it needs them as much as the start does."""
    return {"ISSUE": inputs["issue"], "SPECIFY_FEATURE_DIRECTORY": inputs["spec_dir"]}


def start(kind, spec_file, issue, spec_dir):
    spec = Path(spec_file).read_text()
    if not spec.strip():
        sys.exit(f"{spec_file} is empty")
    if not issue:
        sys.exit("the issue is empty")
    if not spec_dir:
        sys.exit("the spec folder is empty")
    inputs = {"spec": spec, "issue": issue, "spec_dir": spec_dir, "kind": kind}
    install()
    before = set(RUNS.iterdir()) if RUNS.is_dir() else set()
    flags = [arg for name, value in inputs.items() for arg in ("-i", f"{name}={value}")]
    proc = _specify(["run", "issue-spec", *flags], _step_env(inputs))
    new = set(RUNS.iterdir()) - before if RUNS.is_dir() else set()
    if len(new) != 1:
        sys.exit(f"specify started no run:\n{proc.stdout}{proc.stderr}")
    return _state(new.pop().name)


def _ruling(value):
    """The rulings text `@<file>` names. Read from a file so the user's reason never reaches a command line."""
    if not value.startswith("@"):
        sys.exit(f"{ADR_RULING} takes @<file>, a file holding the rulings, not {value!r}")
    try:
        return Path(value[1:]).read_text()
    except OSError as e:
        sys.exit(f"{ADR_RULING}{value}: cannot read the file: {e}")


def resume(run_id, verdict):
    if not (RUNS / run_id / "state.json").is_file():
        sys.exit(f"no run {run_id} under {RUNS}")
    inputs = json.loads((RUNS / run_id / "inputs.json").read_text())["inputs"]
    if not (inputs.get("spec_dir") and inputs.get("kind")):
        sys.exit(f"run {run_id} was started before every run took its spec folder and kind, so no step can tell "
                 "which folder it is for. Next step: start the scope again with /planner:issue-spec.")
    env = _step_env(inputs)
    # Not an input: specify would keep it in inputs.json, and every later resume would rule again.
    if verdict and verdict.startswith(ADR_RULING):
        env[RULING_ENV] = _ruling(verdict.removeprefix(ADR_RULING))
        verdict = None
    proc = _specify(["resume", run_id, *(["-i", verdict] if verdict else [])], env)
    state = _state(run_id)
    if proc.returncode != 0 and state["status"] not in ("failed", "aborted"):
        sys.exit(f"specify resume failed:\n{proc.stdout}{proc.stderr}")
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)
    for action in KIND:
        s = sub.add_parser(action)
        s.add_argument("spec_file")
        s.add_argument("issue")
        s.add_argument("spec_dir")
    r = sub.add_parser("resume")
    r.add_argument("run_id")
    r.add_argument("verdict", nargs="?")
    args = parser.parse_args()
    if args.action == "resume":
        state = resume(args.run_id, args.verdict)
    else:
        state = start(KIND[args.action], args.spec_file, args.issue, args.spec_dir)
    print(json.dumps(report(state)))


if __name__ == "__main__":
    main()
