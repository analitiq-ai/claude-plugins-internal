#!/usr/bin/env python3
"""Start or resume the alq-spec workflow from the checkout, then print where the run stands as JSON.

    drive_workflow.py start <spec file> <issue> [<spec dir>]
    drive_workflow.py resume <run id> [<input>=<value>]

Values reach specify as argv, never through a shell: issue and ruling text routinely carry backticks.
The report is read from the run's state.json because the specify CLI prints only a generic error for a
failed step; the step's own stderr is recorded nowhere else.
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
WORKFLOW = (PLUGIN / "speckit" / "workflows" / "alq-spec", Path(".specify/workflows/alq-spec"))
ENV = {"ALQ_PLAN_ROOT": str(PLUGIN)}
# The headless agent steps get only what they need to write the spec folder.
AGENT_ARGS = ('--setting-sources project --allowedTools "Read Grep Glob Write Edit Bash(bash .specify/*) '
              'Bash(.specify/*) Bash(ls:*) Bash(cat:*) Bash(mkdir:*) Bash(date:*)"')
OPEN_MARKERS = "Open clarification markers remain"


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
    if state["status"] == "paused" and record is not None and record["output"].get("show_file"):
        out["critique"] = record["output"]["show_file"]
    return out


def _specify(args, env):
    proc = subprocess.run(["specify", "workflow", *args, "--json"], capture_output=True, text=True,
                          env={**os.environ, "SPECKIT_INTEGRATION_CLAUDE_EXTRA_ARGS": AGENT_ARGS, **ENV, **env})
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
    """The inputs a shell step reads from its environment. A resume re-runs the step the run stopped in, so a
    resume needs them as much as the start does."""
    env = {"ISSUE": inputs["issue"]}
    # The spec_dir input only picks the rescope branch.
    if inputs.get("spec_dir"):
        env["SPEC_DIR"] = inputs["spec_dir"]
    return env


def start(spec_file, issue, spec_dir):
    spec = Path(spec_file).read_text()
    if not spec.strip():
        sys.exit(f"{spec_file} is empty")
    if not issue:
        sys.exit("the issue is empty")
    inputs = {"spec": spec, "issue": issue}
    if spec_dir is not None:
        if not spec_dir:
            sys.exit("the spec folder is empty")
        inputs["spec_dir"] = spec_dir
    install()
    before = set(RUNS.iterdir()) if RUNS.is_dir() else set()
    flags = [arg for name, value in inputs.items() for arg in ("-i", f"{name}={value}")]
    proc = _specify(["run", "alq-spec", *flags], _step_env(inputs))
    new = set(RUNS.iterdir()) - before if RUNS.is_dir() else set()
    if len(new) != 1:
        sys.exit(f"specify started no run:\n{proc.stdout}{proc.stderr}")
    return _state(new.pop().name)


def resume(run_id, verdict):
    if not (RUNS / run_id / "state.json").is_file():
        sys.exit(f"no run {run_id} under {RUNS}")
    inputs = json.loads((RUNS / run_id / "inputs.json").read_text())["inputs"]
    proc = _specify(["resume", run_id, *(["-i", verdict] if verdict else [])], _step_env(inputs))
    state = _state(run_id)
    if proc.returncode != 0 and state["status"] not in ("failed", "aborted"):
        sys.exit(f"specify resume failed:\n{proc.stdout}{proc.stderr}")
    return state


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="action", required=True)
    s = sub.add_parser("start")
    s.add_argument("spec_file")
    s.add_argument("issue")
    s.add_argument("spec_dir", nargs="?")
    r = sub.add_parser("resume")
    r.add_argument("run_id")
    r.add_argument("verdict", nargs="?")
    args = parser.parse_args()
    if args.action == "start":
        state = start(args.spec_file, args.issue, args.spec_dir)
    else:
        state = resume(args.run_id, args.verdict)
    print(json.dumps(report(state)))


if __name__ == "__main__":
    main()
