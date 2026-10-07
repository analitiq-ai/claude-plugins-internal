# Implementation Plan: On/off switch for alq-review

**Branch**: `feat/35-on-off-switch` (#35) | **Date**: 2026-10-07 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/016-on-off-switch/spec.md`

## Summary

The user turns the whole plugin off and on for one session by starting a prompt with `alq-review off` or
`alq-review on`. Off is a file named after the session; one function says whether it is there, and the two hook
entry points (`gate.py`, `pre_merge_gate.py`) ask it before they judge anything, so nothing is computed while
off. The user's other keywords, the bookkeeping of running reviewers and the confinement of the plugin's own
agents keep running. A launch of one of the plugin's workflows while off is answered instead of left to fail.
A resumed session is told it is off.

Switches for the claim check and the shim check alone are not part of this plan (spec, Assumptions). The first
version of this plan carried them with a shared-reading refactor; the critique of 2026-10-07 and the user's
answer to it took them out.

Decisions are in [research.md](research.md), shapes in [data-model.md](data-model.md), the keyword, the
answers and the table of what off stops in [contracts/switch-keywords.md](contracts/switch-keywords.md).

## Technical Context

**Language/Version**: Python 3, standard library only, as the rest of `scripts/`

**Primary Dependencies**: none new. The Claude Code hook protocol: `UserPromptSubmit`, `PreToolUse`,
`PostToolUse`, `SubagentStart`/`Stop`, and newly `SessionStart`

**Storage**: `sessions/<session_id>.off.json` under the plugin's state root; `gate.log`. `ledger.db` is not touched

**Testing**: `python3 -m unittest discover -s tests` in `dev/alq-review/`; gate tests drive `scripts/gate.py`
and `scripts/pre_merge_gate.py` with hook payloads. The contract's "what off stops" table is the test list:
one failing test per row, and one per answer, written before any handler changes

**Target Platform**: any machine running Claude Code with the plugin enabled

**Project Type**: Claude Code plugin (hooks, workflows, agents)

**Performance Goals**: with no keyword typed, one `stat` per hook event; while off, an event returns after it

**Constraints**: `sweeper_read.py` and `snapshot.py` are not touched; a switch that cannot be read counts as on

**Scale/Scope**: one switch per session; no new module; `hookio.py`, `gate.py`, `pre_merge_gate.py`,
`hooks.json` and the README change

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|---|---|
| I. Contract-first | No shape from the contracts map is added. The switch file's shape is defined once, in `hookio.py`. Pass. |
| II. Ownership & trust boundaries | All in alq-review, this repo. The session id is validated before a path is built from it, for every caller (R1); the file is validated when read (R8). Pass. |
| III. Fail loud, no workarounds, no backwards compatibility | An unreadable switch counts as on and is reported (R8). A launch while off is answered, not left to fail (R4). Two routes the layer cannot close are named with their real fix, and FR-003 is worded to match (R3, R8). Pass. |
| IV. Test-first | The contract's table is the test list; each row starts as a failing test. Pass. |
| V. Smallest complete change | One file, one function, two call sites, one hook registration. No per-check switch, no status keyword, no expiry, no module for one predicate. Pass. |
| VI. Governing rule ships apart | No rule file, lint, guard or schema check changes. The README describes the plugin and changes with it. Pass. |
| P1. Code decides | The switch is read by the hook, never by an agent obeying a note; the answer to a launch while off names the next step. Pass. |
| P2. Only an approved entity releases a hold | See Complexity Tracking: off suspends every hold for one session, `override-merge`'s included. The approver is the user, the action the typed keyword. Nothing is released, lowered or restarted: the records are untouched and bind every other session. Justified deviation. |
| P3. Rules are pure | The switch adds no rule: it is one fact (a file is there) read by the handlers. `policy.py` and the checks' rule modules do not change. Pass. |
| P4. A check that could not run is its own outcome | A run cut off by the switch is a dead run, restarted when the plugin is on, never a pass (R4). Pass. |
| P5. Settled design | Every mechanism below cites a decision with its existing tools. R3 and R7 each hold one fact to be measured as a first task. Pass. |

Re-check after Phase 1: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/016-on-off-switch/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/switch-keywords.md
├── checklists/requirements.md
├── critiques/critique-20261007-switch.md   # of the first, wider plan
└── tasks.md                                # /speckit-tasks
```

### Source Code (repository root)

```text
plugins/alq-review/
├── hooks/hooks.json          # + SessionStart (resume|compact)
├── scripts/
│   ├── hookio.py             # switch_state(); session_file validates the id
│   ├── gate.py               # the keyword, the ask in handle(), launch answers, session start
│   └── pre_merge_gate.py     # asks before gating
└── README.md                 # a Switch section; State lists the file

dev/alq-review/tests/
├── test_switch.py           # new
└── test_pre_merge_gate.py   # extended
```

**Structure Decision**: the plugin's existing layout, one PR.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| P2: `alq-review off` is a second way past a lock and past the merge refusals, beside `unlock` and `override-merge` | The user chose "everything off", twice: locks and attestation (2026-10-07), then `--admin` and `gh api` merges after the critique raised them | Keeping locks, the attestation rules and the admin-merge refusals on while off was offered each time and declined |

## Mechanisms

- Off is a per-session file whose presence is the state; the session id is validated where the path is built: R1
- One function says whether the session is off, asked at the two hook entry points before anything is judged: R2
- The keyword, anchored at the start of a user's prompt, with the routes for agent-chosen prompts measured: R3
- What stays running while off, and the answer to a launch of the plugin's workflows: R4
- The switch is asked before, and kept apart from, the `log` / `enforce` settings: R5
- Each change is written to `gate.log` and told to the user and the agent: R6
- A resumed or compacted session is told it is off: R7
- An unreadable switch file counts as on and is reported; state written by a shell command stays unguarded, named as a gap: R8
