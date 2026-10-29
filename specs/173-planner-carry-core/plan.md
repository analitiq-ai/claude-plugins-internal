# Implementation Plan: Planner carries core

**Branch**: `173-spec` | **Date**: 2026-10-28 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/173-planner-carry-core/spec.md`

## Summary

Planner becomes core's first carrier: a `core` link, an exactly pinned module package and lockfile, guarded
TypeScript scripts, and CI that runs its TypeScript tests (US1). Planner's scripts mint the planner App's token
into planner's own gh config folder when they need it; the push reads the token from gh (US2). A TypeScript workflow
step writes the `codeworks` front matter through a new core writer (US3). A landing script creates the story
sub-issues, labels tasks.md, commits as the planner App, pushes to `<p>-spec` and opens the draft spec PR (US4).
The not-worth-doing step stops closing the issue (US5). Planner then drops its session hook, so the admin's gh
stays the session's, and `untracked`'s issue is created through planner's gh (US6). Each core capability lands
with the story that first uses it ([research.md](research.md) R1).

## Technical Context

**Language/Version**: TypeScript run directly by Node ≥ 22.18 (type stripping, as core); Python 3.13 for the
planner scripts that do not call core.

**Primary Dependencies**: Runtime, pinned exactly as core: `smol-toml` 1.9.1, `yaml` 2.9.1, `zod` 4.6.7.
Dev, in `planner/package.json` only: `typescript` 7.0.2, `@types/node` 22.20.5. Tools on the admin's machine:
`git`, `gh`, Spec Kit CLI ≥ 1.0.7.

**Storage**: Files: `codeworks.toml` at the checkout's `HEAD`; planner's gh config folder
`~/.local/state/codeworks/planner/<owner>/<name>/gh`; spec.md front matter; tasks.md label lines. GitHub:
issues, sub-issues, `blockedBy`, the spec PR.

**Testing**: `node --test` + `tsc` for TypeScript (planner and core), `python -m unittest` for planner's Python;
core's `fakeGitHub` for GitHub; temporary git repositories for push and tree reads; the real `gh` for the
token-folder contract.

**Target Platform**: The admin's Linux machine, no managed settings (root ADR-0008 d2); GitHub Actions for CI.

**Project Type**: Claude Code plugin (planner) plus the shared TypeScript package it carries (core).

**Performance Goals**: None beyond the token rule: no GitHub call runs on a token with under 10 minutes left.

**Constraints**: Every GitHub write by planner as the planner App only; every stop before the first write; no
lane written; no exempt label; no Python calls core (root ADR-0009 d2).

**Scale/Scope**: One repository per token; specs of 1–~8 stories; six PRs.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Result |
|---|---|
| I Contract-first | Pass. New shapes each have one owner: spec facts' writer beside core's reader (R11); premise vocabulary in core, generated for Python (R12); lane set in core values (R13); task-block label grammar in core (R16); `[planner]` section validated by planner (R7). No second validator. |
| II Ownership & trust | Pass. Core code in `core/`, planner code in `planner/`; settings, origin URL, GitHub answers and stdin are validated where they enter; no secret in code (the key is read by core from `~/.config/codeworks/`). Private repo. |
| III Fail loud, no workarounds | Pass. A missing key, setting, token or dependency stops the script; no fallback to the admin's gh, `GH_TOKEN` or SSH (R9, R10). |
| IV Test-first | Pass. Each story's tasks start from failing tests; four behaviours marked "not run" in research each get a red test first (R5, R6, R9, R10, R15). |
| V Smallest change | Pass. Rescope landing (#178) and the decision-log check (#177) are out; Python scripts that do not call core stay. |
| VI Rule apart from governed code | Pass. `check-carriers.ts` is unchanged. `tests.yml` gains a runner, not a rule: it grades nothing the PR does not also add, and the carrier check it already runs is untouched. |
| P1 Code decides | Pass. Preflight, spec facts and landing are workflow steps or a script the skill calls; the skill decides nothing. Every stop names the next step. |
| P2 Holds | Pass. No hold added; a rescope stops before any write, naming #178. |
| P3 Pure rules | Pass. `needsMint`, `specFactsOf`, `labelTasks`, `pickSpecPr`, `specFolderAnswer`, the landing's checks are pure; scripts do I/O only. |
| P4 Could not run | Pass. GitHub unanswered in preflight or landing stops the run as could-not-verify; a refused mint exits 2 with core's reason. |
| P5 Settled design | Pass. Every mechanism below cites a research decision. |
| P6 One writer per state | Pass. Planner writes: story issues, sub-issue and `blockedBy` links, tasks.md labels, spec-facts block, the spec PR and its branch (planner ADR-0008, ADR-0010 d1, d3), and its own gh folder. It reads lanes and writes none; closes no issue. Refusing the model's writes planner does not own is reviewer's hook's (reviewer ADR-0012 d1), which does not run where planner runs (root ADR-0008 d2); there the model acts with the admin's own gh login, under the admin's approval, and planner's scripts as the planner App (root ADR-0007 d4), and the merge boundary does not rest on a refusal (root ADR-0007 d5, d7). |
| P7 Facts as data | Pass. Lane, PR state, sub-issue order and tags are fields; facts written as front matter and label lines with a grammar. The premise report's `Reports wrong behaviour:` and the `Observed:` opening are labelled fields the template defines (FR-008). |
| P8 Generic | Pass. Repository from origin, every value from `codeworks.toml`; the gh folder is keyed by repository. |
| P9 Named identities | Pass. No trust predicate added; planner acts only as `codeworks-planner`. |

Post-design re-check: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/173-planner-carry-core/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── core-api.md
│   ├── scripts.md
│   └── codeworks-toml.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
core/
├── src/
│   ├── board.ts                    # US4: Lane read
│   ├── gh-config.ts                # US2: token write/read/refresh rule
│   ├── git.ts                      # US2: runGit env; pushWithGhCredential
│   ├── github.ts                   # US2: repositoryOfRemote, httpsUrl
│   ├── identity.ts                 # US4: specBranch, specPr, specFolderAnswer
│   ├── values.ts                   # US4: Lane
│   ├── contracts/
│   │   ├── spec-facts.ts           # US3: writeSpecFacts
│   │   ├── premise.ts              # US3: premise and root-cause vocabulary
│   │   └── tasks.ts                # US4: task-block label grammar
│   └── generated/premise.json      # US3: written by scripts/write-schemas.ts
├── scripts/write-schemas.ts        # US3: also writes src/generated/
└── tests/                          # one test file per module above

planner/
├── package.json, package-lock.json, tsconfig.json   # US1: test harness, not installed
├── plugin/
│   ├── core -> ../../core/src      # US1
│   ├── package.json, package-lock.json              # US1: carrier pins
│   ├── .claude-plugin/plugin.json  # version bumped by every story
│   ├── lib/guarded.ts              # US1
│   ├── lib/settings.ts             # US2: settings, ghFolder
│   ├── lib/github.ts               # US2 token, US6 mint
│   ├── scripts/spec_facts.ts       # US3
│   ├── scripts/preflight.ts        # US4
│   ├── scripts/land.ts             # US4
│   ├── scripts/gh.ts               # US6
│   ├── scripts/premise_report.py, rootcause.py      # US3: vocabulary from core/generated
│   ├── skills/issue-spec/SKILL.md  # US3–US5 steps
│   ├── speckit/presets/settled-design/templates/spec-template.md  # US3: spec-facts block
│   └── speckit/workflows/issue-spec/workflow.yml    # US3–US5 steps
└── tests/                          # *.test.ts beside the existing test_*.py

.github/workflows/tests.yml         # US1
codeworks.toml                      # US2
```

**Structure Decision**: Root ADR-0001's layout: core code in `core/src`, reached through planner's link; planner's
TypeScript in `planner/plugin/{lib,scripts}`; tests in `planner/tests` and `core/tests`.

## Complexity Tracking

No gate violation.

## Mechanisms

- Six PRs in story order, each core addition with its first user: R1
- Planner's `core` link, pinned package, v3 lockfile and pinned version: R2
- One guarded entry module for every TypeScript script: R3
- `planner/package.json` test harness and `tests.yml` running every component's npm and Python suites: R4
- Each script mints through one function when the stored token is missing, another repository's, or under 10
  minutes left; no hook: R5
- The token in planner's gh config folder, per repository, written and read by core: R6
- `[planner] app_id` read through `readSettings` and this repo's `codeworks.toml`: R7
- The repository and its https URL parsed from origin by core: R8
- Planner's gh for `new_issue.py`, the session's environment untouched: R9
- The push through `runGit` with gh as the only credential helper: R10
- The spec-facts writer in core and the `spec_facts.ts` workflow step: R11
- The premise and root-cause vocabulary defined once in core, generated for Python: R12
- The preflight step reading the lane and the issue's state: R13
- `specBranch`, `specPr` and `specFolderAnswer` in core: R14
- Story sub-issues found by order and chained by `blockedBy`: R15
- The `Story issue: #<n>` task-block label grammar and planner's labelling: R16
- The landing script: reads, then issues, labels, commit, push, draft PR: R17
- The not-worth-doing step naming the close instead of closing: R18
