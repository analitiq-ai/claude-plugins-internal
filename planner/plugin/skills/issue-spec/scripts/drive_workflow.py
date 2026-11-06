#!/usr/bin/env python3
"""Start or resume the issue-spec workflow from the checkout, then print where the run stands as JSON.

    drive_workflow.py start <spec file> <issue> <spec dir>      a new scope
    drive_workflow.py rescope <spec file> <issue> <spec dir>    a rescope
    drive_workflow.py resume <run id> [<input>=<value>]
    drive_workflow.py resume <run id> adr_ruling=@<file>    a resume carrying the user's ruling on a departure

Values reach specify as argv, never through a shell: issue and ruling text routinely carry backticks. A ruling is
no workflow input: it reaches the plan check's rounds of that one resume as ADR_RULING, so no later resume sees it.
The report is read from the run's state.json because the specify CLI prints only a generic error for a
failed step; the step's own stderr is recorded nowhere else.
"""
import argparse
import json
import os
import re
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
RULING = "adr_ruling"
RULING_KEY = ("folder", "record", "path")
# The plan check's steps with no continue_on_error, adr-settled-design aside, which stops as settled-design does
# (planner ADR-0009).
ADR_STOP_STEPS = ("adr-clear", "adr-report", "adr-rounds")
# The model steps whose not answering is a stop of its own (`unanswered` in ADR_STOPS, planner/plugin/lib/adr-check.ts).
UNANSWERED_STEPS = ("adr-touches", "adr-tasks", "adr-judge")
STEP_UNFINISHED = re.compile(r"^COULD_NOT_RUN: adr-check: step (.+) did not finish this round", re.M)
RULING_REFUSED = re.compile(r"^FAIL: adr_ruling: ", re.M)


def own_id(step):
    """A step's id as workflow.yml names it: specify qualifies a step of a loop round after the first as
    `<loop>:<step>:<n>`."""
    parts = step.split(":")
    return parts[1] if len(parts) == 3 else step


def _round_file(state, name):
    path = RUNS / state["run_id"] / name
    return json.loads(path.read_text()) if path.is_file() else None


def _ran_this_round(state, step):
    """Whether `step`'s record is this round's: specify keeps a step nested in an `if` under its bare id only, so a
    round that skips it leaves an earlier round's record there."""
    if step == "adr-judge":
        asked = _round_file(state, "adr-asked.json")
        return asked is not None and any(folder.get("governing") for folder in asked["folders"])
    if step == "adr-tasks":
        due = _round_file(state, "adr-steps/tasks-due.json")
        return due is not None and due["due"]
    return True


def _step_errors(state, stderr):
    """The own error of each step the round's stop names as having failed: an unanswered model step, or a step
    that did not finish."""
    unfinished = [name for line in STEP_UNFINISHED.findall(stderr) for name in line.split(", ")]
    stop = _round_file(state, "adr-stop.json")
    unanswered = [name for name in UNANSWERED_STEPS if stop is not None and stop["unanswered"]
                  and _ran_this_round(state, name)]
    errors = {}
    for name in unfinished + unanswered:
        record = state["step_results"].get(name)
        if record is not None and record["status"] == "failed":
            errors[name] = "\n".join(text for text in (record["error"], record["output"].get("stderr", "").strip()) if text)
    return errors


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
        if own_id(step) in ADR_STOP_STEPS:
            out["adr"] = True
            errors = _step_errors(state, out["stderr"]) if own_id(step) == "adr-report" else {}
            if errors:
                out["step_errors"] = errors
    if state["status"] == "paused" and record is not None and record["output"].get("show_file"):
        out["critique"] = record["output"]["show_file"]
    # The close is the admin's to make (planner ADR-0006 d1), and the session reads nothing of the run but this
    # report, so the line the run names it with travels here.
    named = state["step_results"].get("name-close")
    if state["status"] == "completed" and named is not None:
        out["close"] = named["output"]["stdout"].strip()
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
    """The inputs a shell step reads from its environment. A resume executes again from the step the run halted
    at, through every round of the plan check after it, so a resume needs them as much as the start does."""
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


def read_ruling(value):
    """The text of `adr_ruling=@<file>`, and the (folder, record, path) of each ruling it holds. The check
    judges the rulings; the driver reads their keys only, to name the ones no round applied."""
    if not value.startswith("@"):
        sys.exit(f"{RULING} takes @<file>, a file holding the ruling, so its words never reach a command line")
    try:
        text = Path(value[1:]).read_text()
    except OSError as error:
        sys.exit(f"{RULING}: cannot read {value[1:]}: {error.strerror}")
    try:
        rulings = json.loads(text)
    except ValueError as error:
        sys.exit(f"{RULING}: {value[1:]} is not JSON: {error}")
    if not (isinstance(rulings, list) and all(
            isinstance(ruling, dict) and all(isinstance(ruling.get(name), str) for name in RULING_KEY)
            for ruling in rulings)):
        sys.exit(f"{RULING}: {value[1:]} is not a JSON list of rulings, each naming its {', '.join(RULING_KEY)}")
    return text, [tuple(ruling[name] for name in RULING_KEY) for ruling in rulings]


def _held_rulings(spec_dir):
    """The keys the spec folder's rulings file holds, none when it is missing or does not parse: decide writes it
    whole, so one that does not parse was edited by hand, and the round stopped on it (`rulings-refused`) before
    any decide could apply a ruling."""
    try:
        rulings = json.loads((Path(spec_dir) / "adr-rulings.json").read_text())["rulings"]
        return {tuple(ruling[name] for name in RULING_KEY) for ruling in rulings}
    except (FileNotFoundError, ValueError, TypeError, KeyError):
        return set()


def ruling_unapplied(out, inputs, keys):
    """Each ruling of the resume that no round applied, and no decide refused."""
    if RULING_REFUSED.search(out.get("stderr", "")):
        return []
    held = _held_rulings(inputs["spec_dir"])
    if out["status"] == "completed":
        return [f"ruling not applied: {' '.join(key)}: the run completed with no departure on it."
                for key in keys if key not in held]
    return [f"ruling not applied: {' '.join(key)}. Next step: resume with it again." for key in keys if key not in held]


def resume(run_id, given):
    if not (RUNS / run_id / "state.json").is_file():
        sys.exit(f"no run {run_id} under {RUNS}")
    inputs = json.loads((RUNS / run_id / "inputs.json").read_text())["inputs"]
    if not (inputs.get("spec_dir") and inputs.get("kind")):
        sys.exit(f"run {run_id} was started before every run took its spec folder and kind, so no step can tell "
                 "which folder it is for. Next step: start the scope again with /planner:issue-spec.")
    env = _step_env(inputs)
    flags = []
    keys = None
    if given is not None and given.startswith(f"{RULING}="):
        env["ADR_RULING"], keys = read_ruling(given[len(RULING) + 1:])
    elif given is not None:
        flags = ["-i", given]
    proc = _specify(["resume", run_id, *flags], env)
    state = _state(run_id)
    if proc.returncode != 0 and state["status"] not in ("failed", "aborted"):
        sys.exit(f"specify resume failed:\n{proc.stdout}{proc.stderr}")
    out = report(state)
    if keys is not None:
        unapplied = ruling_unapplied(out, inputs, keys)
        if unapplied:
            out["ruling_unapplied"] = unapplied
    return out


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
        out = resume(args.run_id, args.verdict)
    else:
        out = report(start(KIND[args.action], args.spec_file, args.issue, args.spec_dir))
    print(json.dumps(out))


if __name__ == "__main__":
    main()
