# Implementation Plan: Split alq-review into review, plan and build plugins

**Branch**: `refactor/63-split-planning-plugin` (#63) | **Date**: 2026-10-09 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/019-split-planning-plugin/spec.md`

## Summary

Review stops finding the spec and is told it. Each review-round launch carries `spec`, a spec folder or `null`.
The gate verifies the folder's shape and its `spec.md` in HEAD, records the value and the blob id
of `spec.md` in the PR's ledger at the first round, and refuses any later different value. A later change to
`spec.md` holds the PR until the user unlocks it. A new pure module, `specbinding.py`, holds parse, shape, bind and
the text step. `speclocation.py`, the issue comment, the gate's settled-design check, its two settings and
the rescope route out of a lock are deleted. Planning closes a not-worth-doing issue with `gh`. `issue-tackle` takes
`spec` and `branch`.

With that done, nothing links planning, building and review but the spec folder, and a second PR moves the planning and
building files into `plugins/alq-plan/` and `plugins/alq-build/`, gives each its own `dev/` folder and test suite, and
lists all three in the marketplace. Decisions are in [research.md](research.md), shapes in [data-model.md](data-model.md),
arguments, refusals and entry points in [contracts/interfaces.md](contracts/interfaces.md).

## Technical Context

**Language/Version**: Python 3 (CI runs 3.13), as the rest of `scripts/`; skills are Markdown; the workflow is Spec Kit YAML

**Primary Dependencies**: git and `gh`, as today; `specify-cli==1.0.7` for planning's tests. Nothing new

**Storage**: `ledger.db`; the PR's ledger doc gains top-level `spec`, `spec_blob` (R8) and `spec_held` (R18). No new table

**Testing**: `python -m unittest -v` in each `dev/<plugin>/tests/`, which CI already discovers. Each refusal and each
binding case is a failing test before code (constitution IV)

**Target Platform**: any machine running Claude Code with one or more of the three plugins

**Project Type**: Claude Code plugins (hooks, workflows, skills, agents) and a Spec Kit workflow

**Performance Goals**: a launch costs one git call for the spec (`ls-tree` for `spec.md`'s type, blob id and size),
and a `git diff` when `spec.md` changed; the issue-comment API call at each launch goes away

**Constraints**: no plugin imports, runs or names another's files (R15 guard tests). No backwards compatibility: old
location comments are ignored, old Spec Kit runs fail on resume. Every spec failure is a named refusal under `mode`,
never the top-level handler (R9)

**Scale/Scope**: PR 1 changes `gate.py`, `briefs.py`, `policy.py`, `hookio.py`, `github.py`, `config.json`,
`settled_design.py`, `premise_report.py`, `review-round.js`, `workflow.yml`, `agents/assessor.md`, the three skills
and the README, adds `specbinding.py`, deletes `speclocation.py`.
PR 2 is a move with renames

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|---|---|
| I. Contract-first | `spec` is defined once, in `specbinding.parse`; the binding is two fields every reader takes from the ledger. No contracts-map shape is touched. Pass. |
| II. Ownership & trust boundaries | All in this repo; `spec` is outside input, validated where it enters (R7, R9). The `cto` rule file and skills change in that repo's own PRs (R17). Pass. |
| III. Fail loud, no workarounds, no backwards compatibility | Missing, malformed and unverifiable `spec` refuse with the step named. No reader for old comments, no `ALQ_REVIEW_ROOT` alias; old runs fail. Pass. |
| IV. Test-first | The contract's refusal table and binding cases are the test list, each seen to fail first; `specbinding` is pure. Pass. |
| V. Smallest complete change | Deleted, not kept beside a replacement: `speclocation.py`, settled-design branch mode, `refuse_spec`, `spec_checks`, `design_documents`, the rescope route, the planning skill's comment form. Pass. |
| VI. Governing rule ships apart | Rule file, decision records, new constitutions and the alq-review constitution amendment are each their own PR, ordered by R17. The README describes the plugin and changes with it. Pass. |
| P1. Code decides | Binding, its refusal and the verification are decided in the gate; each refusal names its next step (the full call with the bound value, or the failed step). The build skill is prose by nature, off alq-review's hook path; its own constitution decides its principles (R16). Pass. |
| P2. Only an approved entity releases a hold | RESHAPE_SPEC and a changed `spec.md`: the user, by `unlock <ref>`, nothing else (R12, R18). The bound value is not a hold and nothing changes it. Pass. |
| P3. Rules are pure | Parse, shape, bind and the text step are pure in `specbinding.py`; the gate reads the git facts and the ledger and calls them. Pass. |
| P4. A check that could not run is its own outcome | A git error while verifying is a refusal naming the step and the error (R9). Pass. |
| P5. Settled design | Every mechanism below cites a decision with its existing tools. Pass. |

Re-check after Phase 1: unchanged. P5's own sources (README item 6, `settled_design.py`) leave alq-review in this
feature; the constitution amendment that follows is R17 step 6.

## Project Structure

### Documentation (this feature)

```text
specs/019-split-planning-plugin/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/interfaces.md
├── checklists/requirements.md
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

PR 1, behaviour (this branch):

```text
plugins/alq-review/
├── scripts/
│   ├── specbinding.py       # new: Folder, NoSpec, parse, shape_problem, bind, text_step
│   ├── speclocation.py      # deleted
│   ├── gate.py              # on_workflow takes spec; binding; spec.md hold; no settled-design, no rescope
│   ├── briefs.py            # spec folder's path from the binding, nothing quoted; prompt names no headings
│   ├── policy.py            # review_call with spec; spec.md hold locks; ledger.released for every lock; lock text names every hold; RESCOPE, first_internal_round gone
│   ├── hookio.py            # refuse_spec, spec_checks_mode gone
│   ├── github.py            # issue_comments, write_issue_comment, _answer's stdin gone
│   ├── settled_design.py    # single-folder mode only
│   └── premise_report.py    # record gone; reason added
├── workflows/review-round.js  # whenToUse names args.spec
├── agents/assessor.md       # reads <spec_folder>/spec.md itself
├── config.json              # spec_checks, design_documents gone
├── speckit/workflows/alq-spec/workflow.yml   # issue input; close-not-worth-doing
├── skills/{alq-spec,alq-issue-tackle,alq-root-cause-check}/SKILL.md
└── README.md                # items 2, 5, 6; Mode; typed words; Layout
dev/alq-review/tests/        # IssueSpec -> spec-argument tests; settled/rescope/comment tests deleted
dev/alq-review/.specify/{presets,workflows}/  # refreshed copies
```

PR 2, the move:

```text
plugins/alq-plan/    .claude-plugin/plugin.json, skills/issue-spec/, scripts/{premise_report,rootcause,settled_design}.py, speckit/
plugins/alq-build/   .claude-plugin/plugin.json, skills/{issue-tackle,root-cause-check}/
plugins/alq-review/  what remains; version 0.13.0
.claude-plugin/marketplace.json        # three plugins
README.md                              # plugin table, install block
dev/alq-plan/tests/, dev/alq-build/tests/   # moved suites + guard tests
```

**Structure Decision**: the repo's `plugins/<name>/` + `dev/<name>/` layout, three times. Callers of what changes, read
in the code: `speclocation` is called by `gate._spec`, `briefs.brief` and `briefs.Spec`, `premise_report.record`, the
three skills, and tests `test_gate`, `test_premise_report`, `test_drive_workflow`, `test_worktree_facts`,
`test_spec_source`; `settled_design.branch_problems` and `policy.first_internal_round` only by `gate._spec_problems`'s
call; `refuse_spec` only by `gate.py`;
`REVIEW_CALL` by `policy` (dead-round relaunch, audit cap, mark-ready) and `gate.on_agent`, `on_skill`; the rescope
route by `gate._on_release`, `_unlock`, `policy._lock_reason`, `reshape_spec_ruling`; `policy.locked` only by `gate._unlock`;
`policy._lock_reason` through `_obstacle` by `mutation`, `launch_round`, `rerequest` and `mark_ready`, and `gate._held`
through `policy.mutation`.

## Complexity Tracking

None.

## Open points

Agreed with the user: a launch refused before its round opens records no binding (R8); reviewing a branch before it
has a PR is out of scope, in #70. The root-cause check runs once, after the internal loop's clean round (R14).
The new constitutions' plugin principles and the records each new log decides again (R16).

The spec changes with this plan: its shipping order is R17's (constitution and README no longer ship with the records),
and the assumption about an unknown `spec` argument is settled by reading.

## Mechanisms

- Two PRs, behaviour then move: R1
- Three plugin folders, manifests and the marketplace listing: R2
- The planning driver's own root variable: R3
- The settled-design check cut to one folder: R4
- Closing a not-worth-doing issue with gh and the report's reason: R5
- The planning skill's two entry points and its last message: R6
- The spec argument's parse, shape and bind in one pure module: R7
- The binding as top-level ledger fields, set in the round's own save: R8
- The HEAD verification that reads only spec.md and refuses on any failure: R9
- The reviewer prompt with no spec headings: R10
- Removal of the settled-design gate check and its two settings: R11
- One release of a RESHAPE_SPEC lock, carrying the ruling: R12
- Every printed review-round call carrying spec: R13
- The build skill's spec and branch arguments and its verdict handling: R14
- One standalone test suite per plugin, with load and naming guards: R15
- The two new Spec Kit projects, constitutions and decision logs: R16
- The shipping order: R17
- The hold on a changed spec.md, released by unlock: R18
