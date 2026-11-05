#!/usr/bin/env python3
"""Start or resume the issue-spec workflow from the checkout, then print where the run stands as JSON.

    drive_workflow.py start <spec file> <issue> <spec dir>      a new scope
    drive_workflow.py rescope <spec file> <issue> <spec dir>    a rescope
    drive_workflow.py resume <run id> [<input>=<value>]
    drive_workflow.py resume <run id> adr_ruling=@<file>    the file's rulings, to this resume's ADR check only

Inputs reach specify as argv, never through a shell: issue text routinely carries backticks. An ADR ruling is no
input and reaches no command line: it goes to that one resume's environment, and the report's `ruling_unapplied`
names each of its rulings the spec folder's rulings file does not hold once the resume returns, unless the resume's
stderr holds a ruling-refused line.
The report is read from the run's state.json because the specify CLI prints only a generic error for a
failed step; the step's own stderr is recorded nowhere else. A failed adr-clear, adr-report or adr-rounds also
reports `adr: true`; a failed adr-settled-design reports as the step it is.
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
ADR_STEPS = {"adr-clear", "adr-report", "adr-rounds"}
ADR_RULING = "adr_ruling="
RULING_ENV = "ADR_RULING"
RULINGS_FILE = "adr-rulings.json"
# adr_check.ts's run-folder records the report reads (core's decision-check.ts names them).
STOP_FILE = "adr-stop.json"
ASKED_FILE = "adr-asked.json"
CHECK_OUTCOMES = PLUGIN / "core" / "generated" / "check-outcome.schema.json"


def _check_outcomes(path, *names):
    """`names`, each a value of CheckOutcome's schema at `path`; exits naming `path` when the schema cannot be read
    as core writes it or lacks one of them."""
    try:
        values = json.loads(path.read_text())["enum"]
        lacking = [name for name in names if name not in values]
    except (OSError, ValueError, KeyError, TypeError) as exc:
        sys.exit(f"CheckOutcome could not be read from {path}: {type(exc).__name__}: {exc}")
    if lacking:
        sys.exit(f"CheckOutcome at {path} has no {', '.join(lacking)}")
    return names


FAIL, COULD_NOT_RUN = _check_outcomes(CHECK_OUTCOMES, "FAIL", "COULD_NOT_RUN")
# The stop table's lines this report reads: the step-unfinished line, the ruling-refused label, and the label of each
# stop whose Unanswered step is a model step, with that step (adr-check.test.ts pins it to UNANSWERED_STEPS).
STEP_UNFINISHED = re.compile(rf"^{COULD_NOT_RUN}: adr-check: step (.+) did not finish this round")
RULING_REFUSED = f"{FAIL}: adr_ruling: "
UNANSWERED = {"touches.json": "adr-touches", "tasks.md": "adr-tasks", "adr-verdict.json": "adr-judge"}
UNANSWERED_LINE = re.compile(rf"^{COULD_NOT_RUN}: ({'|'.join(map(re.escape, UNANSWERED))}): ")


def _own_id(step):
    """In a loop iteration after the first, specify names a step `<loop>:<step>:<n>`."""
    parts = step.split(":")
    return parts[1] if len(parts) == 3 else step


def _refuse_constant(name):
    raise ValueError(f"{name} is not JSON")


def _json_parse(text):
    """JSON.parse's reading of `text`, which adr_check.ts parses with: Python's json also takes NaN and Infinity."""
    return json.loads(text, parse_constant=_refuse_constant)


def _json_as_the_check_reads_it(path):
    """adr_check.ts reads with Node's utf8 decoding, which replaces a byte that is not UTF-8 rather than failing, so
    both sides see the same value."""
    return _json_parse(path.read_bytes().decode("utf-8", errors="replace"))


def _record(run_id, name):
    """A record the round left in the run folder; None when it is missing or does not parse, as when the round
    never reached the step that writes it."""
    try:
        return _json_as_the_check_reads_it(RUNS / run_id / name)
    except (FileNotFoundError, ValueError):
        return None


def _judged(run_id):
    """Whether this round's ask named a governing record, so a judge ran this round."""
    asked = _record(run_id, ASKED_FILE)
    return isinstance(asked, dict) and any(folder.get("governing") for folder in asked.get("folders", []))


def _named_steps(run_id, stderr):
    """The steps a stop's lines name: each a step-unfinished line names, and the Unanswered step of a stop whose
    record says it is one; the judge only when this round ran it, so an earlier round's error is never shown."""
    lines = stderr.splitlines()
    steps = [step for line in lines if (found := STEP_UNFINISHED.match(line)) for step in found[1].split(", ")]
    labels = [found[1] for line in lines if (found := UNANSWERED_LINE.match(line))]
    if labels:
        stop = _record(run_id, STOP_FILE)
        if isinstance(stop, dict) and stop.get("unanswered") is True:
            steps += [UNANSWERED[label] for label in labels
                      if UNANSWERED[label] != "adr-judge" or _judged(run_id)]
    return list(dict.fromkeys(steps))


def _step_said(step_results, step):
    """A step's error and its stderr: a shell step's error is only its exit code, so what to fix is in its stderr."""
    record = step_results.get(step)
    if record is None:
        return ""
    said = (record.get("error") or "", (record.get("output") or {}).get("stderr") or "")
    return "".join(f"{step}: {text}\n" for text in dict.fromkeys(text.strip() for text in said if text.strip()))


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
        if _own_id(step) == "adr-report":
            # Keyed by the bare id, which holds the step's latest round: this round's, for a step the stop names.
            named = _named_steps(state["run_id"], out["stderr"])
            out["stderr"] += "".join(_step_said(state["step_results"], name) for name in named)
    if state["status"] == "paused" and record is not None and record["output"].get("show_file"):
        out["critique"] = record["output"]["show_file"]
    # The close is the admin's to make (planner ADR-0006 d1), and the session reads nothing of the run but this
    # report, so the line the run names it with travels here.
    named = state["step_results"].get("name-close")
    if state["status"] == "completed" and named is not None:
        out["close"] = named["output"]["stdout"].strip()
    return out


def _ruling_key(ruling):
    """`<folder> <record> <path>`, a ruling's key; None for an entry that has none."""
    fields = [ruling.get(name) for name in ("folder", "record", "path")] if isinstance(ruling, dict) else [None]
    return " ".join(fields) if all(isinstance(field, str) for field in fields) else None


def _given_keys(ruling):
    try:
        given = _json_parse(ruling)
    except ValueError:
        return [ruling.strip()]
    if not isinstance(given, list):
        return [json.dumps(given)]
    return [_ruling_key(entry) or json.dumps(entry) for entry in given]


def _held_keys(spec_dir):
    """The keys the spec folder's rulings file holds; a file that is not JSON holds none, the run's own lines
    naming it."""
    try:
        held = _json_as_the_check_reads_it(Path(spec_dir) / RULINGS_FILE)
    except (FileNotFoundError, ValueError):
        return set()
    rulings = held.get("rulings") if isinstance(held, dict) else None
    return {_ruling_key(entry) for entry in rulings} - {None} if isinstance(rulings, list) else set()


def ruling_unapplied(state, ruling, out):
    """Each ruling of `ruling` whose key the rulings file does not hold once the resume returns; none when `out`'s
    stderr holds a ruling-refused line."""
    if any(line.startswith(RULING_REFUSED) for line in out.get("stderr", "").splitlines()):
        return []
    held = _held_keys(_inputs(state["run_id"])["spec_dir"])
    after = (": the run completed with no departure on it." if state["status"] == "completed"
             else ". Next step: resume with it again.")
    return [f"ruling not applied: {key}{after}" for key in _given_keys(ruling) if key not in held]


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
    return json.loads((RUNS / run_id / "state.json").read_text(encoding="utf-8"))


def _inputs(run_id):
    return json.loads((RUNS / run_id / "inputs.json").read_text(encoding="utf-8"))["inputs"]


def _step_env(inputs):
    """The inputs a shell step reads from its environment. A resume re-executes from the step the run halted at, so
    it needs them as much as the start does."""
    return {"ISSUE": inputs["issue"], "SPECIFY_FEATURE_DIRECTORY": inputs["spec_dir"]}


def start(kind, spec_file, issue, spec_dir):
    spec = Path(spec_file).read_text(encoding="utf-8")
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
        return Path(value[1:]).read_text(encoding="utf-8")
    except (OSError, ValueError) as e:
        sys.exit(f"{ADR_RULING}{value}: cannot read the file: {e}")


def resume(run_id, verdict):
    """The run's state once specify returns, and the ruling the resume carried, or None."""
    if not (RUNS / run_id / "state.json").is_file():
        sys.exit(f"no run {run_id} under {RUNS}")
    inputs = _inputs(run_id)
    if not (inputs.get("spec_dir") and inputs.get("kind")):
        sys.exit(f"run {run_id} was started before every run took its spec folder and kind, so no step can tell "
                 "which folder it is for. Next step: start the scope again with /planner:issue-spec.")
    env = _step_env(inputs)
    ruling = None
    # Not an input: specify would keep it in inputs.json, and every later resume would rule again.
    if verdict and verdict.startswith(ADR_RULING):
        ruling = env[RULING_ENV] = _ruling(verdict.removeprefix(ADR_RULING))
        verdict = None
    proc = _specify(["resume", run_id, *(["-i", verdict] if verdict else [])], env)
    state = _state(run_id)
    if proc.returncode != 0 and state["status"] not in ("failed", "aborted"):
        sys.exit(f"specify resume failed:\n{proc.stdout}{proc.stderr}")
    return state, ruling


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
    ruling = None
    if args.action == "resume":
        state, ruling = resume(args.run_id, args.verdict)
    else:
        state = start(KIND[args.action], args.spec_file, args.issue, args.spec_dir)
    out = report(state)
    if ruling is not None:
        out["ruling_unapplied"] = ruling_unapplied(state, ruling, out)
    print(json.dumps(out))


if __name__ == "__main__":
    main()
