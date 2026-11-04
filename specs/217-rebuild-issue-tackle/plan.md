# Implementation Plan: builder rebuilds issue-tackle to its records

**Branch**: `217-spec` | **Date**: 2026-10-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/217-rebuild-issue-tackle/spec.md`

## Summary

builder becomes a core carrier with one TypeScript step script. The skill takes `<s>` alone and runs the script,
which reads the session record, lane, issue, branch, worktree, spec folder, task ticks, PR, `internal-review`
check run and findings through core, decides one step in a pure function, and prints it as JSON: a stop, a cut
(made by the script), a merge of the default branch, implement, internal round, github round, or nothing to do.
The skill acts on that one step and never pushes, opens a PR, rebases or force-pushes. `root-cause-check` and
builder's Python tests retire. Seven small core additions (B1–B7) are their own story, US1, one PR on one US1
branch, merged before US3.

## Technical Context

**Language/Version**: TypeScript run directly by Node ≥ 22.18 (type stripping), as core (root ADR-0009)

**Primary Dependencies**: core (`../../core/src` link) and its pins only: `zod`, `yaml`, `smol-toml`; `git` and
`gh` on the agent machine

**Storage**: none of builder's own. Reads: GitHub; the orchestrator's state folder (`gh/`, `sessions/<id>.json`)
at core's paths; git

**Testing**: `node --test` and `tsc -p .` in `builder/`; core's `fake-github.ts`; planner's scratch-checkout
support; `core/scripts/check-carriers.ts` in CI

**Target Platform**: the agent machine (Linux, Claude Code under managed settings)

**Project Type**: Claude Code plugin: one skill and one script, no hooks

**Performance Goals**: a step read finishes well inside one Bash call (< 60 s); no polling

**Constraints**: GitHub read-only (session token); writes only the cut's local branch and worktree; imports only
core; no Python

**Scale/Scope**: one story per session, one step per invocation

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Answer |
|---|---|
| I. Contract-first | Shared shapes stay core's: session record, spec facts, task-block label, `Finding`; B2 adds the task-line read beside the label grammar, B6 the findings composite three callers need. The `Step` JSON is builder's own, read only by its skill (contracts/step-script.md). No second validator. **Pass** |
| II. Ownership & trust | builder code in `builder/`; reads and grammars in `core/` by US1's own PR; the auditor and planner edits only drop a retired name. Arguments, session record, settings and GitHub answers validated where they enter (R3, R5–R7). No key read. **Pass** |
| III. Fail loud | Every unanswered read exits 2 naming it; a refused record or token is never read as absent; a module's check run pending or absent exits 2, never a pass (R12). The skill repairs no folder (ADR-0002 d3); a dirty worktree or a head behind the PR stops (R8). **Pass** |
| IV. Test-first | `decideStep` is pure, so each acceptance scenario starts as a failing unit test; reads tested against the fake GitHub and a scratch repo; R4's substitution is run on the agent machine before step code. **Pass** |
| V. Smallest complete change | One script, one skill; core additions only where builder needs a read core lacks; the stale `alq-` pattern in the carried guard test is fixed, not copied (R2). **Pass** |
| VI. Rule apart from code | The constitution's builder line changes in its own PR first (R15). `check-carriers.ts` and `tests.yml` unchanged. **Pass** |
| P6. One writer | builder writes commits (ticks included) and, on a cut, a local branch and worktree; pushes, PRs, lanes, check runs: the orchestrator; rounds and holds: reviewer; the session record: the orchestrator's hook. **Pass** |
| P8. Generic | Repository from origin; board, Apps and validators from `codeworks.toml`; default branch from GitHub; nothing repo-specific. **Pass** |
| P9. Named identities | The attestation and each `<module>-review` count only a check run by `orchestrator_app_login`'s App (R12). **Pass** |
| P1, P3, P4, P7 | Apply to reviewer, planner, orchestrator; followed anyway: rule in a pure function (P3), could-not-run as exit 2 (P4), facts from keys, grammars and check runs, never headings (P7: `observed` from front matter, `<k>` from `[US<k>]`). **N/A** |
| P2, P5 | No hold added or released (P2 N/A); every mechanism below cites a research decision (P5). **Pass** |

Re-check after Phase 1: unchanged. No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/217-rebuild-issue-tackle/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── step-script.md
│   └── skill.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
builder/
├── package.json                  # test script, dev pins (planner's)
├── package-lock.json
├── tsconfig.json
├── plugin/                       # what an install copies
│   ├── .claude-plugin/plugin.json   # 0.3.0, description rewritten
│   ├── package.json              # core's runtime pins, exact
│   ├── package-lock.json         # lockfileVersion 3
│   ├── core -> ../../core/src
│   ├── lib/
│   │   ├── guarded.ts            # guard-only static import (R1)
│   │   ├── step.ts               # StepFacts, Step, StopState schemas; decideStep (pure)
│   │   └── facts.ts              # readFacts: core reads, git, the cut (R5–R12)
│   ├── scripts/step.ts           # entry: args, guard, readFacts, decideStep, print, exit
│   └── skills/issue-tackle/SKILL.md   # rewritten (R13)
│   # skills/root-cause-check/ deleted (R14)
└── tests/                        # *.py and paths.py deleted (R2)
    ├── carrier.test.ts
    ├── guarded.test.ts
    ├── step.test.ts              # decideStep, every scenario of US3–US5
    ├── facts.test.ts             # reads vs fake GitHub and a scratch repo: one case per data-model stage 4–5 and 9 outcome (cut idempotent, worktree on another branch, GitHub-only branch, local-only branch, conflicting merge-tree, merge in progress, dirty, head behind)
    └── skill.test.ts             # skill text; carried Python assertions; SC-005 search
core/src/                         # B1–B7 (US1), one PR
auditor/plugin/skills/pr-audit/SKILL.md   # R14
planner/plugin/scripts/rootcause.py       # R14, comment only
.specify/memory/constitution.md           # R15, own PR first
```

**Structure Decision**: one component folder (root ADR-0001); `plugin/` installed, `tests/` not. CI's
`tests.yml` finds `builder/tests/` and runs `npm ci`/`npm test` once `builder/package.json` and the plugin lock
exist, and the carrier check lists builder once the link exists; no workflow change.

## Delivery order and core needs

Story order: US1, US2, US3, US4, US5 (spec). US1 is the core story: B1–B7 go in one PR on one US1 branch
(`<s1>-us1-<slug>`, root ADR-0005 d1; one issue, branch and PR per story, org ADR-0003; reviewer's fence admits
only the session issue's `<s>-us*`), which closes US1's issue (builder ADR-0003 d1), bumps every carrier's version
then present once, and merges before US3, the first story that calls a B addition. "Before" is what each item
merges before.

| # | Item | Story | Before | Holds |
|---|---|---|---|---|
| K | Constitution amendment | — | US2 | R15 |
| — | #174 carrier (US1 of #174) | — | US2 | spec Clarifications Q4 |
| — | **US1**, one PR: B1–B7 below | US1 | US3 | core additions; none reads a key or writes (FR-024) |
| — | **US2** | US2 | US3 | carrier, guard, TypeScript test suite (skill-text tests on today's skill dropped as R2 says), Python removed |
| — | **US3** | US3 | | script: session, lane, closed/done, branch, cut and worktree, folder, requirement; skill takes `<s>` |
| — | **US4** | US4 | | after #212 and #243 (reviewer ADR-0014 d1) and #244 (ADR-0017); PR states, rounds, ticks; skill rewritten; root-cause-check retired (R13–R14) |
| — | **US5** | US5 | | merge decision and skill's merge path |

US1's sections, each with the first story that calls it:

| # | Section | First caller | Holds |
|---|---|---|---|
| B1 | Story branch name | US3 | `storyBranchName(s, k, title)` beside `parseBranch`, slug grammar pinned, round-trip asserted (R8) |
| B2 | Task-line grammar and story tasks | US3 | `readTaskLine` and `storyTasks(text, s)` in `contracts/tasks.ts`; planner's `land.ts` reads tags through it (R11) |
| B3 | Story PR closed | B7, US3 | `StoryPr.closed`, read by the query already (R12) |
| B7 | Stop rule and its facts | US3 | `storyStop(facts)` and `StopState`, pure; `readStoryStopFacts`, read-only, after B3; #174's Stop hook calls both (R16) |
| B5 | `internal-review` read | US4 | `internalReviewAt(reader, repo, head, appLogin)` from `required-checks.ts`'s run read (R12) |
| B6 | PR findings | US4 | `prFindings(reader, …)` over required checks, `<module>-review` check runs and threads; no key, no writer (R12) |
| B4 | Spec PR merge commit | US5 | `SpecPr.mergeCommit` (R9) |

root-cause-check's deletion and its retired-text tests ship in US4's PR: the skill invokes it until US4 rewrites the
skill (spec FR-020).

Coordination with #174: the state-folder paths are on main in `core/src/orchestrator-paths.ts` (#242), and #174's
Stop hook calls B7's read and rule (#174 R21, T076; #251).

## Complexity Tracking

None.

## Mechanisms

- Carrier shape (link, pins, lock, version, guarded entry): R1
- TypeScript test suite; Python tests carried or dropped: R2
- Step script: facts, pure decision, JSON output, exit codes: R3
- Skill's call of the script (plugin root, session id): R4
- GitHub reader from the session token's gh folder: R5
- Session record check: R6
- Lane, closed and done stops: R7
- Story branch lookup, worktree and cut: R8
- Merge-of-default-branch decision: R9
- Spec folder and requirement at HEAD: R10
- Task tick read (core `storyTasks`): R11
- PR state, attestation check run, findings composite: R12
- Skill text: one loop over the printed step: R13
- root-cause-check retirement: R14
- Constitution amendment ordering: R15
- Stop rule in core, shared with the Stop hook: R16
