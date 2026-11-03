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
moves onto the same list and holds a story that changes a spec or a record, or meets a broken record, for planner.
The plan's paths are written by the plan step to the run folder's `touches.json`, read only by the check.

## Technical Context

**Language/Version**: TypeScript on Node ≥ 22.18 (core, planner scripts, reviewer `lib/`); Python 3 for
`drive_workflow.py` (calls no core).

**Primary Dependencies**: zod 4.6.7, smol-toml 1.9.1; `@adrkit/cli` 0.20.0 (`adr`); Spec Kit workflow engine
(`shell`, `prompt`, `if` steps).

**Storage**: files: `codeworks.toml`; run folder JSON (`.specify/workflows/runs/<id>/`, gitignored), the plan
step's `touches.json` among them; the rulings file `<spec folder>/adr-rulings.json`.

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
| VI Rule apart | Planner ADR-0009, reviewer ADR-0013, orchestrator ADR-0002 and root ADR-0010 are amended, and reviewer ADR-0022 and root ADR-0011 "planner alone writes specs and ADRs" added, in the planning PR before any code (R11). The `Shared` schema and `codeworks.toml` move together: config, not governed code. Pass. |
| P1 Code decides | Both checks are workflow steps running scripts; the model judges, a script decides; every stop of ask, judge and decide names the next step through one function, `adrStop` (R8). Pass. |
| P2 Hold release | The stop is released only by a resume whose ruling the user gave (`ADR_RULING`, that resume only), or a changed artifact; both named by amended ADR-0009. Pass. |
| P3 Pure rules | `decideFolder`/`decideCheck`, `adrStop`, `changedSince` and the grammars are pure; `adr_check.ts` only does I/O. Pass. |
| P4 Could not run | Its own outcome, exit 2, never a pass, a judge that did not answer included (R8). Pass. |
| P5 Settled design | Every mechanism below cites a research decision with Existing tools. Pass. |
| P6 One writer | `codeworks.toml`: admin. `touches.json`: plan step. Asked record: ask step. Verdict: judge. Rulings file: decide step, from the user's `ADR_RULING` only; an entry neither at `HEAD` nor in decide's run record, or an asked record or paths changed after ask, is could not run (R9). Pass. |
| P7 Data | Paths (one grammar), verdict, rulings file each have a grammar (contracts/artifact-grammar.md). Pass. |
| P8 Generic | Folders come only from `codeworks.toml`; nothing names this repo. Pass. |
| P9 Identities | No actor trusted; no GitHub call. Pass. |

## Spec amendments

FR-004, US2 (text, AS2, independent test) and SC-004 amended: a relative entry that lands inside the repo is read
in the calling checkout. As first written, `docs/adr` from a worktree resolved to the main checkout's working tree,
so a superseding record drafted into the spec PR (US3 AS2's next step) was never seen and reviewer lost a changed
record's own error (R2).

2026-11-03, implementor feedback review: US1 removed, its ADR-0009 amendment made in the planning PR with reviewer
ADR-0013's, orchestrator ADR-0002's and new root ADR-0011 (FR-001, R11); the plan's paths moved from a `## Touches`
section of `plan.md` to `<run folder>/touches.json` (FR-012, FR-019, R4); empty list passes first and a broken
record is a FAIL with its own next step (FR-008, R8); reviewer's hold `adr-<issue>` (FR-020, R10).

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
core/src/            settings.ts  adr-folders.ts (new)  adr.ts (new)  values.ts  state.ts (US5: hold `adr-<issue>`)
core/src/contracts/  decision-check.ts (new)  tasks.ts
core/tests/          adr-folders.test.ts  adr.test.ts  decision-check.test.ts  tasks.test.ts  settings.test.ts (+ fixtures, typed Shared literals)
planner/plugin/      scripts/adr_check.ts (new)  lib/adr-check.ts (new)
                     speckit/workflows/issue-spec/{workflow.yml, adr-judge.md (new)}
                     speckit/presets/settled-design/commands/speckit.plan.md
                     skills/issue-spec/{SKILL.md, scripts/drive_workflow.py}
planner/tests/       adr-check.test.ts (new)  test_drive_workflow.py  test_plan_template.py  token.test.ts
                     support/checkout.ts
reviewer/plugin/     lib/round/decisions.ts  README.md        (US5)
reviewer/tests/      decisions.test.ts                       (US5)
orchestrator/tests/support/  story.ts  checkout.ts  (fixtures)
codeworks.toml  README.md
```

Planning PR (this spec's, no code): `planner/docs/adr/0009-…md`, `reviewer/docs/adr/0013-…md`,
`orchestrator/docs/adr/0002-…md`, `docs/adr/0010-…md` amended; `reviewer/docs/adr/0022-…md` and
`docs/adr/0011-…md` added (R11).

**Structure Decision**: core owns the list, its resolution, `adr`, and every grammar a second component reads;
planner owns the check steps and their pure rules; reviewer only changes its own decision check, after #235.

## Mechanisms

- `[shared] adr_folders` key and its schema: R1
- `adrFolders`, resolving each entry from the main or the calling checkout: R2
- `checkAdrFolder` / `readAdrAnswer` and `ADR_VERSION` in core: R3
- the plan step's `<run folder>/touches.json` and its grammar: R4
- `tasks.md` task-line paths and story: R5
- ask → judge → decide steps after plan and after tasks: R6
- judge verdict file and `AdrJudgment` set: R7
- per-folder outcome, exit status and the one stop reporter `adrStop`: R8
- user's ruling on resume, the rulings file, its one writer and the writer guard: R9
- reviewer's decision check on the listed folders and the rulings file, and its hold `adr-<issue>`: R10
- the planning PR's decision records, then PR order: R11

## Complexity Tracking

None.
