# Implementation Plan: planner checks the plan against the ADR folders it is given

**Branch**: `177-spec` | **Date**: 2026-11-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/177-plan-adr-check/spec.md`

## Summary

`[shared] adr_folders` lists the ADR folders a repo's work is checked against. Core resolves them (`adrFolders`:
outside-repo entries from the main checkout, in-repo ones in the calling checkout) and runs `adr` at one pinned
version (`checkAdrFolder`). Planner's workflow gains two checks, after plan and after tasks, each a script that
asks `adr check` per folder, a headless judge that writes a verdict as data, and a script that decides each
folder's outcome and stops the run on a departure or a check that could not run; every stop is reported by one
function. The user can overrule a named departure on resume; the decide step, its only writer, records the ruling
in the spec folder's `adr-rulings.json`, honoured by later checks and, after #235, by reviewer, whose decision check
moves onto the same list.

## Technical Context

**Language/Version**: TypeScript on Node ≥ 22.18 (core, planner scripts, reviewer `lib/`); Python 3 for
`drive_workflow.py` (calls no core).

**Primary Dependencies**: zod 4.6.7, smol-toml 1.9.1; `@adrkit/cli` 0.20.0 (`adr`); Spec Kit workflow engine
(`shell`, `prompt`, `if` steps).

**Storage**: files: `codeworks.toml`; run folder JSON (`.specify/workflows/runs/<id>/`); the rulings file
`<spec folder>/adr-rulings.json`.

**Testing**: `node --test` (core, planner, reviewer TS); `unittest` (planner Python).

**Target Platform**: the admin's machine, where planner runs; the agent machine for reviewer (US5).

**Project Type**: plugins + shared library.

**Performance Goals**: none; planner waits for `adr` (shell step timeout 1800 s).

**Constraints**: no network call, no GitHub credential in the check (FR-010); no env var for a setting.

**Scale/Scope**: ~7 ADR folders, tens of paths per artifact.

## Constitution Check

*Pre-research and post-design: both pass.*

| Gate | Answer |
|---|---|
| I Contract-first | Every new shape is one Zod schema in core (`AdrVerdict`, `AdrRuling`, `AdrRulings`, `Shared.adr_folders`); one path grammar for both artifacts; `adr`'s answer read once in `core/src/adr.ts`, reviewer moves onto it in US5. Pass. |
| II Ownership | Core resolves, planner and reviewer call; external input (`adr` stdout, verdict, ruling, artifact grammar) validated where read. Public-repo rule stays an ADR-0009 rule the admin keeps. Pass. |
| III Fail loud | Unreadable folder, bad `adr`, bad verdict: could not run, never pass; no fallback to discovering folders. Pass. |
| IV Test-first | Each story starts from red tests (quickstart). Pass. |
| V Smallest change | No deadline parameter (planner has none); no judge for a folder nothing governs; reviewer's port reused, not duplicated. Pass. |
| VI Rule apart | ADR-0009 amendment and the reviewer record (working name 0022) each merge in their own PR before the code (R11). The `Shared` schema and `codeworks.toml` move together: config, not governed code. Pass. |
| P1 Code decides | Both checks are workflow steps running scripts; the model judges, a script decides; every stop of ask, judge and decide names the next step through one function, `adrStop` (R8). Pass. |
| P2 Hold release | The stop is released only by a resume whose ruling the user gave (`ADR_RULING`, that resume only), or a changed artifact; both named by amended ADR-0009. Pass. |
| P3 Pure rules | `decideFolder`/`decideCheck`, `adrStop`, `changedSince` and the grammars are pure; `adr_check.ts` only does I/O. Pass. |
| P4 Could not run | Its own outcome, exit 2, never a pass, a judge that did not answer included (R8). Pass. |
| P5 Settled design | Every mechanism below cites a research decision with Existing tools. Pass. |
| P6 One writer | `codeworks.toml`: admin. Asked record: ask step. Verdict: judge. Rulings file: decide step, from the user's `ADR_RULING` only; an entry neither at `HEAD` nor in decide's run record, or an asked record or paths changed after ask, is could not run (R9). Pass. |
| P7 Data | Paths (one grammar), verdict, rulings file each have a grammar (contracts/artifact-grammar.md). Pass. |
| P8 Generic | Folders come only from `codeworks.toml`; nothing names this repo. Pass. |
| P9 Identities | No actor trusted; no GitHub call. Pass. |

## Spec amendments

FR-004, US2 (text, AS2, independent test) and SC-004 amended: a relative entry that lands inside the repo is read
in the calling checkout. As first written, `docs/adr` from a worktree resolved to the main checkout's working tree,
so a superseding record drafted into the spec PR (US3 AS2's next step) was never seen and reviewer lost a changed
record's own error (R2).

## Project Structure

### Documentation (this feature)

```text
specs/177-plan-adr-check/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/  core.md  artifact-grammar.md  workflow-steps.md
├── adr-rulings.json   (written by the decide step only, when the user rules)
└── tasks.md   (/speckit-tasks)
```

### Source Code (repository root)

```text
core/src/            settings.ts  adr-folders.ts (new)  adr.ts (new)  values.ts
core/src/contracts/  decision-check.ts (new)  tasks.ts
core/tests/          adr-folders.test.ts  adr.test.ts  decision-check.test.ts  tasks.test.ts  settings.test.ts (+ fixtures, typed Shared literals)
planner/plugin/      scripts/adr_check.ts (new)  lib/adr-check.ts (new)
                     speckit/workflows/issue-spec/{workflow.yml, adr-judge.md (new)}
                     speckit/presets/settled-design/templates/plan-template.md
                     skills/issue-spec/{SKILL.md, scripts/drive_workflow.py}
planner/tests/       adr-check.test.ts (new)  test_drive_workflow.py  test_plan_template.py  token.test.ts
                     support/checkout.ts
planner/docs/adr/    0009-…md (amended)
reviewer/docs/adr/   0022-…md (new; number taken at draft time, R11)
reviewer/plugin/     lib/round/decisions.ts  README.md        (US5)
orchestrator/tests/support/  story.ts  checkout.ts  (fixtures)
codeworks.toml
```

**Structure Decision**: core owns the list, its resolution, `adr`, and every grammar a second component reads;
planner owns the check steps and their pure rules; reviewer only changes its own decision check, after #235.

## Mechanisms

- `[shared] adr_folders` key and its schema: R1
- `adrFolders`, resolving each entry from the main or the calling checkout: R2
- `checkAdrFolder` / `readAdrAnswer` and `ADR_VERSION` in core: R3
- `plan.md` `## Touches` section and its grammar: R4
- `tasks.md` task-line paths and story: R5
- ask → judge → decide steps after plan and after tasks: R6
- judge verdict file and `AdrJudgment` set: R7
- per-folder outcome, exit status and the one stop reporter `adrStop`: R8
- user's ruling on resume, the rulings file, its one writer and the writer guard: R9
- reviewer's decision check on the listed folders and the rulings file: R10
- ADR-0009 amendment and the reviewer record, then PR order: R11

## Touches

- `planner/docs/adr/0009-check-the-plan-against-the-governing-decision-logs-before-critique.md`
- `reviewer/docs/adr/0022-check-only-the-listed-adr-folders-and-honour-a-recorded-ruling.md`
- `codeworks.toml`
- `core/src/settings.ts`
- `core/src/adr-folders.ts`
- `core/src/adr.ts`
- `core/src/values.ts`
- `core/src/contracts/decision-check.ts`
- `core/src/contracts/tasks.ts`
- `core/tests/settings.test.ts`
- `core/tests/adr-folders.test.ts`
- `core/tests/adr.test.ts`
- `core/tests/decision-check.test.ts`
- `core/tests/tasks.test.ts`
- `core/tests/fixtures/state/issue.ts`
- `core/tests/could-not-run.test.ts`
- `core/tests/threads.test.ts`
- `core/tests/required-checks.test.ts`
- `core/tests/contract.test.ts`
- `core/tests/state-read.test.ts`
- `planner/plugin/scripts/adr_check.ts`
- `planner/plugin/lib/adr-check.ts`
- `planner/plugin/speckit/workflows/issue-spec/workflow.yml`
- `planner/plugin/speckit/workflows/issue-spec/adr-judge.md`
- `planner/plugin/speckit/presets/settled-design/templates/plan-template.md`
- `planner/plugin/skills/issue-spec/SKILL.md`
- `planner/plugin/skills/issue-spec/scripts/drive_workflow.py`
- `planner/tests/adr-check.test.ts`
- `planner/tests/test_drive_workflow.py`
- `planner/tests/test_plan_template.py`
- `planner/tests/token.test.ts`
- `planner/tests/support/checkout.ts`
- `orchestrator/tests/support/story.ts`
- `orchestrator/tests/support/checkout.ts`
- `reviewer/plugin/lib/round/decisions.ts`
- `reviewer/plugin/README.md`
- `reviewer/tests/decisions.test.ts`

## Complexity Tracking

None.
