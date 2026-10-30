# Implementation Plan: reviewer writes the records the orchestrator acts on, through core

**Branch**: `209-spec` (worktree `feat/209-reviewer-on-core`) | **Date**: 2026-10-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/209-rebuild-reviewer-on-core/spec.md`

## Summary

reviewer's hook path is rebuilt in TypeScript on core (root ADR-0009 d2). It records rounds and holds on the
story issue through core's state module as the reviewer App, and the claim/shim counts in a second tagged
`reviewer-gates` comment; reads the session's issue from the orchestrator's record and fences commits on it;
calls `releaseOnClaim` once per claim, first thing in a run; and grades each new commit after it is made, from a
hooks-owned bare copy, recording passes in a session-scoped commit-check pass record that core owns. The SQLite
ledger, `unlock`/`override` prompts and `pre_merge_gate.py` are deleted.

Three things land before reviewer's code, each in its own PR (Principle VI, FR-004, FR-016, FR-017):
1. ADR amendments: reviewer ADR-0011 d1, d2, d5; ADR-0001 d2; ADR-0008; ADR-0013 d4; ADR-0004 d4 and
   ADR-0003 d1 ("ledger" → the check's session files).
2. Core: tag-keyed state, any-edited-reviewer-comment hold, gates contract (R5).
3. Core: commit-check pass record and the protected-path matcher (R11).

External dependency: #174's core PR adding the session issue record (VP-001, PR #216). US3 and US4 cannot start
before it merges.

## Technical Context

**Language/Version**: TypeScript (tsc 7.0.2, `noEmit`, `erasableSyntaxOnly`) on Node ≥22.18 type stripping

**Primary Dependencies**: core (`state.ts`, `tokens.ts`, `gh-config.ts`, `settings.ts`, `git.ts`, `tree.ts`,
`identity.ts`, `outcomes.ts`); `zod 4.6.7`, `smol-toml 1.9.1`, `yaml 2.9.1` (core's pins); `diff-match-patch`
(npm) for lineages

**Storage**: GitHub issue comments (state, gates) through core; session-scoped files under
`~/.local/state/codeworks/reviewer/sessions/<session>/` (bare copy, pass record, running check, memos, claim
markers, `gate.log`); no database

**Testing**: `node:test` + `node:assert/strict`, `fakeGitHub` recorder, temp git repositories

**Target Platform**: the agent machine (Linux, managed settings, root ADR-0008); Claude Code hooks

**Project Type**: Claude Code plugin (hooks + workflows + agents) over a shared TS library

**Performance Goals**: a hook run does no slow work (ADR-0003 d1): at most one `readState`, one mint per writing
run, one `git fetch` into the bare copy; claim/shim checks run as workflows, not in the hook

**Constraints**: hook timeouts (60 s today); fail closed on every unanswered read (P4); the model cannot write
the session folder (`HOME_FOLDERS` deny path)

**Scale/Scope**: ~24 Python modules retired; 4 workflows and 7 agents kept; one story issue per session

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Answer | Pass |
|---|---|---|
| I Contract-first | Snapshot stays core's. The gates snapshot, session record reader and commit-check pass record are core contracts (Zod), each with one owner; reviewer is an adapter. No second validator over the state. | ✅ |
| II Ownership | Core changes land in `core/`; reviewer code in `reviewer/`; the orchestrator's record is read, not written. No secrets in code: `app_id` in `codeworks.toml`, key read by `readKey`. Private repo. | ✅ |
| III Fail loud | Every unanswered read refuses as could not run; tampered state refuses naming its release; no fallback to local state; ledger deleted, no compatibility path (FR-018). | ✅ |
| IV Test-first | Each task starts from a red `node:test`; quickstart scenarios are the spec's acceptance scenarios against the recorder. | ✅ |
| V Smallest change | Only the hook path moves (root ADR-0009 d2 forces it, R1); retired modules and their tests are deleted, not left. | ✅ (see Complexity) |
| VI Governing rule apart | ADR amendments and core's state rule change land in their own PRs before reviewer's code. | ✅ |
| P1 Code decides | Fence, release, holds, counts and passes are decided in hook code; every refusal names its next step (FR-010; [contracts/refusals.md](contracts/refusals.md)). | ✅ |
| P2 Approved release | Every hold (`escalation`, `pushback`, `audit`, `rescope`, `claim`, `shim`) is released only by core's `releaseOnClaim` (Ready move + admin comment, or `/codeworks reset`), ADR-0013 d2–d3. `unlock`/`override` removed (FR-008). Edited/deleted reviewer App comment reads as held (R5). | ✅ |
| P3 Pure rules | `lib/rules/*` (fence, claim step, round→snapshot, counts, range, protected paths) are pure; `hooks/*.ts` do I/O only. | ✅ |
| P4 Could not run | GitHub unanswered, record unreadable, bare-copy fetch failure, workflow not answering → `COULD_NOT_RUN`, never a pass; commit not recorded. | ✅ |
| P5 Settled design | Planner-only; complied with anyway: every mechanism cites research.md. | n/a |
| P6 One writer | State + gates comments: reviewer hook (reviewer App). Session record: orchestrator. Pass record: reviewer hook. Lanes, pushes, check runs: orchestrator. | ✅ |
| P7 Facts as data | Tags, Zod JSON, branch grammar, `session_id`; no prose parsed. | ✅ |
| P8 Generic | Branch grammar, `codeworks.toml [reviewer]`, GitHub objects only. | ✅ |
| P9 Named identities | Admin/writer from `roleOf`; reviewer App comments by `reviewer_app_login`; model's commands never count as a writer. | ✅ |

Post-design re-check: unchanged, all pass.

## Mechanisms

- Hook path in TypeScript, Python retired, carrier link to core: R1
- Reader from the session token, writer minted as the reviewer App, `[reviewer]` settings: R2
- One state reading per hook run, no local copy: R3
- Round results, verdicts and hold kinds mapped onto core's value sets: R4
- Core reads/writes reviewer App comments by tag; any edited reviewer comment holds; gates contract: R5
- Claim/shim counts derived from times in the gates snapshot: R6
- Session issue record read through #174's core reader: R7
- Commit fence as a pure rule applied in the after-commit check: R8
- Release on claim once per claim, first in the run, marker file: R9
- After-commit check over a hooks-owned bare copy, graded from GitHub's branch head: R10
- Commit-check pass record and protected-path matcher in core: R11
- `log` mode downgrades refusals only: R12
- Deleting the ledger, `unlock`/`override`, `pre_merge_gate.py` and the poller inbox: R13
- `node:test` against the GitHub recorder and temp repositories: R14

## Project Structure

### Documentation (this feature)

```text
specs/209-rebuild-reviewer-on-core/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── gates-snapshot.md
│   ├── commit-pass-record.md
│   ├── hooks.md
│   └── refusals.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
reviewer/docs/adr/                 # PR A: amendments 0001, 0003, 0004, 0008, 0011, 0013

core/src/
├── state.ts                       # PR B: tag-keyed reading, any-edited hold, readGates/writeGates
├── contracts/gates.ts             # PR B
├── contracts/commit-pass.ts       # PR C
├── commit-pass.ts                 # PR C: read/record, atomic session file
└── protected-paths.ts             # PR C: orchestrator ADR-0004 d4 matcher
core/tests/                        # PR B, PR C

reviewer/plugin/
├── core -> ../../core/src         # carrier link
├── package.json, package-lock.json
├── .claude-plugin/plugin.json     # version bump
├── hooks/hooks.json               # node *.ts entries
├── hooks/{pre-tool-use,post-tool-use,user-prompt-submit,subagent,session-start}.ts
├── lib/
│   ├── settings.ts  github.ts  run-state.ts  session.ts  hookio.ts
│   ├── rules/       fence.ts claim-step.ts rounds.ts counts.ts range.ts launch.ts ...   # pure
│   ├── check/       bare-copy.ts after-commit.ts claim.ts shim.ts lineage.ts
│   └── round/       launch.ts record.ts assess.ts decisions.ts
├── workflows/*.js  agents/*.md    # kept
└── scripts/*.py, config.json      # deleted
reviewer/tests/*.test.ts           # Python tests of retired modules deleted
codeworks.toml                     # [reviewer] section
```

**Structure Decision**: follow planner's carrier layout (`lib/` + `core` link); pure rules under
`lib/rules/` (P3); one hook file per event.

## Delivery order

| # | PR | Blocks |
|---|---|---|
| A | reviewer ADR amendments (FR-004, FR-016, FR-017) | B, all reviewer code |
| B | core: tag-keyed state + gates contract (R5) | US1 gates part |
| C | core: commit-check pass record + protected paths (R11) | US2, #174 Story 2 |
| — | #174 core: session issue record (external) | US3, US4 |
| S | carrier, hook skeleton, session folder, `write.lock` (FR-020) | all stories |
| US1 | settings, round/hold recording through core, gates comment, ledger deleted | — |
| US2 | bare copy, after-commit check, ancestry base (FR-021), per-branch pass record writes | US3 |
| US3 | fence in the after-commit check | — |
| US4 | release on claim | — |

Order: A → B → C → S → US1 → US2 → US3 → US4. US3 and US4 also wait on #174's core PR (#216).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Whole hook path ported, not only the state calls (V) | Root ADR-0009 d2; `gate.py` dispatches every event and imports every rule module | A TS hook shelling out to Python keeps two runtimes deciding one hook run (R1) |
