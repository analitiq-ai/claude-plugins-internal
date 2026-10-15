# Implementation Plan: The agent picks the premise outcome

**Branch**: `112-spec` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/112-agent-picks-premise/spec.md`

## Summary

At the premise pause the agent, not the user, picks one of `write the spec`, `no spec needed`, `not worth doing`,
by the rule of FR-002, and resumes the run through the same `premise_verdict` input (R1). The report form drops
`Recommendation:` and the check reads the outcome from `Pick:` (R2). A reported defect may be `no spec needed` only
when its `harm` and `change-alters` answers cite `<path>:<line>` from a `code:` or `reproduction:` source (R4). The
skill's step 2 carries the pick rule and the session line, and its "verdict is the user's" rule narrows to grill
and critique (R5). ADR-0006 and ADR-0008 are amended first, in a PR of their own (R6). `workflow.yml` gets two
comment-only edits (R3); its steps do not change. The no-spec path that #79 put on main (PRs #117, #120) is used as
it is: a `no spec needed` pick, the agent's now, still has `no_spec.py write` write the folder's no-spec spec.md,
and a rescope of that folder is a premise the agent picks too (R7).

## Technical Context

**Language/Version**: Python 3 (stdlib only), Markdown skill and ADR prose

**Primary Dependencies**: Spec Kit `specify workflow` engine (`>=1.0.7`), `gh` CLI (unchanged use)

**Storage**: Files: `.specify/workflows/runs/<run_id>/premise-report.md`; on `no spec needed`, the no-spec
`specs/<issue>-<short name>/spec.md` (written by `no_spec.py`, unchanged)

**Testing**: `unittest`, run by CI over `dev/alq-plan/tests/` (`.github/workflows/tests.yml`)

**Target Platform**: Claude Code session driving the `alq-spec` workflow

**Project Type**: Claude Code plugin (skill + scripts + Spec Kit workflow)

**Performance Goals**: N/A

**Constraints**: alq-plan requires no other plugin; the premise check grades form, not correctness

**Scale/Scope**: One script (`premise_report.py`), one skill (`issue-spec/SKILL.md`), two draft ADRs, three test
files edited; three more run unedited through the shared `report()` helper

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Answer |
|---|---|
| I. Contract-first | The premise report form is owned by `premise_report.form()`; this changes it in place (R2, R4). No new shape or validator. Pass. |
| II. Ownership & trust | All changes in `plugins/alq-plan/` and `dev/alq-plan/`. Issue text still never goes into a command line. Pass. |
| III. Fail loud, no compat | `Recommendation:` is removed outright, with no reader kept for old reports (R2). No fallback pick path. Pass. |
| IV. Test-first | Each check change starts from a red test in `test_premise_report.py`; each skill wording change from a red phrase test in `test_spec_source.py` (quickstart). Pass. |
| V. Smallest complete change | `workflow.yml` steps untouched; two comments reworded (R1, R3). Every user-pick phrase in the files touched is reworded, test files included (R3). Pass. |
| VI. Rule apart from code | ADR amendments are PR 1, code is PR 2 (R6). The premise check and the skill ship together: the check grades the report the agent writes at run time, not the skill's text, and splitting them would leave main with a skill that writes a field the check refuses. Pass with justification — see Complexity Tracking. |
| P1. Code decides | The pick itself is a judgement no script can make — see Complexity Tracking. Every mechanical part is scripted: `Pick:` is an outcome and equals the resumed pick, a stop names its question and reason, a defect's `no spec needed` is located (R1, R4). Every check failure names its Next step. Pass with justification. |
| P3. Rules are pure | The new rules are in `problems()`, a pure function of the report text and the pick. Pass. |
| P4. Could not run | Unchanged exit statuses: 1 for problems, 2 when the check could not run. Pass. |
| P5. Settled design | Every mechanism below cites R1–R6, each with Existing tools. Pass. |

Re-check after Phase 1: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/112-agent-picks-premise/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── premise-report.md
└── tasks.md             # /speckit-tasks, not created here
```

### Source Code (repository root)

```text
dev/alq-plan/docs/adr/
├── 0006-close-an-issue-not-worth-doing-and-post-nothing-for-one-that-needs-no-spec.md   # PR 1
└── 0008-give-an-issue-that-needs-no-spec-a-spec-folder-that-says-so.md                  # PR 1

plugins/alq-plan/
├── scripts/premise_report.py          # PR 2: form, problems(), docstrings
├── scripts/no_spec.py                 # unchanged (R7)
├── skills/issue-spec/SKILL.md         # PR 2: description, opening paragraph, steps 2–3, closing rule
└── speckit/workflows/alq-spec/workflow.yml  # PR 2: two comments only (above check-folder and premise-report)

dev/alq-plan/tests/
├── test_premise_report.py             # PR 2: report() helper, form, defect rule
├── test_spec_source.py                # PR 2: skill phrases; the no-spec and rescope phrase tests kept
├── test_drive_workflow.py             # PR 2: Premise docstring; a located defect's no spec needed writes the no-spec spec.md
├── test_no_spec.py                    # unedited; runs through report()
├── test_spec_folder.py                # unedited; runs through report()
└── test_rootcause.py                  # unedited; runs through report()
```

**Structure Decision**: Two PRs. PR 1 changes only the two ADRs and merges first. PR 2 changes the script, the
skill and the tests.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| P1: the pick rule (FR-002) and "never ask the user to pick" (FR-007) live in skill prose the agent obeys | Whether an issue is obsolete, a no-brainer, or has decisions in it is a judgement over the issue and the code; until now the user made it, also outside any script | A script that classifies issues (keywords, diff size) would decide by proxy and be wrong silently; the checkable parts are scripted (R4) and the prose is pinned by `test_spec_source.py` (R5) |
| VI: the premise check (`premise_report.py`) ships in the same PR as the skill it grades | The check grades the report the agent writes at run time; the skill and the check change that report's fields together (`Recommendation:` dropped, defect rule) | Either order of two PRs leaves main with a skill that writes a report the check refuses, or a check that refuses the report the skill writes |
| Citation pattern restated from alq-review's `claimcheck.py` | alq-plan requires no other plugin (Platform Constraints), so it cannot import it | Importing across plugins breaks a standalone install |

## Mechanisms

- Agent pick passed through the existing `premise_verdict` gate input: R1
- `Pick:` mismatch check kept, message reworded: R1
- `Recommendation:` removed from the form and the check: R2
- User-pick wording removed from script, skill and tests: R3
- Located-defect rule for `no spec needed` in `problems()`: R4
- Pick rule, session line and narrowed verdict rule in the skill: R5
- ADR-0006 and ADR-0008 amended in place in their own PR: R6
- No-spec spec.md and the rescope of a no-spec folder used as on main: R7
