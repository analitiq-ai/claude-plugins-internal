# Implementation Plan: One planning skill, `alq-spec`

**Branch**: `feat/57-merge-shape-into-alq-spec` | **Date**: 2026-10-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/019-merge-shape-into-alq-spec/spec.md`

## Summary

Make `design-doc` the one planning skill, then name it `alq-spec`. Pull request 1 moves three checks of `alq-shape` into the
Spec Kit workflow as steps: a `premise` gate that runs before `specify` (the skill answers the premise questions in the
session; the user picks "write the spec", "no spec needed" or "not worth doing"), a script step that fails the run on an
incomplete premise report, a step that posts the location comment for the two stop outcomes, and a script step after `specify`
that fails the run when `spec.md` has no labelled `## Root cause` and runs again after grill. The settled-design preset adds the premise and root cause
sections to the spec template. One new script owns the report's form (`premise_report.py`), one checks the section
(`rootcause.py`), and `speclocation.py` gains a third form of the location comment. `alq-shape` is deleted. Pull request 2
renames `design-doc` to `alq-spec` everywhere and changes no behaviour.

## Technical Context

**Language/Version**: Python 3 (stdlib only, as `plugins/alq-review/scripts/`); Spec Kit workflow YAML; Markdown skills

**Primary Dependencies**: `specify` CLI 1.0.7 (the workflow's minimum, already driven by `design-doc`), `gh`, `git`

**Storage**: the run's own folder `.specify/workflows/runs/<run_id>/` (the premise report); the issue's one location comment; files in the checkout

**Testing**: `unittest` in `dev/alq-review/tests/`, run by CI (`.github/workflows/tests.yml`); the fake `gh` of `test_gate.py`; the real `specify` CLI for the workflow-shape cases

**Target Platform**: Linux/macOS developer machines running Claude Code with the plugin

**Project Type**: Claude Code plugin (scripts + skills + Spec Kit workflow and preset)

**Performance Goals**: N/A: one extra pause per new spec

**Constraints**: no backwards compatibility (the `<!-- analitiq-premise -->` comment and the shape comment are not read; `alq-shape` is deleted, not stubbed); every refusal names one next step (P1); `gh` failing in `record` fails the run in gh's words (P4); a stale report cannot satisfy the check (R3); the repo is private

**Scale/Scope**: 2 new scripts, edits in `speclocation.py`, the workflow, the preset, 3 skills' text, 1 skill deleted, README; then a rename across ~15 files; ~6 test files

## Constitution Check

*GATE: passes before Phase 0; re-checked after Phase 1 (below).*

| Gate | Result |
|---|---|
| I. Contract-first | The premise report's form is a new shape, internal to this plugin (no other repo reads it) and defined once in `premise_report.py` (R2); the skill gets the questions by running `form`, not from a copy. The location comment's third form is added to its one owner, `speclocation.py` (R6), not to a second parser. The `## Root cause` section's shape is defined once in the preset's template (R4) and graded by one script (R5). No published schema, type list or second validator is added. **Pass.** |
| II. Ownership / trust | Everything lands in this repo, which owns the plugin. The reason text reaches `gh` through the existing body-on-stdin path of `github.write_issue_comment` (R6), never a command line; the pick reaches the shell step only as one of three fixed option strings the gate has matched. No secrets. **Pass.** |
| III. Fail loud, no compat | `alq-shape` and its premise comment are deleted, not kept as a fallback. The two checks exit non-zero with the next step. A report that is missing or stale fails the run (R3). **Pass.** |
| IV. Test-first | R10 first: a failing test against the real CLI before the workflow is reshaped. Every later task starts from a failing test (R9), enforced in `tasks.md`. **Pass.** |
| V. Smallest complete change | Only three checks move (spec FR-019); the surface list, source tags and practice-first answering are dropped. `drive_workflow.py` is not edited in PR 1 (R7). Dead text goes with `alq-shape`: tackle's `(code)` re-check paragraph, root-cause-check's "no Root cause section yet" sentence. **Pass.** |
| VI. Governing rule apart from governed code | `test_spec_source.py` pins what the skills say and is edited in the same PR as the skills it grades. **See Complexity Tracking.** The rename (PR 2) moves no rule with the code it governs. |
| P1. Code decides | The premise report, the root cause section and the location comment are each graded by a script step, and the stop outcomes post their comment from a workflow step (R1, R2). Prose remains only where a person must talk: the skill asks the questions and passes the user's pick. **Pass.** |
| P2. Approved entity releases a hold | The `premise` gate is a hold on the run. Its one approver is the user, and the one action is the verdict they name (`premise_verdict`). The `Pick:` cross-check means nothing else, including a skill's recommendation, can release it. No other lock, count or hold is added. **Pass.** |
| P3. Pure rules, thin handlers | `check`, the section grade and the form are pure functions of text; `record` and the CLI do only I/O; the workflow only sequences. **Pass.** |
| P4. Check that could not run | `gh` failing in `record` fails that step with gh's message and posts nothing; a missing report is a failed check, not a pass. **Pass.** |
| P5. Settled design | Every mechanism below cites R1 to R10 with Decision, Rationale and Existing tools. **Pass.** |

Re-check after Phase 1: the contracts (`contracts/`) add no field the constitution gates; the same result.

## Project Structure

### Documentation (this feature)

```text
specs/019-merge-shape-into-alq-spec/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── premise-report.md
│   └── speclocation-cli.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks, not this command
```

### Source Code (repository root)

```text
plugins/alq-review/
├── scripts/
│   ├── premise_report.py          # new: form / check / record
│   ├── rootcause.py               # new: check <spec folder> [<premise report>]
│   └── speclocation.py            # third form: NotWorthDoing; located refuses it; not-worth-doing and status commands
├── speckit/
│   ├── workflows/design-doc/workflow.yml          # premise stage, checks, later steps skip on a stop pick
│   └── presets/settled-design/                    # spec-template + speckit.specify appends, version 1.1.0
├── skills/
│   ├── alq-shape/                 # deleted
│   ├── design-doc/SKILL.md        # premise step; existing-spec stop
│   ├── alq-issue-tackle/SKILL.md  # names design-doc; (code) paragraph removed
│   └── alq-root-cause-check/SKILL.md
└── README.md                      # skills row, workflow steps

dev/alq-review/
├── .specify/workflows/design-doc/workflow.yml     # installed copy, regenerated by a start
└── tests/
    ├── test_premise_report.py     # new
    ├── test_rootcause.py          # new
    ├── test_speclocation.py       # third form
    ├── test_drive_workflow.py     # premise pause, skip on re-scope, three picks
    ├── test_plan_template.py      # spec-template append
    └── test_spec_source.py        # merged skill; nothing names alq-shape
```

PR 2 renames the `design-doc` paths above to `alq-spec` and the names inside `gate.py`, `policy.py`, `speclocation.py`, `settled_design.py`,
`drive_workflow.py`, `README.md`, `.github/workflows/tests.yml` and the tests (R8).

**Structure Decision**: two single-purpose scripts beside the existing ones, because the report and the section are different documents with
different readers (R2, R5); the location comment stays in its one module (R6); the workflow only sequences (P3).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| VI: `test_spec_source.py` (a guard over the skills' text) is edited in the same PR as the skills it grades | The merged skill's text and the pin on it describe one thing: the pin asserts tackle and root-cause-check name the skill that writes the spec. It cannot stay green while `alq-shape` is deleted | Landing a PR that loosens the pin first leaves the skills ungated until the second PR. Spec 018 took the same path and the user decided it |

## Mechanisms

- The workflow's premise gate, report check, outcome record and the skip of every later step: R1
- The premise report's form, its check, and the stop outcomes: R2
- Where the report lives and how `specify` finds it: R3
- The spec template's premise and root cause sections: R4
- The root cause section check after `specify` and again after grill, reading the report's defect flag: R5
- The third form of the location comment, its refusal, and the `status` command: R6
- The skills' edits, the `alq-shape` deletion and the existing-spec stop: R7
- The two pull requests and the rename: R8
- The tests and the name pins: R9
- The Spec Kit proof that goes first: R10
